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
import PublicFundTransactionBuilder from './PublicFundTransactionBuilder.js';

import feeJson from './art/fee.json' with { type: 'json' };
import feeMinterJson from './art/fee_minter.json' with { type: 'json' };
import simpleMinterJson from './art/simple_minter.json' with { type: 'json' };

export default class SystemTransactionBuilder extends TransactionBuilder {
    #system = {
        inflow: '', // 32 byte, tx id/token id
        outflow: '', // 32 byte, tx id/token id
        publicFund: '', // 32 byte, tx id/token id
        authHead: '', // public key hash
        owner: '', // public key
        fees: {
            create: {
                nft: '', // 32 byte, tx id/token id
                value: -1n,
            },
            execute: {
                nft: '', // 32 byte, tx id/token id
                value: -1n,
            }
        },
    };
    #swapped = {
        inflow: '',
        outflow: '',
        publicFund: '',
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
        inflowHoldingContract: null,
        outflowHoldingContract: null,
        publicDetailsHoldingContract: null,
        mintCreateFundFee: null,
        mintExecuteFundFee: null,
    };
    #logger = console;

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

    #buildContracts() {
        const publicFundBuilder = new PublicFundTransactionBuilder({ provider: this.provider, system: this.#system, logger: this.#logger });

        const { mintContract, startupContract, publicDetailsContract } = publicFundBuilder.buildContracts();
        
        const inflowDestination = binToHex(hash256(hexToBin(mintContract.bytecode)));
        const inflowHoldingContract = new Contract(simpleMinterJson, [this.#system.owner, this.#swapped.inflow, inflowDestination], { provider: this.provider });
        
        
        const outflowDestination = binToHex(hash256(hexToBin(mintContract.bytecode)));
        const outflowHoldingContract = new Contract(simpleMinterJson, [this.#system.owner, this.#swapped.outflow, outflowDestination], { provider: this.provider });
        
        const publicDetailsDestination = binToHex(hash256(hexToBin(publicDetailsContract)));
        const publicDetailsHoldingContract = new Contract(simpleMinterJson, [this.#system.owner, this.#swapped.publicFund, publicDetailsDestination], { provider: this.provider });
        
        const createFundFeeContract = new Contract(feeJson, [this.#system.owner, this.#swapped.fees.create.nft, this.#system.fees.create.value], { provider: this.provider });
        const createFundFeeDestination = binToHex(hash256(hexToBin(createFundFeeContract.bytecode)));
        const mintCreateFundFee = new Contract(feeMinterJson, [this.#system.owner, this.#swapped.fees.create.nft, createFundFeeDestination], { provider: this.provider });
        
        const executeFundFeeContract = new Contract(feeJson, [this.#system.owner, this.#swapped.fees.execute.nft, this.#system.fees.execute.value], { provider: this.provider });
        const executeFundFeeDestination = binToHex(hash256(hexToBin(executeFundFeeContract.bytecode)));
        const mintExecuteFundFee = new Contract(feeMinterJson, [this.#system.owner, this.#swapped.fees.execute.nft, executeFundFeeDestination], { provider: this.provider });

        this.#contracts = { startupContract, inflowHoldingContract, outflowHoldingContract, publicDetailsHoldingContract, mintCreateFundFee, mintExecuteFundFee };
    }

    getContracts() {
        return this.#contracts;
    }
    
    addNewThread() {

    }

    addInflowThread() {
    }

    addOutflowThread() {
    }

    addPublicThread() {

    }

    addNewFee() {

    }

    addCreateFundFee(fee) {
        if(!fee) {
            // TODO: default fee
        } else {
            const {
                category,
                amount,
                destination,
            } = fee;
        }
    }

    addExecuteFundFee() {

    }

    // should only be invoked once to initialize the system
    initializeSystem() {
        // TODO:
        this.addInflowThread();
        this.addOutflowThread();
        this.addCreateFundFee();
        this.addExecuteFundFee();
    }
}