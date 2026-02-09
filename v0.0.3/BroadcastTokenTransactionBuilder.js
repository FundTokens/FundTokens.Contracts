import {
    Contract,
    TransactionBuilder,
} from 'cashscript';
import {
    swapEndianness,
    hash256,
    bigIntToBinUint64LEClamped,
    hexToBin,
    binToHex,
} from '@bitauth/libauth';

import managerJson from './art/manager.json' with { type: 'json' };
import fundJson from './art/fund.json' with { type: 'json' };
import assetJson from './art/asset.json' with { type: 'json' };
import feeJson from './art/fee.json' with { type: 'json' };

const DustAmount = 1000n;

const sortDecreasingTokenAmount = (a, b) => b.token?.amount - a.token?.amount;

export class FundTokenTransactionBuilder extends TransactionBuilder {
    inflowCategory = '';
    inflowCategorySwapped = '';
    outflowCategory = '';
    outflowCategorySwapped = '';
    #logger = null;

    constructor({ provider, inflowCategory, outflowCategory, logger }) {
        super({ provider });
        this.inflowCategory = inflowCategory;
        this.inflowCategorySwapped = swapEndianness(inflowCategory ?? '');
        this.outflowCategory = outflowCategory;
        this.outflowCategorySwapped = swapEndianness(outflowCategory ?? '');
        this.#logger = logger ?? console;
    }

    // base - 48bytes
    // per asset - 40bytes
    //
    // two = 128bytes
    // three = 168bytes
    // four = 208bytes
    getFundHex(fund) {
        const {
            category,
            amount,
            satoshis,
            assets,
        } = fund;
        const hex = [];
        hex.push(swapEndianness(category)); // 32 bytes
        hex.push(binToHex(bigIntToBinUint64LEClamped(amount))); // 8 bytes
        hex.push(binToHex(bigIntToBinUint64LEClamped(satoshis))); // 8 bytes TODO: consider trimming in size
        assets.map(asset => {
            hex.push(swapEndianness(asset.category)); // 32 bytes
            hex.push(binToHex(bigIntToBinUint64LEClamped(asset.amount))); // 8 bytes
        });
        return hexToBin(hex.join(''));
    }

    hashFund = (fund) => binToHex(hash256(this.getFundHex(fund)));

    // build and get the contracts for this fund
    buildContracts(fund) {
        const {
            category,
            amount,
            assets,
        } = fund;
        const fundHash = this.hashFund(fund);

        const assetContracts = [];
        assets.forEach(a => {
            const fundAssetCategory = swapEndianness(a.category);

            // 32 32 32
            const assetContract = new Contract(assetJson, [this.outflowCategorySwapped, fundHash, fundAssetCategory], { provider: this.provider });

            assetContracts.push(assetContract);
        });

        // 32 32 32 32 + 4 128 132 * 2 264
        const fundContract = new Contract(fundJson, [this.inflowCategorySwapped, this.outflowCategorySwapped, swapEndianness(category), fundHash], { provider: this.provider });
        
        const managerContract = new Contract(managerJson, [
            this.inflowCategorySwapped,
            this.outflowCategorySwapped,
            fundContract.bytecode.slice(264),
            assetContracts[0].bytecode.slice(198),
            swapEndianness(category),
            fundHash,
        ], { provider: this.provider });

        return { managerContract, fundContract, assetContracts };
    }

    // return a new transaction builder with a built mint transaction
    async newMintTransaction({
        fund,
        // user: { // add user utxos and change to the address
        //     utxos,
        //     address,
        // }
    }) {
        const transactionBuilder = new FundTokenTransactionBuilder({ provider });
        await transactionBuilder.addMint(fund);
        return transactionBuilder;
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
        this.#logger.log('transaction builder...adding minting transaction');

        const { managerContract, fundContract, assetContracts } = this.buildContracts(fund);

        const inflowUtxo = (await managerContract.getUtxos()).filter(u => u.token?.category === this.inflowCategory)[0];
        const fundUtxo = (await fundContract.getUtxos()).filter(u => u.token?.category === fundCategory)[0];

        if (!inflowUtxo || !fundUtxo) {
            throw new Error('Missing required UTXO');
        }

        const mintAmount = fundAmount * amount;
        const fundChangeAmount = fundUtxo.token.amount - mintAmount;

        this.#logger.log('testing', fund);

        this.addInput(inflowUtxo, managerContract.unlock.inflow(this.getFundHex(fund)))
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
        this.#logger.log('finished adding mint transaction i/o');
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
            satoshis, // TODO: BCH being locked
            assets: fundAssets, // category, amount
        },
    }) {
        this.#logger.log('transaction builder...adding redemption transaction');

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

        this.addInput(outflowUtxo, managerContract.unlock.outflow(this.getFundHex(fund)))
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

        this.#logger.log('asset change amounts', assetChangeAmounts);

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
            this.#logger.log('adding output change');
            this.addOutput({
                to: assetContracts[i].tokenAddress,
                amount: DustAmount,
                token: {
                    category: fundAssets[i].category,
                    amount: assetChangeAmounts[i],
                },
            });
        }

        this.#logger.log('finished adding redemption transaction i/o');
        return this;
    }
}