import {
    MockNetworkProvider,
    Network,
    randomToken,
    randomUtxo,
} from 'cashscript';
import 'cashscript/vitest';

import { generateWallet } from './wallet.js';

import { DustAmount } from './lib/constants.js';
import SystemTransactionBuilder from './lib/SystemTransactionBuilder.js';
import PublicFundTransactionBuilder from './lib/PublicFundTransactionBuilder.js';
import FundTokenTransactionBuilder from './lib/FundTokenTransactionBuilder.js';

describe('happy path', () => {
    const network = Network.MOCKNET;
    const genesisPartial = { vout: 0, satoshis: DustAmount };

    ///
    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });
    const addUtxos = (address, utxos) => utxos.forEach(u => provider.addUtxo(address, u));

    const systemOwnerWallet = generateWallet(network);
    const authHeadOwnerWallet = generateWallet(network);

    const system = {
        inflow: '1111111111111111111111111111111111111111111111111111111111111111', // 32 byte, tx id/token id
        outflow: '2222222222222222222222222222222222222222222222222222222222222222', // 32 byte, tx id/token id
        publicFund: '3333333333333333333333333333333333333333333333333333333333333333', // 32 byte, tx id/token id
        authHead: authHeadOwnerWallet.pubKeyHashHex, // public key hash
        owner: systemOwnerWallet.pubKeyHex, // public key
        fees: {
            create: {
                nft: '4444444444444444444444444444444444444444444444444444444444444444', // 32 byte, tx id/token id
                value: 10000n, // bigint
            },
            execute: {
                nft: '5555555555555555555555555555555555555555555555555555555555555555', // 32 byte, tx id/token id
                value: 100000n, // bigint
            }
        },
    };

    it('should initialize control tokens', async () => {
        const inflowGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.inflow });
        const outflowGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.outflow });
        const publicFundGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.publicFund });
        const createFundFeeGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.fees.create.nft });
        const executeFundFeeGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.fees.execute.nft });
        const genesisInputs = [inflowGenesisUtxo, outflowGenesisUtxo, publicFundGenesisUtxo, createFundFeeGenesisUtxo, executeFundFeeGenesisUtxo];
        const feeUtxo = randomUtxo({ satoshis: 10000n });

        addUtxos(systemOwnerWallet.tokenAddress, [feeUtxo, ...genesisInputs]);

        const builder = new SystemTransactionBuilder({ provider, system });
        builder
            .addInputs(genesisInputs, systemOwnerWallet.signatureTemplate.unlockP2PKH())
            .addInitializeSystem()
            .addInput(feeUtxo, systemOwnerWallet.signatureTemplate.unlockP2PKH());

        const response = await builder.send();
        console.log('initialize system tx size', response.hex.length / 2);
    });

    it('should create new system threads', async () => {
        const feeUtxo = randomUtxo({ satoshis: 10000n });
        const builder = new SystemTransactionBuilder({ provider, system });
        const signature = systemOwnerWallet.signatureTemplate;

        addUtxos(systemOwnerWallet.tokenAddress, [feeUtxo]);

        await builder.addSystemThreads({ signature });
        await builder.addCreateFundFee();
        await builder.addExecuteFundFee();
        builder.addInput(feeUtxo, systemOwnerWallet.signatureTemplate.unlockP2PKH());

        const response = await builder.send();
        console.log('create new public fund threads tx size', response.hex.length / 2);
    });

    const fund = {
        category: '6666666666666666666666666666666666666666666666666666666666666666',
        amount: 1n,
        satoshis: 0n,
        assets: [
            {
                category: '7777777777777777777777777777777777777777777777777777777777777777',
                amount: 2n,
            },
            {
                category: '8888888888888888888888888888888888888888888888888888888888888888',
                amount: 3n,
            },
            {
                category: '9999999999999999999999999999999999999999999999999999999999999999',
                amount: 4n,
            },
        ]
    };

    it('should broadcast a new fund', async () => {
        const userWallet = generateWallet({ network });
        const fundGenesisUtxo = randomUtxo({ ...genesisPartial, txid: fund.category });
        const feeUtxo = randomUtxo({ satoshis: 100000n });

        addUtxos(userWallet.tokenAddress, [fundGenesisUtxo, feeUtxo]);

        const builder = new PublicFundTransactionBuilder({ provider, system });
        builder.addInput(fundGenesisUtxo, userWallet.signatureTemplate.unlockP2PKH());
        await builder.addBroadcast({ fund });
        builder.addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH());
        const response = await builder.send();
        console.log('broadcast new fund tx size', response.hex.length / 2);
    });

    it('should complete an inflow tx', async () => {
        const userWallet = generateWallet({ network });
        const feeUtxo = randomUtxo({ satoshis: 110000n });
        const assetUtxos = fund.assets.map(a => randomUtxo({ token: randomToken({ ...a }) }));

        addUtxos(userWallet.tokenAddress, [feeUtxo, ...assetUtxos]);

        const inflowAmount = 1n;

        const builder = new FundTokenTransactionBuilder({ provider, system: { ...system, fee: system.fees.execute }, fund });
        await builder.addInflow({ amount: inflowAmount });
        builder
            .addInputs([feeUtxo, ...assetUtxos], userWallet.signatureTemplate.unlockP2PKH())
            .addOutput({
                to: userWallet.tokenAddress,
                amount: DustAmount,
                token: {
                    category: fund.category,
                    amount: inflowAmount * fund.amount,
                }
            });
        const response = await builder.send();
        console.log('inflow tx size', response.hex.length / 2);
    });

    it('should complete an outflow tx', async () => {
        const userWallet = generateWallet({ network });
        const feeUtxo = randomUtxo({ satoshis: 1000000n });
        const outflowAmount = 1n;
        const fundTokenUtxo = randomUtxo({
            token: randomToken({
                category: fund.category,
                amount: outflowAmount * fund.amount,
            })
        });

        addUtxos(userWallet.tokenAddress, [feeUtxo, fundTokenUtxo]);

        const builder = new FundTokenTransactionBuilder({ provider, system: { ...system, fee: system.fees.execute }, fund });
        await builder.addOutflow({ amount: outflowAmount });
        builder
            .addInputs([feeUtxo, fundTokenUtxo], userWallet.signatureTemplate.unlockP2PKH())
            .addOutputs(fund.assets.map(a => ({
                to: userWallet.tokenAddress,
                amount: DustAmount,
                token: {
                    category: a.category,
                    amount: outflowAmount * a.amount
                }
            })))
            .addOutput({
                to: userWallet.tokenAddress,
                amount: DustAmount,
            });
        const response = await builder.send();
        console.log('outflow tx size', response.hex.length / 2);
    });
});