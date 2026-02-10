import {
    Contract,
    TransactionBuilder,
} from 'cashscript';
import {
    swapEndianness,
    hash256,
    hexToBin,
    binToHex,
    encodeCashAddress,
    instantiateRipemd160,
    instantiateSha256,
    cashAddressToLockingBytecode,
} from '@bitauth/libauth';
import {
    getFundHex,
    hashFund,
} from './utils.js';

import managerJson from './art/manager.json' with { type: 'json' };
import fundJson from './art/fund.json' with { type: 'json' };
import assetJson from './art/asset.json' with { type: 'json' };
import feeJson from './art/fee.json' with { type: 'json' };

const DustAmount = 1000n;

const sortDecreasingTokenAmount = (a, b) => b.token?.amount - a.token?.amount;

// const secp256k1 = await instantiateSecp256k1();
const ripemd160 = await instantiateRipemd160();
const sha256 = await instantiateSha256();

export class FundTokenTransactionBuilder extends TransactionBuilder {
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
        if(!system) {
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
    buildContracts(fund) {
        const {
            category,
            assets,
        } = fund;
        const fundHash = hashFund(fund);

        const assetContracts = [];
        assets.forEach(a => {
            const fundAssetCategory = swapEndianness(a.category);

            // 32 32 32
            const assetContract = new Contract(assetJson, [this.#system.outflowSwapped, fundHash, fundAssetCategory], { provider: this.provider });

            assetContracts.push(assetContract);
        });

        // 32 32 32 32 + 4 128 132 * 2 264
        const fundContract = new Contract(fundJson, [this.#system.inflowSwapped, this.#system.outflowSwapped, swapEndianness(category), fundHash], { provider: this.provider });
        
        const {
            pubKey,
            nftSwapped,
            value,
        } = this.#system.fee;
        const feeContract = new Contract(feeJson, [pubKey, nftSwapped, value], { provider: this.provider });

        const managerContract = new Contract(managerJson, [
            binToHex(hash256(hexToBin(feeContract.bytecode))),
            this.#system.inflowSwapped,
            this.#system.outflowSwapped,
            fundContract.bytecode.slice(264),
            assetContracts[0].bytecode.slice(198),
            swapEndianness(category),
            fundHash,
        ], { provider: this.provider });

        return { managerContract, fundContract, assetContracts, feeContract };
    }

    // return a new transaction builder with a built mint transaction
    async newMintTransaction({
        fund,
        // user: { // add user utxos and change to the address
        //     utxos,
        //     address,
        // }
    }) {
        const transactionBuilder = new FundTokenTransactionBuilder({ provider });
        await transactionBuilder.addMint(fund);
        return transactionBuilder;
    }

    async getBestFee({ fund, payBy }) { // TODO: fund isn't needed, need to uncouple contract building
        const { feeContract } = this.buildContracts(fund)
        const feeUtxos = (await feeContract.getUtxos()).filter(u => {
            const payByBitcoin = !payBy || payBy === '';
            if(!!u.token && u.token.category === this.#system.fee.nft) {
                const feeType = u.token.nftCommittment; // TODO
                if(feeType === '000000') {
                    return payByBitcoin;
                } else {
                    return !payByBitcoin;
                }
            }
            return payByBitcoin && !u.token;
        }).sort((a, b) => {
            let aAmount = a.satoshis;
            let bAmount = b.satoshis;
            if(a.token) {
                aAmount = a.token.nftCommittment; // TODO: split
            }
            if(b.token) {
                bAmount = b.token.nftCommittment; // TODO: split
            }
            return aAmount > bAmount;
        }); // TODO need to verify sort func and check nfts too

        if(!feeUtxos) {
            return null;
        }

        const feeUtxo = feeUtxos[0];

        const pubKeyBin = hexToBin(this.#system.fee.pubKey);
        const pubKeyHash = ripemd160.hash(sha256.hash(pubKeyBin));
        const encoded = encodeCashAddress({ prefix: this.provider.network === 'mainnet' ? 'bitcoincash' : 'bchtest', type: 'p2pkhWithTokens', payload: pubKeyHash });
        const address = typeof encoded === 'string' ? encoded : encoded.address;

        console.log('pulled fee utxo from', feeContract.tokenAddress, binToHex(cashAddressToLockingBytecode(feeContract.tokenAddress).bytecode));

        
        const bestFee = { //TODO
            isBitcoin: true,
            category: null,
            amount: feeUtxo.token ? 0 : this.#system.fee.value,
            destination: address,
            utxo: feeUtxo,
        };
        return bestFee;
    }

    // This method should be called while the transaction has same transaction input and output lengths
    // The consuming app is responsible for adding an output for Bitcoin change, fund token minted, and token change
    async addMint({
        amount,
        fund,
        fund: {
            category: fundCategory,
            amount: fundAmount,
            assets: fundAssets, // category, amount
        },
        payBy,
    }) {
        this.#logger.log('transaction builder...adding minting transaction');

        const { managerContract, fundContract, assetContracts, feeContract } = this.buildContracts(fund);

        const inflowUtxos = (await managerContract.getUtxos()).filter(u => u.token?.category === this.#system.inflow);
        const fundUtxos = (await fundContract.getUtxos()).filter(u => u.token?.category === fundCategory);
        const bestFee = await this.getBestFee({ fund, payBy });

        if (!inflowUtxos?.length || !fundUtxos?.length || !bestFee) {
            this.#logger.error('Missing required UTXO', !inflowUtxos?.length, !fundUtxos?.length, !bestFee);
            throw new Error('Missing required UTXO');
        }

        const inflowUtxo = inflowUtxos[0];
        const fundUtxo = fundUtxos[0];
        const feeUtxo = bestFee.utxo;

        const mintAmount = fundAmount * amount;
        const fundChangeAmount = fundUtxo.token.amount - mintAmount;

        this.addInput(inflowUtxo, managerContract.unlock.inflow(getFundHex(fund)))
            .addInput(fundUtxo, fundContract.unlock.mint())
            .addInput(feeUtxo, feeContract.unlock.pay())
            .addOutputs([
                {
                    to: managerContract.tokenAddress,
                    amount: inflowUtxo.satoshis,
                    token: {
                        ...inflowUtxo.token,
                    },
                },
                {
                    to: fundContract.tokenAddress,
                    amount: fundUtxo.satoshis,
                    token: fundChangeAmount <= 0 ? null : { // TODO: bug here?!
                        category: fundCategory,
                        amount: fundChangeAmount,
                    },
                },
                {
                    to: feeContract.tokenAddress,
                    amount: feeUtxo.satoshis,
                    // token: !feeUtxo.token ? null : {
                    //     ...feeUtxo.token,
                    // }
                },
                { // TODO verify IMPLEMENTATION
                    to: bestFee.destination ? bestFee.destination : this.#system.fee.pubKey,
                    amount: bestFee.isBitcoin ? bestFee.amount : DustAmount,
                    // token: bestFee.isBitcoin ? null : {
                    //     category: bestFee.category,
                    //     amount: bestFee.amount,
                    // }
                },
                ...assetContracts.map((assetContract, i) => ({
                    to: assetContract.tokenAddress,
                    amount: DustAmount,
                    token: {
                        category: fundAssets[i].category,
                        amount: fundAssets[i].amount,
                    }
                })),
            ]);
        this.#logger.log('finished adding mint transaction i/o');
        return this;
    }

    // This method should be called while the transaction has same transaction input and output lengths
    // The consuming user is responsible for adding inputs for the fund token
    // The consuming app is responsible for adding an outputs for Bitcoin change and token change
    async addRedeem({
        amount,
        fund,
        fund: {
            category: fundCategory,
            amount: fundAmount, // fund token amount
            satoshis, // TODO: BCH being locked
            assets: fundAssets, // category, amount
        },
    }) {
        this.#logger.log('transaction builder...adding redemption transaction');

        const { managerContract, fundContract, assetContracts } = this.buildContracts(fund);

        //
        const outflowUtxos = (await managerContract.getUtxos()).filter(u => u.token?.category === this.#system.outflow);
        if (!outflowUtxos.length) {
            throw new Error(`Missing required outflow ${this.#system.outflow} UTXO.`);
        }
        const outflowUtxo = outflowUtxos[0];


        //
        const fundUtxos = await fundContract.getUtxos();

        if (!fundUtxos.length) {
            throw new Error(`Missing required fund ${fundCategory} UTXO. Send dust UTXO to contract and redeem again.`)
        }

        const existingFundUtxo = fundUtxos.filter(u => u.token?.category === fundCategory).sort(sortDecreasingTokenAmount);
        const fundUtxo = existingFundUtxo.length ? existingFundUtxo[0] : fundUtxos[0];


        //
        const redeemAmount = fundAmount * amount;
        const updatedFundAmount = fundUtxo.token?.amount + redeemAmount;

        this.addInput(outflowUtxo, managerContract.unlock.outflow(getFundHex(fund)))
            .addInput(fundUtxo, fundContract.unlock.redeem());


        const assetChangeAmounts = [];
        for (let i = 0; i < assetContracts.length; ++i) {
            const assetUtxos = (await assetContracts[i].getUtxos()).filter(u => u.token?.category === fundAssets[i].category).sort(sortDecreasingTokenAmount);
            if (!assetUtxos.length) {
                throw new Error(`Missing required asset '${fundAssets[i].category}' UTXO`);
            }
            let tokenAmountAdded = 0n;
            for(let j = 0; j < assetUtxos.length; ++j) {
                this.addInput(assetUtxos[j], assetContracts[i].unlock.release());
                tokenAmountAdded += assetUtxos[j].token.amount;
                if(tokenAmountAdded >= amount * fundAssets[i].amount) {
                    assetChangeAmounts.push(tokenAmountAdded - (amount * fundAssets[i].amount));
                    break;
                }
            }
        }

        this.#logger.log('asset change amounts', assetChangeAmounts);

        this.addOutputs([
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
                    category: fundCategory,
                    amount: updatedFundAmount,
                },
            },
        ]);

        for(let i = 0; i < assetChangeAmounts.length; ++i) {
            if(!assetChangeAmounts[i]) {
                continue;
            }
            this.#logger.log('adding output change');
            this.addOutput({
                to: assetContracts[i].tokenAddress,
                amount: DustAmount,
                token: {
                    category: fundAssets[i].category,
                    amount: assetChangeAmounts[i],
                },
            });
        }

        this.#logger.log('finished adding redemption transaction i/o');
        return this;
    }
}