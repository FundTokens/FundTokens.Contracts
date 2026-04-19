import {
    MockNetworkProvider,
    Network,
    randomToken,
    randomUtxo,
} from 'cashscript';
import 'cashscript/vitest';

import { generateWallet } from '@/wallet.js';

import { DustAmount } from '@lib/constants.js';
import SystemTransactionBuilder from '@system/SystemTransactionBuilder.js';
import PublicFundTransactionBuilder from '@lib/PublicFundTransactionBuilder.js';
import FundTokenTransactionBuilder from '@lib/FundTokenTransactionBuilder.js';

describe('encoded CashTokens fee testing', () => {
    const network = Network.MOCKNET;
    const genesisPartial = { vout: 0, satoshis: DustAmount };

    ///
    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });
    const addUtxos = (address, utxos) => utxos.forEach(u => provider.addUtxo(address, u));

    const ownerWallet = generateWallet(network);

    const payByToken = randomToken();
    const destinationWallet = generateWallet(network);

    const system = {
        inflow: '1111111111111111111111111111111111111111111111111111111111111111',
        outflow: '2222222222222222222222222222222222222222222222222222222222222222',
        publicFund: '3333333333333333333333333333333333333333333333333333333333333333',
        authorization: '4444444444444444444444444444444444444444444444444444444444444444',
        fees: {
            create: {
                nft: '5555555555555555555555555555555555555555555555555555555555555555',
                value: 10000n,
            },
            execute: {
                nft: '6666666666666666666666666666666666666666666666666666666666666666',
                value: 100000n,
            }
        },
    };

    it('should initialize control tokens', async ({ expect }) => {
        const inflowGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.inflow });
        const outflowGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.outflow });
        const publicFundGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.publicFund });
        const createFundFeeGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.fees.create.nft });
        const executeFundFeeGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.fees.execute.nft });
        const authGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.authorization });
        const genesisInputs = [inflowGenesisUtxo, outflowGenesisUtxo, publicFundGenesisUtxo, createFundFeeGenesisUtxo, executeFundFeeGenesisUtxo];
        const feeUtxo = randomUtxo({ satoshis: 10000n });

        addUtxos(ownerWallet.tokenAddress, [feeUtxo, ...genesisInputs, authGenesisUtxo]);

        const transaction = new SystemTransactionBuilder({ provider, system });
        transaction
            .addInputs(genesisInputs, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInitializeSystem()
            .addInput(authGenesisUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInput(feeUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutput({
                to: ownerWallet.tokenAddress,
                amount: DustAmount,
                token: {
                    category: system.authorization,
                    amount: 0n,
                    nft: {
                        capability: 'none',
                        commitment: '',
                    }
                }
            });

        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('initialize system tx size', response.hex.length / 2);
    });

    it('should create new system threads', async ({ expect }) => {
        const feeUtxo = randomUtxo({ satoshis: 10000n });
        const authUtxo = (await provider.getUtxos(ownerWallet.tokenAddress))[0];
        const transaction = new SystemTransactionBuilder({ provider, system });

        addUtxos(ownerWallet.tokenAddress, [feeUtxo]);

        await transaction.addSystemThreads();
        await transaction.addCreateFundFee();
        await transaction.addExecuteFundFee();
        transaction.addInput(feeUtxo, ownerWallet.signatureTemplate.unlockP2PKH());
        transaction.addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH());
        transaction.addOutput({
            to: ownerWallet.tokenAddress,
            amount: DustAmount,
            token: authUtxo.token,
        });

        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('create new public fund threads tx size', response.hex.length / 2);
    });

    it('should create new encoded fee threads', async ({ expect }) => {
        const feeUtxo = randomUtxo({ satoshis: 10000n });
        const authUtxo = (await provider.getUtxos(ownerWallet.tokenAddress))[0];
        const transaction = new SystemTransactionBuilder({ provider, system });

        addUtxos(ownerWallet.tokenAddress, [feeUtxo]);

        await transaction.addCreateFundFee({ fee: { category: payByToken.category, amount: 50000n, destination: destinationWallet.tokenAddress } });
        transaction.addInput(feeUtxo, ownerWallet.signatureTemplate.unlockP2PKH());
        await transaction.addExecuteFundFee({ fee: { category: payByToken.category, amount: 5000n, destination: destinationWallet.tokenAddress } });
        transaction
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutput({
                to: ownerWallet.tokenAddress,
                amount: DustAmount,
                token: authUtxo.token,
            })

        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('create new public fund threads tx size', response.hex.length / 2);
    });

    const fund = {
        category: '7777777777777777777777777777777777777777777777777777777777777777',
        amount: 1n,
        satoshis: 0n,
        assets: [
            {
                category: '8888888888888888888888888888888888888888888888888888888888888888',
                amount: 2n,
            },
            {
                category: '9999999999999999999999999999999999999999999999999999999999999999',
                amount: 3n,
            },
            {
                category: '1212121212121212121212121212121212121212121212121212121212121212',
                amount: 4n,
            },
        ]
    };

    it('should broadcast a new fund', async ({ expect }) => {
        const userWallet = generateWallet({ network });
        const fundGenesisUtxo = randomUtxo({ ...genesisPartial, txid: fund.category });
        const feeUtxo = randomUtxo({ satoshis: 200000n, token: { category: payByToken.category, amount: 50000n } });

        addUtxos(userWallet.tokenAddress, [fundGenesisUtxo, feeUtxo]);

        const transaction = new PublicFundTransactionBuilder({ provider, system });
        transaction.addInput(fundGenesisUtxo, userWallet.signatureTemplate.unlockP2PKH());
        await transaction.addBroadcast({ fund, payBy: payByToken.category });
        transaction.addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH());

        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('broadcast new fund tx size', response.hex.length / 2);
    });

    it('should complete an inflow tx', async ({ expect }) => {
        const userWallet = generateWallet({ network });
        const feeUtxo = randomUtxo({ satoshis: 10000n, token: { category: payByToken.category, amount: 5000n }});
        const assetUtxos = fund.assets.map(a => randomUtxo({ token: randomToken({ ...a }) }));

        addUtxos(userWallet.tokenAddress, [feeUtxo, ...assetUtxos]);

        const inflowAmount = 1n;

        const transaction = new FundTokenTransactionBuilder({ provider, system: { ...system, fee: system.fees.execute }, fund });
        await transaction.addInflow({ amount: inflowAmount, payBy: payByToken.category });
        transaction
            .addInputs([feeUtxo, ...assetUtxos], userWallet.signatureTemplate.unlockP2PKH())
            .addOutput({
                to: userWallet.tokenAddress,
                amount: DustAmount,
                token: {
                    category: fund.category,
                    amount: inflowAmount * fund.amount,
                }
            });
        
        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('inflow tx size', response.hex.length / 2);
    });

    it('should complete an outflow tx', async ({ expect }) => {
        const userWallet = generateWallet({ network });
        const feeUtxo = randomUtxo({ satoshis: 10000n, token: { category: payByToken.category, amount: 5000n } });
        const outflowAmount = 1n;
        const fundTokenUtxo = randomUtxo({
            token: randomToken({
                category: fund.category,
                amount: outflowAmount * fund.amount,
            })
        });

        addUtxos(userWallet.tokenAddress, [feeUtxo, fundTokenUtxo]);

        const transaction = new FundTokenTransactionBuilder({ provider, system: { ...system, fee: system.fees.execute }, fund });
        await transaction.addOutflow({ amount: outflowAmount, payBy: payByToken.category });
        transaction
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
        
        expect(transaction).not.toFailRequire();
                
        const response = await transaction.send();
        console.log('outflow tx size', response.hex.length / 2);
    });
});