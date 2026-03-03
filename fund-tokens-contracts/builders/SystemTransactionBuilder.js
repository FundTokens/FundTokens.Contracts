import {
    Contract,
    Network,
    TransactionBuilder,
} from 'cashscript';
import {
    swapEndianness,
    hash256,
    hexToBin,
    binToHex,
    encodeCashAddress,
} from '@bitauth/libauth';
import {
    getBestFee,
    getFundBin,
    getFundHex,
} from './utils.js';
import PublicFundTransactionBuilder from './PublicFundTransactionBuilder.js';
import FundTokenTransactionBuilder from './FundTokenTransactionBuilder.js';

import feeJson from './art/fee.json' with { type: 'json' };
import feeMinterJson from './art/fee_minter.json' with { type: 'json' };
import simpleMinterJson from './art/simple_minter.json' with { type: 'json' };

const DustAmount = 1000n;

const getRandomInt = max => Math.floor(Math.random() * max);

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

        this.#logger = logger ?? console;
    }

    buildContracts() {
        const publicFundBuilder = new PublicFundTransactionBuilder({ provider: this.provider, system: this.#system, logger: this.#logger });

        const createFundFeeContract = new Contract();

        const executeFundFeeContract = new Contract();

        // startupContract,
        const { mintContract, publicDetailsContract } = publicFundBuilder.buildContracts();

        const inflowDestination = binToHex(hash256(hexToBin(mintContract.bytecode)));
        const inflowHoldingContract = new Contract(simpleMinterJson, [this.#system.owner, this.#swapped.inflow, inflowDestination], { provider: this.provider });
        
        
        const outflowDestination = binToHex(hash256(hexToBin(mintContract.bytecode)));
        const outflowHoldingContract = new Contract(simpleMinterJson, [this.#system.owner, this.#swapped.outflow, outflowDestination], { provider: this.provider });

        const publicDetailsDestination = binToHex(hash256(hexToBin(publicDetailsContract)));
        const publicDetailsHoldingContract = new Contract(simpleMinterJson, [this.#system.owner, this.#swapped.publicFund, publicDetailsDestination], { provider: this.provider });

        const createFundFeeDestination = binToHex(hash256(hexToBin(createFundFeeContract.bytecode)));
        const mintCreateFundFee = new Contract(feeJson, [this.#system.owner, this.#swapped.fees.create.nft, createFundFeeDestination], { provider: this.provider });

        const executeFundFeeDestination = binToHex(hash256(hexToBin(executeFundFeeContract.bytecode)));
        const mintExecuteFundFee = new Contract(feeJson, [this.#system.owner, this.#swapped.fees.execute.nft, executeFundFeeDestination], { provider: this.provider });

        return { inflowHoldingContract, outflowHoldingContract, publicDetailsHoldingContract, mintCreateFundFee, mintExecuteFundFee };
    }
}