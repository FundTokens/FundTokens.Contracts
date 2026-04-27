import {
    Contract,
    TransactionBuilder,
} from 'cashscript';
import {
    swapEndianness,
    hash256,
    hexToBin,
    binToHex,
    cashAddressToLockingBytecode,
} from '@bitauth/libauth';
import { BitcoinCategory } from './constants.js';
import {
    getFundBin,
    hashFund,
    getBestFee,
    getRandomInt,
    withDust,
    categoryAscending,
} from './utils.js';

import managerJson from './art/manager.json' with { type: 'json' };
import fundJson from './art/fund.json' with { type: 'json' };
import assetJson from './art/asset.json' with { type: 'json' };
import feeJson from './art/fee.json' with { type: 'json' };
import simpleVaultJson from './art/simple_vault.json' with { type: 'json' };

const sortDecreasingTokenAmount = (a, b) => b.token?.amount - a.token?.amount;

export default class FundTokenTransactionBuilder extends TransactionBuilder {
    #system = {
        inflow: '', // 32 byte, token id
        outflow: '', // 32 byte, token id
        authorization: '', // 32 byte, token id
        fee: {
            nft: '', // 32 byte, token id
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
        feeVaultContract: null
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
        this.#system = {
            ...system,
        };
        this.#swapped = {
            inflow: swapEndianness(system.inflow),
            outflow: swapEndianness(system.outflow),
            authorization: swapEndianness(system.authorization),
            fee: {
                nft: swapEndianness(system.fee.nft),
            },
        };
        this.#fund = {
            ...fund,
            assets: [...fund.assets.map(a => ({ ...a })).sort(categoryAscending)] ?? [],
        };
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
        if (this.#fund.satoshis > 0) {
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

        const feeVaultContract = new Contract(simpleVaultJson, [this.#swapped.authorization], { provider: this.provider });
        const feeVaultLockingBytecode = binToHex(cashAddressToLockingBytecode(feeVaultContract.tokenAddress).bytecode);
        const feeContract = new Contract(feeJson, [this.#swapped.authorization, feeVaultLockingBytecode, this.#swapped.fee.nft, BigInt(this.#system.fee.value)], { provider: this.provider });

        const managerContract = new Contract(managerJson, [
            binToHex(hash256(hexToBin(feeContract.bytecode))),
            this.#swapped.inflow,
            this.#swapped.outflow,
            swapEndianness(category),
            fundHash,
            hexToBin(fundJson.debug.bytecode),
            hexToBin(assetJson.debug.bytecode),
        ], { provider: this.provider });

        this.#contracts = { managerContract, fundContract, assetContracts, feeContract, satoshiAssetContract, feeVaultContract };
    }

    getContracts() {
        return this.#contracts;
    }

    /**
     * addInflow(amount, payBy): Builds a fund token minting transaction
     * 
     * Randomly selects:
     * - One inflow thread (for thread distribution)
     * - Multiple fund UTXOs to cover the minting amount (reduces collision)
     * - Best fee option (Bitcoin or token-based)
     * 
     * Constructs transaction with:
     * - Inflow manager input + output (threaded signal)
     * - Fund UTXO inputs collected randomly + outputs (one per input)
     * - Fee validation and routing
     * - Asset custody outputs (prepared for user deposit)
     * 
     * The consuming app is responsible for:
     * - Adding user inputs (assets to deposit)
     * - Adding user outputs (fund tokens minted, Bitcoin change, token change)
     */
    async addInflow({
        amount,
        payBy,
    }) {
        this.#logger.log('transaction builder...adding minting transaction', amount, payBy);

        const { managerContract, fundContract, assetContracts, feeContract, feeVaultContract } = this.#contracts;

        const inflowUtxos = (await managerContract.getUtxos()).filter(u => u.token?.category === this.#system.inflow);
        const fundUtxos = (await fundContract.getUtxos()).filter(u => u.token?.category === this.#fund.category);
        const bestFee = await getBestFee({ feeVaultContract, feeContract, payBy, fee: this.#system.fee, authorization: this.#system.authorization });

        if (!inflowUtxos?.length || !fundUtxos?.length || !bestFee) {
            this.#logger.error('Missing required UTXO', !inflowUtxos?.length, !fundUtxos?.length, !bestFee);
            throw new Error('Missing required UTXO');
        }

        const inflowUtxo = inflowUtxos[getRandomInt(inflowUtxos.length)];
        const feeUtxo = bestFee.utxo;

        const inflowAmount = this.#fund.amount * amount;

        // Randomly select fund UTXOs to cover the inflow amount
        // Shuffle to reduce collision chances when multiple transactions are building
        const shuffledFundUtxos = [...fundUtxos].sort(() => Math.random() - 0.5);
        let totalFundAmount = 0n;
        const selectedFundUtxos = [];

        for (const utxo of shuffledFundUtxos) {
            selectedFundUtxos.push(utxo);
            totalFundAmount += utxo.token.amount;

            if (totalFundAmount >= inflowAmount) {
                break;
            }
        }

        if (totalFundAmount < inflowAmount) {
            throw new Error(`Insufficient fund tokens: need ${inflowAmount}, have ${totalFundAmount}`);
        }

        const fundChangeAmount = totalFundAmount - inflowAmount;


        // Create one input per selected UTXO
        const fundInputs = selectedFundUtxos.map(utxo => ({
            ...utxo,
            unlocker: fundContract.unlock.mint(),
        }));

        // Create one output per input (maintain input/output balance)
        // First output contains any change, others are dust returns
        const fundOutputs = selectedFundUtxos.map((utxo, index) => {
            if (index === 0 && fundChangeAmount > 0) {
                // Last output: return change to contract
                return withDust({
                    to: fundContract.tokenAddress,
                    token: {
                        category: this.#fund.category,
                        amount: fundChangeAmount,
                    },
                });
            } else {
                // Other outputs: return as dust
                return withDust({
                    to: fundContract.tokenAddress,
                });
            }
        });

        const bitcoinOutputs = [];
        this.#meta.isBitcoinFund && bitcoinOutputs.push({ to: this.#contracts.satoshiAssetContract.tokenAddress, amount: this.#fund.satoshis * amount });

        this.addInputs([
            {
                ...inflowUtxo,
                unlocker: managerContract.unlock.inflow(getFundBin(this.#fund)),
            },
            {
                ...feeUtxo,
                unlocker: feeContract.unlock.pay(),
            },
            ...fundInputs,
        ])
            .addOutputs([
                withDust({
                    to: managerContract.tokenAddress,
                    token: {
                        ...inflowUtxo.token,
                    },
                }),
                ...bestFee.outputs,
                ...fundOutputs,
                ...bitcoinOutputs,
                ...assetContracts.map((assetContract, i) => {
                    return withDust({
                        to: assetContract.tokenAddress,
                        token: {
                            category: this.#fund.assets[i].category,
                            amount: this.#fund.assets[i].amount * amount,
                        }
                    });
                }),
            ]);
        this.#logger.log('finished adding mint transaction i/o');
        return this;
    }

    /**
     * addOutflow(amount, payBy): Builds a fund token redemption transaction
     * 
     * Randomly selects:
     * - One outflow thread (for thread distribution)
     * - A fund UTXO to collect redeemed tokens into
     * - Best fee option (Bitcoin or token-based)
     * - Asset UTXOs from each asset contract (largest first)
     * - Satoshi UTXOs if fund includes Bitcoin (largest first)
     * 
     * Constructs transaction with:
     * - Outflow manager input + output (threaded signal)
     * - Fund UTXO input + output (collects redeemed tokens)
     * - Fee validation and routing
     * - Asset release inputs + outputs (with change handling)
     * - Satoshi release inputs + outputs (with change handling)
     * 
     * The consuming app is responsible for:
     * - Adding user inputs (fund tokens to redeem)
     * - Adding user outputs (underlying assets received, change)
     */
    async addOutflow({
        amount,
        payBy,
    }) {
        this.#logger.log('transaction builder...adding redemption transaction');

        const { managerContract, fundContract, assetContracts, feeContract, satoshiAssetContract, feeVaultContract } = this.#contracts;

        //
        const outflowUtxos = (await managerContract.getUtxos()).filter(u => u.token?.category === this.#system.outflow);
        if (!outflowUtxos.length) {
            throw new Error(`Missing required outflow ${this.#system.outflow} UTXO.`);
        }
        const outflowUtxo = outflowUtxos[getRandomInt(outflowUtxos.length)];

        const fundUtxos = await fundContract.getUtxos();

        if (!fundUtxos.length) {
            throw new Error(`Missing required fund ${this.#fund.category} UTXO. Send dust UTXO to contract and redeem again.`)
        }

        const existingFundUtxo = fundUtxos.filter(u => u.token?.category === this.#fund.category);
        const fundUtxo = existingFundUtxo.length ? existingFundUtxo[getRandomInt(existingFundUtxo.length)] : fundUtxos[getRandomInt(fundUtxos.length)];

        //
        const outflowAmount = this.#fund.amount * amount;
        const updatedFundAmount = (fundUtxo.token?.amount ?? 0n) + outflowAmount;

        const bestFee = await getBestFee({ feeVaultContract, feeContract, payBy, fee: this.#system.fee });
        const feeUtxo = bestFee.utxo;


        const fundInputs = [{
            ...fundUtxo,
            unlocker: fundContract.unlock.redeem()
        }];
        const fundOutputs = [withDust({
            to: fundContract.tokenAddress,
            token: {
                category: this.#fund.category,
                amount: updatedFundAmount,
            },
        })];

        const satoshiAssetInputs = [];
        const satoshiAssetOutputs = [];
        const satoshiAssetChangeAmounts = [];

        const calcSatoshiAsset = async () => {
            if (this.#meta.isBitcoinFund) {
                const satoshiAssetUtxos = (await satoshiAssetContract.getUtxos()).filter(u => !u.token);
                if (!satoshiAssetUtxos) {
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
            }
        };

        await calcSatoshiAsset();

        const assetInputs = [];
        const assetOutputs = [];
        const assetChangeAmounts = [];

        const calcTokenAssets = async () => {
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
                assetOutputs.push(withDust({
                    to: assetContracts[i].tokenAddress,
                    token: {
                        category: this.#fund.assets[i].category,
                        amount: assetChangeAmounts[i],
                    },
                }));
            }
        }

        await calcTokenAssets();

        this.addInputs([
            {
                ...outflowUtxo,
                unlocker: managerContract.unlock.outflow(getFundBin(this.#fund))
            },
            {
                ...feeUtxo,
                unlocker: feeContract.unlock.pay()
            },
            ...fundInputs,
            ...satoshiAssetInputs,
            ...assetInputs,
        ])
            .addOutputs([
                withDust({
                    to: managerContract.tokenAddress,
                    token: {
                        ...outflowUtxo.token,
                    },
                }),
                ...bestFee.outputs,
                ...fundOutputs,
                ...satoshiAssetOutputs,
                ...assetOutputs
            ]);

        this.#logger.log('finished adding redemption transaction i/o');
        return this;
    }
}