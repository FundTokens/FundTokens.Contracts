import {
    Contract,
    TransactionBuilder,
} from 'cashscript';
import {
    swapEndianness,
    hash256,
    hexToBin,
    binToHex,
} from '@bitauth/libauth';
import {
    getFundBin,
    hashFund,
    getBestFee,
} from './utils.js';

import managerJson from './art/manager.json' with { type: 'json' };
import fundJson from './art/fund.json' with { type: 'json' };
import assetJson from './art/asset.json' with { type: 'json' };
import feeJson from './art/fee.json' with { type: 'json' };

const DustAmount = 1000n;

const sortDecreasingTokenAmount = (a, b) => b.token?.amount - a.token?.amount;

const getRandomInt = max => Math.floor(Math.random() * max);

export default class FundTokenTransactionBuilder extends TransactionBuilder {
    #system = {
        inflow: '',
        inflowSwapped: '',
        outflow: '',
        outflowSwapped: '',
        fee: {
            pubKey: '',
            pubKeySwapped: '',
            nft: '',
            nftSwapped: '',
            value: -1,
        },
    };
    #logger = null;

    constructor({
        provider,
        system,
        logger,
    }) {
        if (!system) {
            throw new Error('No system configuration provided, unable to continue');
        }
        super({ provider });
        this.#system = system;
        this.#system.inflowSwapped = swapEndianness(system.inflow);
        this.#system.outflowSwapped = swapEndianness(system.outflow);
        this.#system.pubKeySwapped = swapEndianness(system.fee.pubKey);
        this.#system.fee.nftSwapped = swapEndianness(system.fee.nft);

        this.#logger = logger ?? console;
    }

    // build and get the contracts for this fund
    buildFeeContract() {
        const {
            pubKey,
            nftSwapped,
            value,
        } = this.#system.fee;
        const feeContract = new Contract(feeJson, [pubKey, nftSwapped, value], { provider: this.provider });

        return { feeContract };
    }

    // build and get the contracts for this fund
    buildFundContracts(fund) {
        const {
            category,
            assets,
        } = fund;
        const fundHash = hashFund(fund);

        const assetContracts = [];
        assets.forEach(a => {
            const fundAssetCategory = swapEndianness(a.category);

            // 32 32 32
            const assetContract = new Contract(assetJson, [this.#system.outflowSwapped, fundHash, fundAssetCategory], { provider: this.provider });

            assetContracts.push(assetContract);
        });

        // 32 32 32 32 + 4 128 132 * 2 264
        const fundContract = new Contract(fundJson, [this.#system.inflowSwapped, this.#system.outflowSwapped, swapEndianness(category), fundHash], { provider: this.provider });

        const { feeContract } = this.buildFeeContract();

        const managerContract = new Contract(managerJson, [
            binToHex(hash256(hexToBin(feeContract.bytecode))),
            this.#system.inflowSwapped,
            this.#system.outflowSwapped,
            swapEndianness(category),
            fundHash,
            hexToBin(fundJson.debug.bytecode),
            hexToBin(assetJson.debug.bytecode),
        ], { provider: this.provider });

        return { managerContract, fundContract, assetContracts, feeContract };
    }

    // return a new transaction builder with a built mint transaction
    async newMintTransaction({
        amount,
        fund,
        payBy,
    }) {
        const transactionBuilder = new FundTokenTransactionBuilder({ provider: this.provider, system: this.#system, logger: this.#logger });
        await transactionBuilder.addMint({ amount, fund, payBy });
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
        payBy,
    }) {
        this.#logger.log('transaction builder...adding minting transaction');

        const { managerContract, fundContract, assetContracts, feeContract } = this.buildFundContracts(fund);

        const inflowUtxos = (await managerContract.getUtxos()).filter(u => u.token?.category === this.#system.inflow);
        const fundUtxos = (await fundContract.getUtxos()).filter(u => u.token?.category === fundCategory);
        const bestFee = await getBestFee({ feeContract, payBy, fee: this.#system.fee });

        if (!inflowUtxos?.length || !fundUtxos?.length || !bestFee) {
            this.#logger.error('Missing required UTXO', !inflowUtxos?.length, !fundUtxos?.length, !bestFee);
            throw new Error('Missing required UTXO');
        }

        const inflowUtxo = inflowUtxos[getRandomInt(inflowUtxos.length)];
        const fundUtxo = fundUtxos[getRandomInt(fundUtxos.length)];
        const feeUtxo = bestFee.utxo;

        const mintAmount = fundAmount * amount;
        const fundChangeAmount = fundUtxo.token.amount - mintAmount;

        this.addInputs([
            {
                ...inflowUtxo,
                unlocker: managerContract.unlock.inflow(getFundBin(fund)),
            },
            {
                ...fundUtxo,
                unlocker: fundContract.unlock.mint(),
            },
            {
                ...feeUtxo,
                unlocker: feeContract.unlock.pay(),
            }
        ])
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
                token: fundChangeAmount <= 0 ? null : { // TODO: bug here?!
                    category: fundCategory,
                    amount: fundChangeAmount,
                },
            },
            {
                to: feeContract.tokenAddress,
                amount: feeUtxo.satoshis,
                // token: !feeUtxo.token ? null : {
                //     ...feeUtxo.token,
                // }
            },
            { // TODO verify IMPLEMENTATION
                to: bestFee.destination ? bestFee.destination : this.#system.fee.pubKey,
                amount: bestFee.isBitcoin ? bestFee.amount : DustAmount,
                // token: bestFee.isBitcoin ? null : {
                //     category: bestFee.category,
                //     amount: bestFee.amount,
                // }
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

    // return a new transaction builder with a built redeem transaction
    async newRedeemTransaction({
        amount,
        fund,
        payBy,
    }) {
        const transactionBuilder = new FundTokenTransactionBuilder({ provider: this.provider, system: this.#system, logger: this.#logger });
        await transactionBuilder.addRedeem({ amount, fund, payBy });
        return transactionBuilder;
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
        payBy,
    }) {
        this.#logger.log('transaction builder...adding redemption transaction');

        const { managerContract, fundContract, assetContracts, feeContract } = this.buildFundContracts(fund);

        //
        const outflowUtxos = (await managerContract.getUtxos()).filter(u => u.token?.category === this.#system.outflow);
        if (!outflowUtxos.length) {
            throw new Error(`Missing required outflow ${this.#system.outflow} UTXO.`);
        }
        const outflowUtxo = outflowUtxos[0];


        //
        const fundUtxos = await fundContract.getUtxos();

        if (!fundUtxos.length) {
            throw new Error(`Missing required fund ${fundCategory} UTXO. Send dust UTXO to contract and redeem again.`)
        }

        const existingFundUtxo = fundUtxos.filter(u => u.token?.category === fundCategory).sort(sortDecreasingTokenAmount);
        const fundUtxo = existingFundUtxo.length ? existingFundUtxo[getRandomInt(existingFundUtxo.length)] : fundUtxos[getRandomInt(fundUtxos.length)];


        //
        const redeemAmount = fundAmount * amount;
        const updatedFundAmount = fundUtxo.token?.amount + redeemAmount;

        const bestFee = await getBestFee({ feeContract, payBy, fee: this.#system.fee });
        const feeUtxo = bestFee.utxo;

        const assetInputs = [];
        const assetOutputs = [];

        
        const assetChangeAmounts = [];
        for (let i = 0; i < assetContracts.length; ++i) {
            const assetUtxos = (await assetContracts[i].getUtxos()).filter(u => u.token?.category === fundAssets[i].category).sort(sortDecreasingTokenAmount);
            if (!assetUtxos.length) {
                throw new Error(`Missing required asset '${fundAssets[i].category}' UTXO`);
            }
            let tokenAmountAdded = 0n;
            for (let j = 0; j < assetUtxos.length; ++j) {
                assetInputs.push({
                    ...assetUtxos[j],
                    unlocker: assetContracts[i].unlock.release()
                });
                tokenAmountAdded += assetUtxos[j].token.amount;
                if (tokenAmountAdded >= amount * fundAssets[i].amount) {
                    assetChangeAmounts.push(tokenAmountAdded - (amount * fundAssets[i].amount));
                    break;
                }
            }
        }
        
        for (let i = 0; i < assetChangeAmounts.length; ++i) {
            if (!assetChangeAmounts[i]) {
                continue;
            }
            this.#logger.log('adding output change');
            assetOutputs.push({
                to: assetContracts[i].tokenAddress,
                amount: DustAmount,
                token: {
                    category: fundAssets[i].category,
                    amount: assetChangeAmounts[i],
                },
            });
        }

        this.addInputs([
            {
                ...outflowUtxo,
                unlocker: managerContract.unlock.outflow(getFundBin(fund))
            },
            {
                ...fundUtxo,
                unlocker: fundContract.unlock.redeem()
            },
            {
                ...feeUtxo,
                unlocker: feeContract.unlock.pay()
            },
            ...assetInputs
        ])
        .addOutputs([
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
            {
                to: feeContract.tokenAddress,
                amount: feeUtxo.satoshis,
                // token: !feeUtxo.token ? null : {
                //     ...feeUtxo.token,
                // }
            },
            { // TODO verify IMPLEMENTATION
                to: bestFee.destination ? bestFee.destination : this.#system.fee.pubKey,
                amount: bestFee.isBitcoin ? bestFee.amount : DustAmount,
                // token: bestFee.isBitcoin ? null : {
                //     category: bestFee.category,
                //     amount: bestFee.amount,
                // }
            },
            ...assetOutputs
        ]);

        this.#logger.log('finished adding redemption transaction i/o');
        return this;
    }
}