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
import {
    getBestFee,
    getFundBin,
    getFundHex,
    getRandomInt,
    withDust,
} from './utils.js';
import FundTokenTransactionBuilder from './FundTokenTransactionBuilder.js';

import feeJson from './art/fee.json' with { type: 'json' };
import startupJson from './art/startup.json' with { type: 'json' };
import mintInflowJson from './art/mint_inflow.json' with { type: 'json' };
import mintOutflowJson from './art/mint_outflow.json' with { type: 'json' };
import managerJson from './art/manager.json' with { type: 'json' };
import fundJson from './art/fund.json' with { type: 'json' };
import assetJson from './art/asset.json' with { type: 'json' };
import publicJson from './art/public.json' with { type: 'json' };
import simpleVaultJson from './art/simple_vault.json' with { type: 'json' };
import authHeadVaultJson from './art/authhead_vault.json' with { type: 'json' };
import publicFundVaultJson from './art/public_vault.json' with { type: 'json' };

export default class PublicFundTransactionBuilder extends TransactionBuilder {
    #system = {
        inflow: '', // 32 byte, token id
        outflow: '', // 32 byte, token id
        publicFund: '', // 32 byte, token id
        authorization: '', // 32 byte, token id
        fees: {
            create: {
                nft: '', // 32 byte, tx id/token id
                value: -1n, // bigint
            },
            execute: {
                nft: '', // 32 byte, tx id/token id
                value: -1n, // bigint
            }
        },
    };
    #swapped = {
        inflow: '',
        outflow: '',
        publicFund: '',
        authorization: '',
        fees: {
            create: {
                nft: '',
            },
            execute: {
                nft: '',
            },
        },
    };
    #contracts = {
        startupContract: null,
        mintInflowContract: null,
        mintOutflowContract: null,
        createFundFeeContract: null,
        executeFundFeeContract: null,
        publicFundContract: null,
        feeVaultContract: null,
        authHeadVaultContract: null,
        publicFundVaultContract: null,
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
        this.#swapped = {
            inflow: swapEndianness(system.inflow),
            outflow: swapEndianness(system.outflow),
            publicFund: swapEndianness(system.publicFund),
            authorization: swapEndianness(system.authorization),
            fees: {
                create: {
                    nft: swapEndianness(system.fees.create.nft),
                },
                execute: {
                    nft: swapEndianness(system.fees.execute.nft),
                }
            }
        };
        this.#logger = logger ?? this.#logger;
        this.#buildContracts();
    }

    // build and get the contracts
    #buildContracts() {
        const feeVaultContract = new Contract(simpleVaultJson, [this.#swapped.authorization], { provider: this.provider });
        const feeVaultLockingBytecode = binToHex(cashAddressToLockingBytecode(feeVaultContract.tokenAddress).bytecode);

        const createFundFeeContract = new Contract(feeJson, [this.#swapped.authorization, feeVaultLockingBytecode, this.#swapped.fees.create.nft, BigInt(this.#system.fees.create.value)], { provider: this.provider });
        const executeFundFeeContract = new Contract(feeJson, [this.#swapped.authorization, feeVaultLockingBytecode, this.#swapped.fees.execute.nft, BigInt(this.#system.fees.execute.value)], { provider: this.provider });

        const startupContract = new Contract(startupJson, [
            binToHex(hash256(hexToBin(createFundFeeContract.bytecode))),
            this.#swapped.inflow,
            this.#swapped.outflow,
        ], { provider: this.provider });
        const startupContractHash = binToHex(hash256(hexToBin(startupContract.bytecode)))

        const mintInflowContract = new Contract(mintInflowJson, [
            startupContractHash,
            this.#swapped.inflow,
            this.#swapped.outflow,
            binToHex(hash256(hexToBin(executeFundFeeContract.bytecode))),
            hexToBin(managerJson.debug.bytecode),
            hexToBin(fundJson.debug.bytecode),
            hexToBin(assetJson.debug.bytecode),
        ], { provider: this.provider });

        const mintOutflowContract = new Contract(mintOutflowJson, [
            startupContractHash,
            this.#swapped.inflow,
            this.#swapped.outflow,
            binToHex(hash256(hexToBin(executeFundFeeContract.bytecode))),
            hexToBin(managerJson.debug.bytecode),
            hexToBin(fundJson.debug.bytecode),
            hexToBin(assetJson.debug.bytecode),
        ], { provider: this.provider });

        const authHeadVaultContract = new Contract(authHeadVaultJson, [this.#swapped.authorization], { provider: this.provider });
        const authHeadVaultLockingBytecode = binToHex(cashAddressToLockingBytecode(authHeadVaultContract.tokenAddress).bytecode);

        const publicFundVaultContract = new Contract(publicFundVaultJson, [this.#swapped.publicFund, this.#swapped.authorization], { provider: this.provider });
        const publicFundVaultLockingBytecode = binToHex(cashAddressToLockingBytecode(publicFundVaultContract.tokenAddress).bytecode);

        const publicFundContract = new Contract(publicJson, [
            authHeadVaultLockingBytecode,
            publicFundVaultLockingBytecode,
            this.#swapped.publicFund,
            startupContractHash,
            fundJson.debug.bytecode,
            this.#swapped.inflow,
            this.#swapped.outflow,
        ], { provider: this.provider });


        this.#contracts = {
            startupContract,
            mintInflowContract,
            mintOutflowContract,
            createFundFeeContract,
            executeFundFeeContract,
            publicFundContract,
            feeVaultContract,
            authHeadVaultContract,
            publicFundVaultContract,
        };
    }

    getContracts() {
        return this.#contracts;
    }

    getAuthHeadOutput() {
        const { authHeadVaultContract } = this.#contracts;
        return withDust({
            to: authHeadVaultContract.tokenAddress,
        });
    }

    async addBroadcast({
        fund,
        payBy,
    }) {
        const {
            feeVaultContract,
            createFundFeeContract,
            startupContract,
            mintInflowContract,
            mintOutflowContract,
            publicFundContract,
            authHeadVaultContract,
            publicFundVaultContract,
        } = this.#contracts;

        if (this.inputs.length === 0) {
            throw new Error('User genesis input is expected to be added prior to calling this function');
        }

        if (this.outputs.length === 0) { // add authhead output
            this.addOutput(this.getAuthHeadOutput());
        } else {
            // verify authhead output
            const authhead = this.outputs[0];
            if(authhead.to != authHeadVaultContract.tokenAddress || authhead.token) {
                throw new Error('Authhead output is incorrect, expecting to send to authhead vault with no tokens');
            }
        }

        const genesisUtxo = this.inputs[0];

        if (genesisUtxo.vout !== 0 || genesisUtxo.token) {
            throw new Error('First input must be a genesis input (vout is 0) with no tokens');
        }

        const bestFee = await getBestFee({ feeVaultContract, feeContract: createFundFeeContract, payBy, fee: this.#system.fees.create });

        const startupUtxos = await startupContract.getUtxos();
        const mintInflowUtxos = await mintInflowContract.getUtxos();
        const mintOutflowUtxos = await mintOutflowContract.getUtxos();
        const publicUtxos = await publicFundContract.getUtxos();

        const inflowUtxos = mintInflowUtxos.filter(u => u.token?.category === this.#system.inflow);
        const outflowUtxos = mintOutflowUtxos.filter(u => u.token?.category === this.#system.outflow);
        const publicFundUtxos = publicUtxos.filter(u => u.token?.category === this.#system.publicFund)


        const startupUtxo = startupUtxos[getRandomInt(startupUtxos.length)];
        const inflowUtxo = inflowUtxos[getRandomInt(inflowUtxos.length)];
        const outflowUtxo = outflowUtxos[getRandomInt(outflowUtxos.length)];
        const publicFundUtxo = publicFundUtxos[getRandomInt(publicFundUtxos.length)];

        var { managerContract, fundContract } = new FundTokenTransactionBuilder({ provider: this.provider, system: { ...this.#system, fee: this.#system.fees.execute }, fund }).getContracts();

        const fundTokenAmount = 9223372036854775807n;

        this.addInputs([
            {
                ...startupUtxo,
                unlocker: startupContract.unlock.start(getFundBin(fund)),
            },
            {
                ...inflowUtxo,
                unlocker: mintInflowContract.unlock.mint(),
            },
            {
                ...outflowUtxo,
                unlocker: mintOutflowContract.unlock.mint(),
            },
            {
                ...bestFee.utxo,
                unlocker: createFundFeeContract.unlock.pay(),
            },
            {
                ...publicFundUtxo,
                unlocker: publicFundContract.unlock.broadcast(getFundBin(fund))
            }
        ])
            .addOutputs([
                {
                    to: startupContract.tokenAddress,
                    amount: startupUtxo.satoshis,
                    token: startupUtxo.token,
                },
                {
                    to: mintInflowContract.tokenAddress,
                    amount: inflowUtxo.satoshis,
                    token: inflowUtxo.token,
                },
                {
                    to: mintOutflowContract.tokenAddress,
                    amount: outflowUtxo.satoshis,
                    token: outflowUtxo.token,
                },
                ...bestFee.outputs,
                withDust({
                    to: managerContract.tokenAddress,
                    token: {
                        ...inflowUtxo.token,
                        nft: {
                            capability: 'none',
                            commitment: swapEndianness(genesisUtxo.txid) + binToHex(hash256(getFundBin(fund))),
                        }
                    }
                }),
                withDust({
                    to: managerContract.tokenAddress,
                    token: {
                        ...outflowUtxo.token,
                        nft: {
                            capability: 'none',
                            commitment: swapEndianness(genesisUtxo.txid) + binToHex(hash256(getFundBin(fund))),
                        }
                    }
                }),
                withDust({
                    to: fundContract.tokenAddress,
                    token: {
                        category: genesisUtxo.txid,
                        amount: fundTokenAmount,
                    }
                }),
                withDust({
                    to: publicFundContract.tokenAddress,
                    token: {
                        category: this.#system.publicFund,
                        amount: 0n,
                        nft: {
                            capability: 'minting',
                            commitment: '',
                        }
                    }
                }),
            ]);


        const maxSize = 128 * 2;

        const fundHex = getFundHex(fund);
        const fundHexParts = [];

        let curr = 0;
        let next = maxSize;


        while (curr < fundHex.length) {
            fundHexParts.push(fundHex.slice(curr, next));
            curr = next;
            next += maxSize
        }

        fundHexParts.forEach(part => {
            this.addOutput(withDust({
                to: publicFundVaultContract.tokenAddress,
                token: {
                    category: this.#system.publicFund,
                    amount: 0n,
                    nft: {
                        capability: 'none',
                        commitment: part
                    }
                }
            }))
        });
    }
}