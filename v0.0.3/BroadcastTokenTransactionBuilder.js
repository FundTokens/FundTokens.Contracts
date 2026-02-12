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
import {
    getBestFee,
    getFundHex,
} from './utils';

import feeJson from './art/fee.json' with { type: 'json' };
import broadcastJson from './art/broadcast.json' with { type: 'json' };
import mintJson from './art/mint.json.json' with { type: 'json' };
import managerJson from './art/manager.json' with { type: 'json' };

const DustAmount = 1000n;

const getRandomInt = max => Math.floor(Math.random() * max);

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
        const { feeContract } = this.buildFeeContract();
        //bytes32 fee, bytes20 bcmrDestination, bytes inflowMint, bytes outflowMint
        const broadcastContract = new Contract(broadcastJson, [
            binToHex(hash256(hexToBin(feeContract.bytecode))),
            this.#system.fee.pubKey,
            this.#system.inflowSwapped,
            this.#system.outflowSwapped,
        ], { provider: this.provider });
        //bytes32 validator, bytes inflowToken, bytes outflowToken, bytes next
        const mintContract = new Contract(mintJson, [
            binToHex(hash256(hexToBin(broadcastContract.bytecode))),
            this.#system.inflowSwapped,
            this.#system.outflowSwapped,
            0x00,
        ], { provider: this.provider });

        return { feeContract, broadcastContract, mintContract };
    }

    async addBroadcast({
        fund,
        payBy,
    }) {
        const { feeContract, broadcastContract, mintContract } = this.buildContracts();

        const bestFee = await getBestFee({ feeContract, payBy });

        const broadcastUtxos = await broadcastContract.getUtxos();
        const mintUtxos = await broadcastContract.getUtxos();
        const inflowUtxos = mintUtxos.filter(u => u.token?.category == this.#system.inflow);
        const outflowUtxos = mintUtxos.filter(u => u.token?.category == this.#system.outflow);

        if(this.inputs.length === 0) {
            throw new Error('User genesis input is expected to be added prior to calling this function');
        }

        if(this.inputs[0].vout !== 0 || this.inputs[0].token) {
            throw new Error('First input must be a genesis input with no tokens');
        }

        const broadcastUtxo = broadcastUtxos[getRandomInt(broadcastUtxos.length)];
        const inflowUtxo = inflowUtxos[getRandomInt(inflowUtxos.length)];
        const outflowUtxo = outflowUtxos[getRandomInt(outflowUtxos.length)];
        
        // broadcast
        this.addInput(broadcastUtxo, broadcastContract.unlock.broadcast(getFundHex(fund)));

        // inflow mint
        this.addInput(inflowUtxo, mintContract.unlock.mintInflow());

        // outflow mint
        this.addInput(outflowUtxo, mintContract.unlock.mintOutflow());

        // fee manager

        // fee
        // new fund manager
        // new fund manager
        // new fund tokens
    }
}