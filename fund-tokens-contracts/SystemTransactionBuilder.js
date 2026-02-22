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
import FundTokenTransactionBuilder from './FundTokenTransactionBuilder.js';

import feeJson from './art/fee.json' with { type: 'json' };
import startupJson from './art/startup.json' with { type: 'json' };
import mintJson from './art/mint.json' with { type: 'json' };
import managerJson from './art/manager.json' with { type: 'json' };
import fundJson from './art/fund.json' with { type: 'json' };
import assetJson from './art/asset.json' with { type: 'json' };

const DustAmount = 1000n;

const getRandomInt = max => Math.floor(Math.random() * max);

export default class SystemTransactionBuilder extends TransactionBuilder {
    #system = {
        inflow: '',
        inflowSwapped: '',
        outflow: '',
        outflowSwapped: '',
        authHead: '',
        fee: {
            pubKey: '',
            pubKeySwapped: '',
            nft: '',
            nftSwapped: '',
            value: -1,
        },
        fundFee: {
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
        this.#system.fundFee.nftSwapped = swapEndianness(system.fundFee.nft);

        this.#logger = logger ?? console;
    }
}