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
    getFundHex,
} from './utils.js';
import FundTokenTransactionBuilder from './FundTokenTransactionBuilder.js';

import feeJson from './art/fee.json' with { type: 'json' };
import broadcastJson from './art/broadcast.json' with { type: 'json' };
import mintJson from './art/mint.json' with { type: 'json' };
import managerJson from './art/manager.json' with { type: 'json' };

const DustAmount = 1000n;

const getRandomInt = max => Math.floor(Math.random() * max);

export default class BroadcastTokenTransactionBuilder extends TransactionBuilder {
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
            this.#system.authHead,
            this.#system.inflowSwapped,
            this.#system.outflowSwapped,
        ], { provider: this.provider });

        //bytes32 validator, bytes inflowToken, bytes outflowToken, bytes next
        const mintContract = new Contract(mintJson, [
            binToHex(hash256(hexToBin(broadcastContract.bytecode))),
            this.#system.inflowSwapped,
            this.#system.outflowSwapped,
            managerJson.debug.bytecode,
        ], { provider: this.provider });

        return { feeContract, broadcastContract, mintContract };
    }

    async newBroadcastTransaction({
        fund,
        payBy,
        genesis: {
            utxo,
            unlocker,
        },
    }) {
        const transactionBuilder = new BroadcastTokenTransactionBuilder({ provider: this.provider, system: this.#system, logger: this.#logger });
        transactionBuilder.addInput(utxo, unlocker);
        await transactionBuilder.addBroadcast({ fund, payBy });
        return transactionBuilder;
    }

    async addBroadcast({
        fund,
        payBy,
    }) {
        const { feeContract, broadcastContract, mintContract } = this.buildContracts();

        const bestFee = await getBestFee({ feeContract, payBy, fee: this.#system.fee });

        const broadcastUtxos = await broadcastContract.getUtxos();
        const mintUtxos = await mintContract.getUtxos();
        const inflowUtxos = mintUtxos.filter(u => u.token?.category == this.#system.inflow);
        const outflowUtxos = mintUtxos.filter(u => u.token?.category == this.#system.outflow);
        
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

        var { managerContract, fundContract } = new FundTokenTransactionBuilder({ provider: this.provider, system: { ...this.#system, fee: this.#system.fundFee } }).buildFundContracts(fund);

        const authHeadTokenAddress = encodeCashAddress({ prefix: this.provider.network === Network.MAINNET ? 'bitcoincash' : 'bchtest', type: 'p2pkhWithTokens', payload: hexToBin(this.#system.authHead) });

        this.addInputs([
            {
                ...broadcastUtxo,
                unlocker: broadcastContract.unlock.broadcast(getFundHex(fund)),
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
                unlocker: feeContract.unlock.pay(),
            }
        ])
        .addOutputs([
            {
                to: authHeadTokenAddress.address,
                amount: DustAmount,
            },
            {
                to: broadcastContract.tokenAddress,
                amount: broadcastUtxo.satoshis,
                token: broadcastUtxo.token,
                // token: {
                //     ...broadcastUtxo.token,
                // }
            },
            {
                to: mintContract.tokenAddress,
                amount: inflowUtxo.satoshis,
                token: inflowUtxo.token,
                // token: {
                //     ...inflowUtxo.token,
                // }
            },
            {
                to: mintContract.tokenAddress,
                amount: outflowUtxo.satoshis,
                token: outflowUtxo.token,
            }, 
            {
                to: feeContract.tokenAddress,
                amount: bestFee.utxo.satoshis,
                // token: {
                //     ...bestFee.utxo.
                // }
            },
            {
                to: bestFee.destination,
                amount: bestFee.amount,
                // token // TODO
            },
            {
                to: managerContract.tokenAddress,
                amount: DustAmount,
                token: {
                    ...inflowUtxo.token,
                    nft: {
                        capability: 'none',
                        commitment: binToHex(hash256(getFundHex(fund))),
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
                        commitment: binToHex(hash256(getFundHex(fund))),
                    }
                }
            },
            {
                to: fundContract.tokenAddress,
                amount: DustAmount,
                token: {
                    category: genesisUtxo.txid,
                    amount: 10000n, // TODO
                    nft: undefined,
                }
            }
        ]);
    }
}