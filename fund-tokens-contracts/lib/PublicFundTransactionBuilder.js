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
import { DataDustAmount, DustAmount } from './constants.js';
import {
    getBestFee,
    getFundBin,
    getFundHex,
    getRandomInt,
} from './utils.js';
import FundTokenTransactionBuilder from './FundTokenTransactionBuilder.js';

import feeJson from './art/fee.json' with { type: 'json' };
import startupJson from './art/startup.json' with { type: 'json' };
import mintJson from './art/mint.json' with { type: 'json' };
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
        authHead: '', // 32 byte, token id
        owner: '', // 32 byte, token id
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
        authHead: '',
        owner: '',
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
        mintContract: null,
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
            authHead: swapEndianness(system.authHead),
            owner: swapEndianness(system.owner),
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
        const feeVaultContract = new Contract(simpleVaultJson, [this.#swapped.owner], { provider: this.provider });
        const feeVaultLockingBytecode = binToHex(cashAddressToLockingBytecode(feeVaultContract.tokenAddress).bytecode);

        const createFundFeeContract = new Contract(feeJson, [this.#swapped.owner, feeVaultLockingBytecode, this.#swapped.fees.create.nft, this.#system.fees.create.value], { provider: this.provider });
        const executeFundFeeContract = new Contract(feeJson, [this.#swapped.owner, feeVaultLockingBytecode, this.#swapped.fees.execute.nft, this.#system.fees.execute.value], { provider: this.provider });

        const startupContract = new Contract(startupJson, [
            binToHex(hash256(hexToBin(createFundFeeContract.bytecode))),
            this.#swapped.inflow,
            this.#swapped.outflow,
        ], { provider: this.provider });
        const startupContractHash = binToHex(hash256(hexToBin(startupContract.bytecode)))

        const mintContract = new Contract(mintJson, [
            startupContractHash,
            this.#swapped.inflow,
            this.#swapped.outflow,
            binToHex(hash256(hexToBin(executeFundFeeContract.bytecode))),
            hexToBin(managerJson.debug.bytecode),
            hexToBin(fundJson.debug.bytecode),
            hexToBin(assetJson.debug.bytecode),
        ], { provider: this.provider });

        const authHeadVaultContract = new Contract(authHeadVaultJson, [this.#swapped.authHead], { provider: this.provider });
        const authHeadVaultLockingBytecode = binToHex(cashAddressToLockingBytecode(authHeadVaultContract.tokenAddress).bytecode);

        const publicFundVaultContract = new Contract(publicFundVaultJson, [this.#swapped.publicFund], { provider: this.provider });
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
            mintContract,
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

    async addBroadcast({
        fund,
        payBy,
    }) {
        const {
            feeVaultContract,
            createFundFeeContract,
            startupContract,
            mintContract,
            publicFundContract,
            authHeadVaultContract,
            publicFundVaultContract,
        } = this.#contracts;

        const bestFee = await getBestFee({ feeVaultContract, feeContract: createFundFeeContract, payBy, fee: this.#system.fees.create, owner: this.#system.owner });

        const broadcastUtxos = await startupContract.getUtxos();
        const mintUtxos = await mintContract.getUtxos();
        const publicUtxos = await publicFundContract.getUtxos();
        const inflowUtxos = mintUtxos.filter(u => u.token?.category === this.#system.inflow);
        const outflowUtxos = mintUtxos.filter(u => u.token?.category === this.#system.outflow);
        const publicFundUtxos = publicUtxos.filter(u => u.token?.category === this.#system.publicFund)
        
        if(this.inputs.length === 0) {
            throw new Error('User genesis input is expected to be added prior to calling this function');
        }
        
        if(this.outputs.length > 0) {
            throw new Error('No outputs should be added to the transaction');
        }

        const genesisUtxo = this.inputs[0];

        if(genesisUtxo.vout !== 0 || genesisUtxo.token) {
            throw new Error('First input must be a genesis input with no tokens');
        }

        const broadcastUtxo = broadcastUtxos[getRandomInt(broadcastUtxos.length)];
        const inflowUtxo = inflowUtxos[getRandomInt(inflowUtxos.length)];
        const outflowUtxo = outflowUtxos[getRandomInt(outflowUtxos.length)];
        const publicFundUtxo = publicFundUtxos[getRandomInt(publicFundUtxos.length)];

        var { managerContract, fundContract } = new FundTokenTransactionBuilder({ provider: this.provider, system: { ...this.#system, fee: this.#system.fees.execute }, fund }).getContracts();

        const fundTokenAmount = 9223372036854775807n;

        this.addInputs([
            {
                ...broadcastUtxo,
                unlocker: startupContract.unlock.start(getFundBin(fund)),
            }, 
            {
                ...inflowUtxo,
                unlocker: mintContract.unlock.mintInflow(),
            }, 
            {
                ...outflowUtxo,
                unlocker: mintContract.unlock.mintOutflow(),
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
                to: authHeadVaultContract.tokenAddress,
                amount: DustAmount,
            },
            {
                to: startupContract.tokenAddress,
                amount: broadcastUtxo.satoshis,
                token: broadcastUtxo.token,
            },
            {
                to: mintContract.tokenAddress,
                amount: inflowUtxo.satoshis,
                token: inflowUtxo.token,
            },
            {
                to: mintContract.tokenAddress,
                amount: outflowUtxo.satoshis,
                token: outflowUtxo.token,
            }, 
            ...bestFee.outputs,
            {
                to: managerContract.tokenAddress,
                amount: DustAmount,
                token: {
                    ...inflowUtxo.token,
                    nft: {
                        capability: 'none',
                        commitment: swapEndianness(genesisUtxo.txid) + binToHex(hash256(getFundBin(fund))),
                    }
                }
            },
            {
                to: managerContract.tokenAddress,
                amount: DustAmount,
                token: {
                    ...outflowUtxo.token,
                    nft: {
                        capability: 'none',
                        commitment: swapEndianness(genesisUtxo.txid) + binToHex(hash256(getFundBin(fund))),
                    }
                }
            },
            {
                to: fundContract.tokenAddress,
                amount: DustAmount,
                token: {
                    category: genesisUtxo.txid,
                    amount: fundTokenAmount,
                }
            },
            {
                to: publicFundContract.tokenAddress,
                amount: DustAmount,
                token: {
                    category: this.#system.publicFund,
                    amount: 0n,
                    nft: {
                        capability: 'minting',
                        commitment: '',
                    }
                }
            }
        ]);


        const maxSize = 128 * 2;

        const fundHex = getFundHex(fund);
        const fundHexParts = [];
        
        let curr = 0;
        let next = maxSize;


        while(curr < fundHex.length) {
            fundHexParts.push(fundHex.slice(curr, next));
            curr = next;
            next += maxSize
        }

        fundHexParts.forEach(part => {
            this.addOutput({
                to:  publicFundVaultContract.tokenAddress,
                amount: DataDustAmount,
                token: {
                    category: this.#system.publicFund,
                    amount: 0n,
                    nft: {
                        capability: 'none',
                        commitment: part
                    }
                }
            })
        });
    }
}