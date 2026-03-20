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
import { BitcoinCategory, DustAmount } from './constants.js';
import {
    getFundBin,
    hashFund,
    getBestFee,
    getRandomInt,
} from './utils.js';

import managerJson from './art/manager.json' with { type: 'json' };
import fundJson from './art/fund.json' with { type: 'json' };
import assetJson from './art/asset.json' with { type: 'json' };
import feeJson from './art/fee.json' with { type: 'json' };

const sortDecreasingTokenAmount = (a, b) => b.token?.amount - a.token?.amount;

export default class FundTokenTransactionBuilder extends TransactionBuilder {
    #system = {
        inflow: '', // 32 byte, tx id/token id
        outflow: '', // 32 byte, tx id/token id
        publicFund: '', // 32 byte, tx id/token id
        authHead: '', // public key hash
        owner: '', // public key
        fee: {
            nft: '', // 32 byte, tx id/token id
            value: -1n, // bigint
        },
    };
    #swapped = {
        inflow: '',
        outflow: '',
        fee: {
            nft: '',
        },
    };
    #fund = {
        category: '',
        amount: -1n,
        satoshis: -1n,
        assets: null,
    };
    #meta = {
        isBitcoinFund: false,
    };
    #contracts = {
        managerContract: null,
        fundContract: null,
        satoshiAssetContract: null,
        assetContracts: null,
        feeContract: null,
    };
    #logger = null;

    constructor({
        provider,
        system,
        logger,
        fund,
    }) {
        if (!system) {
            throw new Error('No system configuration provided, unable to continue');
        }
        super({ provider });
        this.#system = system;
        this.#swapped = {
            inflow: swapEndianness(system.inflow),
            outflow: swapEndianness(system.outflow),
            fee: {
                nft: swapEndianness(system.fee.nft),
            },
        };
        this.#fund = fund;
        this.#meta = {
            isBitcoinFund: this.#fund.satoshis > 0,
        };
        this.#logger = logger ?? console;
        this.#buildContracts();
    }

    // build and get the contracts for this fund
    #buildContracts() {
        const {
            category,
            assets,
        } = this.#fund;
        const fundHash = hashFund(this.#fund);

        const assetContracts = [];
        
        let satoshiAssetContract = undefined;
        if(this.#fund.satoshis > 0) {
            satoshiAssetContract = new Contract(assetJson, [this.#swapped.outflow, fundHash, BitcoinCategory], { provider: this.provider });
        }

        assets.forEach(a => {
            const fundAssetCategory = swapEndianness(a.category);
            
            // 32 32 32
            const assetContract = new Contract(assetJson, [this.#swapped.outflow, fundHash, fundAssetCategory], { provider: this.provider });
            
            assetContracts.push(assetContract);
        });

        // 32 32 32 32 + 4 128 132 * 2 264
        const fundContract = new Contract(fundJson, [this.#swapped.inflow, this.#swapped.outflow, swapEndianness(category), fundHash], { provider: this.provider });

        const feeContract = new Contract(feeJson, [this.#system.owner, this.#swapped.fee.nft, this.#system.fee.value], { provider: this.provider });

        const managerContract = new Contract(managerJson, [
            binToHex(hash256(hexToBin(feeContract.bytecode))),
            this.#swapped.inflow,
            this.#swapped.outflow,
            swapEndianness(category),
            fundHash,
            hexToBin(fundJson.debug.bytecode),
            hexToBin(assetJson.debug.bytecode),
        ], { provider: this.provider });

        this.#contracts = { managerContract, fundContract, assetContracts, feeContract, satoshiAssetContract };
    }

    getContracts() {
        return this.#contracts;
    }

    // TODO: Scaling fund UTXO selection
    // As new threads are added to the fund token contract, we should select for inflow tx the UTXO with the most tokens
    // Although this means we still target one thread, should have a range maybe and then randomly select
    // Maybe should just randomly select enough to fulfills the needs for the tx

    // This method should be called while the transaction has same transaction input and output lengths
    // The consuming app is responsible for adding an output for Bitcoin change, fund token minted, and token change
    async addInflow({
        amount,
        payBy,
    }) {
        this.#logger.log('transaction builder...adding minting transaction');

        const { managerContract, fundContract, assetContracts, feeContract } = this.#contracts;

        const inflowUtxos = (await managerContract.getUtxos()).filter(u => u.token?.category === this.#system.inflow);
        const fundUtxos = (await fundContract.getUtxos()).filter(u => u.token?.category === this.#fund.category);
        const bestFee = await getBestFee({ feeContract, payBy, fee: this.#system.fee, owner: this.#system.owner });

        if (!inflowUtxos?.length || !fundUtxos?.length || !bestFee) {
            this.#logger.error('Missing required UTXO', !inflowUtxos?.length, !fundUtxos?.length, !bestFee);
            throw new Error('Missing required UTXO');
        }

        const inflowUtxo = inflowUtxos[getRandomInt(inflowUtxos.length)];
        const fundUtxo = fundUtxos[getRandomInt(fundUtxos.length)];
        const feeUtxo = bestFee.utxo;

        const inflowAmount = this.#fund.amount * amount;
        const fundChangeAmount = fundUtxo.token.amount - inflowAmount;

        const fundContractOutput = fundChangeAmount > 0 ? {
            to: fundContract.tokenAddress,
            amount: DustAmount,
            token: {
                category: this.#fund.category,
                amount: fundChangeAmount,
            },
        } : {
            to: fundContract.tokenAddress,
            amount: DustAmount,
        };

        const bitcoinOutputs = [];
        this.#meta.isBitcoinFund && bitcoinOutputs.push({ to: this.#contracts.satoshiAssetContract.tokenAddress, amount: this.#fund.satoshis * amount });

        this.addInputs([
            {
                ...inflowUtxo,
                unlocker: managerContract.unlock.inflow(getFundBin(this.#fund)),
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
                amount: DustAmount,
                token: {
                    ...inflowUtxo.token,
                },
            },
            fundContractOutput,
            ...bestFee.outputs,
            ...bitcoinOutputs,
            ...assetContracts.map((assetContract, i) => {
                return {
                    to: assetContract.tokenAddress,
                    amount: DustAmount,
                    token: {
                        category: this.#fund.assets[i].category,
                        amount: this.#fund.assets[i].amount * amount,
                    }
                };
            }),
        ]);
        this.#logger.log('finished adding mint transaction i/o');
        return this;
    }

    // TODO: Scaling fund UTXO selection
    // As new threads are added to the fund token contract, we should select for outflow tx the UTXO with the least tokens
    // Although this means we still target one thread, should have a range maybe and then randomly select
    // Maybe should just randomly select one that fulfills the needs

    // This method should be called while the transaction has same transaction input and output lengths
    // The consuming user is responsible for adding inputs for the fund token
    // The consuming app is responsible for adding an outputs for Bitcoin change and token change
    async addOutflow({
        amount,
        payBy,
    }) {
        this.#logger.log('transaction builder...adding redemption transaction');

        const { managerContract, fundContract, assetContracts, feeContract, satoshiAssetContract } = this.#contracts;

        //
        const outflowUtxos = (await managerContract.getUtxos()).filter(u => u.token?.category === this.#system.outflow);
        if (!outflowUtxos.length) {
            throw new Error(`Missing required outflow ${this.#system.outflow} UTXO.`);
        }
        const outflowUtxo = outflowUtxos[0];


        //
        const fundUtxos = await fundContract.getUtxos();

        if (!fundUtxos.length) {
            throw new Error(`Missing required fund ${this.#fund.category} UTXO. Send dust UTXO to contract and redeem again.`)
        }

        const existingFundUtxo = fundUtxos.filter(u => u.token?.category === this.#fund.category).sort(sortDecreasingTokenAmount);
        const fundUtxo = existingFundUtxo.length ? existingFundUtxo[getRandomInt(existingFundUtxo.length)] : fundUtxos[getRandomInt(fundUtxos.length)];


        //
        const outflowAmount = this.#fund.amount * amount;
        const updatedFundAmount = fundUtxo.token?.amount + outflowAmount;

        const bestFee = await getBestFee({ feeContract, payBy, fee: this.#system.fee, owner: this.#system.owner });
        const feeUtxo = bestFee.utxo;

        const satoshiAssetInputs = [];
        const satoshiAssetOutputs = [];
        const satoshiAssetChangeAmounts = [];

        if (this.#meta.isBitcoinFund) {
            const satoshiAssetUtxos = (await satoshiAssetContract.getUtxos()).filter(u => !u.token);
            if(!satoshiAssetUtxos) {
                throw new Error('Missing required satoshi asset UTXO');
            }
            let satoshiAmountAdded = 0n;
            for (let index = 0; index < satoshiAssetUtxos.length; ++index) {
                satoshiAssetInputs.push({
                    ...satoshiAssetUtxos[index],
                    unlocker: this.#contracts.satoshiAssetContract.unlock.release()
                });
                satoshiAmountAdded += satoshiAssetUtxos[index].satoshis;
                if (satoshiAmountAdded >= amount * this.#fund.satoshis) {
                    satoshiAssetChangeAmounts.push(satoshiAmountAdded - (amount * this.#fund.satoshis));
                    break;
                }
            }
        }

        for (let i = 0; i < satoshiAssetChangeAmounts.length; ++i) {
            if (!satoshiAssetChangeAmounts[i]) {
                continue;
            }
            this.#logger.log('adding satoshi output change');
            satoshiAssetOutputs.push({
                to: satoshiAssetContract.tokenAddress,
                amount: satoshiAssetChangeAmounts[i],
            });
        }


        const assetInputs = [];
        const assetOutputs = [];
        const assetChangeAmounts = [];

        for (let i = 0; i < assetContracts.length; ++i) {
            const assetUtxos = (await assetContracts[i].getUtxos()).filter(u => u.token?.category === this.#fund.assets[i].category).sort(sortDecreasingTokenAmount);
            if (!assetUtxos.length) {
                throw new Error(`Missing required asset '${this.#fund.assets[i].category}' UTXO`);
            }
            let tokenAmountAdded = 0n;
            for (let j = 0; j < assetUtxos.length; ++j) {
                assetInputs.push({
                    ...assetUtxos[j],
                    unlocker: assetContracts[i].unlock.release()
                });
                tokenAmountAdded += assetUtxos[j].token.amount;
                if (tokenAmountAdded >= amount * this.#fund.assets[i].amount) {
                    assetChangeAmounts.push(tokenAmountAdded - (amount * this.#fund.assets[i].amount));
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
                    category: this.#fund.assets[i].category,
                    amount: assetChangeAmounts[i],
                },
            });
        }

        this.addInputs([
            {
                ...outflowUtxo,
                unlocker: managerContract.unlock.outflow(getFundBin(this.#fund))
            },
            {
                ...fundUtxo,
                unlocker: fundContract.unlock.redeem()
            },
            {
                ...feeUtxo,
                unlocker: feeContract.unlock.pay()
            },
            ...satoshiAssetInputs,
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
                    category: this.#fund.category,
                    amount: updatedFundAmount,
                },
            },
            ...bestFee.outputs,
            ...satoshiAssetOutputs,
            ...assetOutputs
        ]);

        this.#logger.log('finished adding redemption transaction i/o');
        return this;
    }
}