import {
    Contract,
    TransactionBuilder,
} from 'cashscript';
import {
    swapEndianness,
    cashAddressToLockingBytecode,
} from '@bitauth/libauth';

import managerJson from './art/manager.json' with { type: 'json' };
import fundJson from './art/fund.json' with { type: 'json' };
import assetJson from './art/asset.json' with { type: 'json' };

const DustAmount = 1000n;

const log = console.log;

const sortDecreasingTokenAmount = (a, b) => b.token?.amount - a.token?.amount;

export class FundTokenTransactionBuilder extends TransactionBuilder {
    inflowCategory = '';
    inflowCategorySwapped = '';
    outflowCategory = '';
    outflowCategorySwapped = '';

    // set higher order settings for the fund system
    setFundTokenSystem({
        inflowCategory,
        outflowCategory,
    }) {
        this.inflowCategory = inflowCategory;
        this.inflowCategorySwapped = swapEndianness(inflowCategory);
        this.outflowCategory = outflowCategory;
        this.outflowCategorySwapped = swapEndianness(outflowCategory);
        return this;
    }

    // build and get the contracts for this fund
    buildContracts({
        category,
        amount,
        assets,
    }) {
        const assetContracts = [];
        const managerParams = [];
        assets.forEach(a => {
            const fundAssetCategory = swapEndianness(a.category);
            const assetContract = new Contract(assetJson, [this.outflowCategorySwapped, fundAssetCategory, a.amount], { provider: this.provider });

            assetContracts.push(assetContract);

            managerParams.push(cashAddressToLockingBytecode(assetContract.tokenAddress).bytecode);
            managerParams.push(fundAssetCategory);
            managerParams.push(a.amount);
        });

        const fundContract = new Contract(fundJson, [this.inflowCategorySwapped, this.outflowCategorySwapped, swapEndianness(category)], { provider: this.provider });

        const managerContract = new Contract(managerJson, [
            this.inflowCategorySwapped,
            this.outflowCategorySwapped,
            cashAddressToLockingBytecode(fundContract.tokenAddress).bytecode,
            amount,
            ...managerParams,
        ], { provider: this.provider });

        return { managerContract, fundContract, assetContracts };
    }

    // This method should be called while the transaction has same transaction input and output lengths
    // The consuming app is responsible for adding an output for Bitcoin change, fund token minted, and token change
    async addMint({
        amount,
        fund,
        fund: {
            category: fundCategory,
            amount: fundAmount,
            assets: fundAssets, // category, amount
        },
    }) {
        log('transaction builder...adding minting transaction');

        const { managerContract, fundContract, assetContracts } = this.buildContracts(fund);

        const inflowUtxo = (await managerContract.getUtxos()).filter(u => u.token?.category === this.inflowCategory)[0];
        const fundUtxo = (await fundContract.getUtxos()).filter(u => u.token?.category === fundCategory)[0];

        if (!inflowUtxo || !fundUtxo) {
            throw new Error('Missing required UTXO');
        }

        const mintAmount = fundAmount * amount;
        const fundChangeAmount = fundUtxo.token.amount - mintAmount;

        this.addInput(inflowUtxo, managerContract.unlock.inflow())
            .addInput(fundUtxo, fundContract.unlock.mint())
            .addOutputs([
                {
                    to: managerContract.tokenAddress,
                    amount: inflowUtxo.satoshis,
                    token: {
                        ...inflowUtxo.token,
                    },
                },
                {
                    to: fundContract.tokenAddress,
                    amount: fundUtxo.satoshis,
                    token: fundChangeAmount <= 0 ? null : {
                        category: fundCategory,
                        amount: fundChangeAmount,
                    },
                },
                ...assetContracts.map((assetContract, i) => ({
                    to: assetContract.tokenAddress,
                    amount: DustAmount,
                    token: {
                        category: fundAssets[i].category,
                        amount: fundAssets[i].amount,
                    }
                })),
            ]);
        log('finished adding mint transaction i/o');
        return this;
    }

    // This method should be called while the transaction has same transaction input and output lengths
    // The consuming user is responsible for adding inputs for the fund token
    // The consuming app is responsible for adding an outputs for Bitcoin change and token change
    async addRedeem({
        amount,
        fund,
        fund: {
            category: fundCategory,
            amount: fundAmount, // fund token amount
            satoshi, // TODO: BCH being locked
            assets: fundAssets, // category, amount
        },
    }) {
        log('transaction builder...adding redemption transaction');

        const { managerContract, fundContract, assetContracts } = this.buildContracts(fund);

        //
        const outflowUtxos = (await managerContract.getUtxos()).filter(u => u.token?.category === this.outflowCategory);
        if (!outflowUtxos.length) {
            throw new Error(`Missing required outflow ${this.outflowCategory} UTXO.`);
        }
        const outflowUtxo = outflowUtxos[0];


        //
        const fundUtxos = await fundContract.getUtxos();

        if (!fundUtxos.length) {
            throw new Error(`Missing required fund ${fundCategory} UTXO. Send dust UTXO to contract and redeem again.`)
        }

        const existingFundUtxo = fundUtxos.filter(u => u.token?.category === fundCategory).sort(sortDecreasingTokenAmount);
        const fundUtxo = existingFundUtxo.length ? existingFundUtxo[0] : fundUtxos[0];


        //
        const redeemAmount = fundAmount * amount;
        const updatedFundAmount = fundUtxo.token?.amount + redeemAmount;

        this.addInput(outflowUtxo, managerContract.unlock.outflow())
            .addInput(fundUtxo, fundContract.unlock.redeem());


        const assetChangeAmounts = [];
        for (let i = 0; i < assetContracts.length; ++i) {
            const assetUtxos = (await assetContracts[i].getUtxos()).filter(u => u.token?.category === fundAssets[i].category).sort(sortDecreasingTokenAmount);
            if (!assetUtxos.length) {
                throw new Error(`Missing required asset '${fundAssets[i].category}' UTXO`);
            }
            let tokenAmountAdded = 0n;
            for(let j = 0; j < assetUtxos.length; ++j) {
                this.addInput(assetUtxos[j], assetContracts[i].unlock.release());
                tokenAmountAdded += assetUtxos[j].token.amount;
                if(tokenAmountAdded >= amount * fundAssets[i].amount) {
                    assetChangeAmounts.push(tokenAmountAdded - (amount * fundAssets[i].amount));
                    break;
                }
            }
        }

        log('asset change amounts', assetChangeAmounts);

        this.addOutputs([
            {
                to: managerContract.tokenAddress,
                amount: outflowUtxo.satoshis,
                token: {
                    ...outflowUtxo.token,
                },
            },
            {
                to: fundContract.tokenAddress,
                amount: fundUtxo.satoshis,
                token: {
                    category: fundCategory,
                    amount: updatedFundAmount,
                },
            },
        ]);

        for(let i = 0; i < assetChangeAmounts.length; ++i) {
            if(!assetChangeAmounts[i]) {
                continue;
            }
            this.addOutput({
                to: assetContracts[i].tokenAddress,
                amount: DustAmount,
                token: {
                    category: fundAssets[i].category,
                    amount: assetChangeAmounts[i],
                },
            });
        }

        log('finished adding redemption transaction i/o');
        return this;
    }
}