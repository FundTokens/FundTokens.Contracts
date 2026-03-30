import {
    MockNetworkProvider,
    Network,
    randomToken,
    randomUtxo,
} from 'cashscript';
import 'cashscript/vitest';

import { generateWallet } from '@/wallet.js';

import { decodeFund, getFundHex } from '@lib/utils';
import { DustAmount } from '@lib/constants.js';
import SystemTransactionBuilder from '@lib/SystemTransactionBuilder.js';
import PublicFundTransactionBuilder from '@lib/PublicFundTransactionBuilder.js';
import FundTokenTransactionBuilder from '@lib/FundTokenTransactionBuilder.js';

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

    it('should initialize control tokens', async ({ expect }) => {
        const inflowGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.inflow });
        const outflowGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.outflow });
        const publicFundGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.publicFund });
        const createFundFeeGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.fees.create.nft });
        const executeFundFeeGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.fees.execute.nft });
        const genesisInputs = [inflowGenesisUtxo, outflowGenesisUtxo, publicFundGenesisUtxo, createFundFeeGenesisUtxo, executeFundFeeGenesisUtxo];
        const feeUtxo = randomUtxo({ satoshis: 10000n });

        addUtxos(systemOwnerWallet.tokenAddress, [feeUtxo, ...genesisInputs]);

        const transaction = new SystemTransactionBuilder({ provider, system });
        transaction
            .addInputs(genesisInputs, systemOwnerWallet.signatureTemplate.unlockP2PKH())
            .addInitializeSystem()
            .addInput(feeUtxo, systemOwnerWallet.signatureTemplate.unlockP2PKH());

        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('initialize system tx size', response.hex.length / 2);
    });

    it('should create new system threads', async ({ expect }) => {
        const feeUtxo = randomUtxo({ satoshis: 10000n });
        const transaction = new SystemTransactionBuilder({ provider, system });
        const signature = systemOwnerWallet.signatureTemplate;

        addUtxos(systemOwnerWallet.tokenAddress, [feeUtxo]);

        await transaction.addSystemThreads({ signature });
        await transaction.addCreateFundFee();
        await transaction.addExecuteFundFee();
        transaction.addInput(feeUtxo, systemOwnerWallet.signatureTemplate.unlockP2PKH());

        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('create new public fund threads tx size', response.hex.length / 2);
    });

    it('should create additional system threads', async ({ expect }) => {
        const feeUtxo = randomUtxo({ satoshis: 10000n });
        const transaction = new SystemTransactionBuilder({ provider, system });
        const signature = systemOwnerWallet.signatureTemplate;

        addUtxos(systemOwnerWallet.tokenAddress, [feeUtxo]);

        await transaction.addSystemThreads({ signature });
        await transaction.addCreateFundFee();
        await transaction.addExecuteFundFee();
        transaction.addInput(feeUtxo, systemOwnerWallet.signatureTemplate.unlockP2PKH());

        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('create new public fund threads tx size', response.hex.length / 2);
    });

    const fund = {
        category: '6666666666666666666666666666666666666666666666666666666666666666',
        amount: 10n,
        satoshis: 1000n,
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

    it('should broadcast a new fund', async ({ expect }) => {
        const userWallet = generateWallet({ network });
        const fundGenesisUtxo = randomUtxo({ ...genesisPartial, txid: fund.category });
        const feeUtxo = randomUtxo({ satoshis: 100000n });

        addUtxos(userWallet.tokenAddress, [fundGenesisUtxo, feeUtxo]);

        const transaction = new PublicFundTransactionBuilder({ provider, system });
        transaction.addInput(fundGenesisUtxo, userWallet.signatureTemplate.unlockP2PKH());
        await transaction.addBroadcast({ fund });
        transaction
            .addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH())
            .addOutput({
                to: userWallet.tokenAddress,
                amount: DustAmount,
            });

        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('broadcast new fund tx size', response.hex.length / 2);
    });

    it('should reconstruct broadcast fund', async ({ expect }) => {
        const transaction = new PublicFundTransactionBuilder({ provider, system });
        const { publicFundContract } = transaction.getContracts();

        const utxos = await publicFundContract.getUtxos();

        const fundParts = utxos.filter(u => u.token.nft.capability === 'none');
        let fundHex = '';

        fundParts.forEach(p => fundHex += p.token.nft.commitment);
        
        expect(getFundHex(fund)).to.equal(fundHex);
        
        const decodedFund = decodeFund(fundHex);

        expect(decodedFund.category).to.equal(fund.category);
        expect(decodedFund.amount).to.equal(fund.amount);
        expect(decodedFund.satoshis).to.equal(fund.satoshis);

        expect(decodedFund.assets[0].category).to.equal(fund.assets[0].category);
        expect(decodedFund.assets[0].amount).to.equal(fund.assets[0].amount);

        expect(decodedFund.assets[1].category).to.equal(fund.assets[1].category);
        expect(decodedFund.assets[1].amount).to.equal(fund.assets[1].amount);

        expect(decodedFund.assets[2].category).to.equal(fund.assets[2].category);
        expect(decodedFund.assets[2].amount).to.equal(fund.assets[2].amount);
    });

    it('should complete an inflow tx', async ({ expect }) => {
        const userWallet = generateWallet({ network });
        const feeUtxo = randomUtxo({ satoshis: 110000n });
        const inflowAmount = 3n;
        const assetUtxos = fund.assets.map(a => randomUtxo({ token: randomToken({ ...a, amount: (a.amount * inflowAmount) + 1n }) }));

        addUtxos(userWallet.tokenAddress, [feeUtxo, ...assetUtxos]);

        const transaction = new FundTokenTransactionBuilder({ provider, system: { ...system, fee: system.fees.execute }, fund });
        await transaction.addInflow({ amount: inflowAmount });
        transaction
            .addInputs([feeUtxo, ...assetUtxos], userWallet.signatureTemplate.unlockP2PKH())
            .addOutput({
                to: userWallet.tokenAddress,
                amount: DustAmount,
                token: {
                    category: fund.category,
                    amount: inflowAmount * fund.amount,
                }
            })
            .addOutputs(fund.assets.map(a => ({
                to: userWallet.tokenAddress,
                amount: DustAmount,
                token: {
                    category: a.category,
                    amount: 1n,
                }
            })));
        
        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('inflow tx size', response.hex.length / 2);
    });

    it('should complete an outflow tx', async ({ expect }) => {
        const userWallet = generateWallet({ network });
        const feeUtxo = randomUtxo({ satoshis: 1000000n });
        const outflowAmount = 2n;
        const fundTokenUtxo = randomUtxo({
            token: randomToken({
                category: fund.category,
                amount: (outflowAmount * fund.amount) + 1n,
            })
        });

        addUtxos(userWallet.tokenAddress, [feeUtxo, fundTokenUtxo]);

        const transaction = new FundTokenTransactionBuilder({ provider, system: { ...system, fee: system.fees.execute }, fund });
        await transaction.addOutflow({ amount: outflowAmount });
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
                token: {
                    category: fund.category,
                    amount: 1n,
                }
            });
        
        expect(transaction).not.toFailRequire();
                
        const response = await transaction.send();
        console.log('outflow tx size', response.hex.length / 2);
    });

    it('should allow closing fee threads', async () => {
        const feeUtxo = randomUtxo({ satoshis: 10000n });
        const transaction = new SystemTransactionBuilder({ provider, system, allowImplicitFungibleTokenBurn: true });
        const signature = systemOwnerWallet.signatureTemplate;

        addUtxos(systemOwnerWallet.tokenAddress, [feeUtxo]);

        await transaction.closeCreateFundFee({ signature });
        await transaction.closeExecuteFundFee({ signature });
        transaction.addInput(feeUtxo, systemOwnerWallet.signatureTemplate.unlockP2PKH());
        transaction.addOutput({
            to: systemOwnerWallet.tokenAddress,
            amount: DustAmount,
        });

        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('close fee threads tx size', response.hex.length / 2);
    });
});