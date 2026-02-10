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

import feeJson from './art/fee.json' with { type: 'json' };
import broadcastJson from './art/broadcast.json' with { type: 'json' };
import mintJson from './art/mint.json.json' with { type: 'json' };

const DustAmount = 1000n;

export class BroadcastTokenTransactionBuilder extends TransactionBuilder {
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

    // build and get the contracts
    buildContracts() {
        const feeContract = this.buildFeeContract();
        const broadcastContract = new Contract(broadcastJson, [], { provider: this.provider });
        const mintContract = new Contract(mintJson, [], { provider: this.provider });

        return { feeContract, broadcastContract, mintContract };
    }
}