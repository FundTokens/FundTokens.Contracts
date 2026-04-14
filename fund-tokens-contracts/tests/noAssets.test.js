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
import SystemTransactionBuilder from '@internal/SystemTransactionBuilder.js';
import PublicFundTransactionBuilder from '@lib/PublicFundTransactionBuilder.js';
import FundTokenTransactionBuilder from '@lib/FundTokenTransactionBuilder.js';

describe('edge case test', () => {
    const network = Network.MOCKNET;
    const genesisPartial = { vout: 0, satoshis: DustAmount };

    ///
    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });
    const addUtxos = (address, utxos) => utxos.forEach(u => provider.addUtxo(address, u));

    const ownerWallet = generateWallet(network);

    const system = {
        inflow: '1111111111111111111111111111111111111111111111111111111111111111',
        outflow: '2222222222222222222222222222222222222222222222222222222222222222',
        publicFund: '3333333333333333333333333333333333333333333333333333333333333333',
        authHead: randomToken().category,
        owner: '4444444444444444444444444444444444444444444444444444444444444444',
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
        const authGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.owner });
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
                    category: system.owner,
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

    const fund = {
        category: '6666666666666666666666666666666666666666666666666666666666666666',
        amount: 1n,
        satoshis: 10000n,
        assets: []
    };

    it('should test new funds', async ({ expect }) => {
        const userWallet = generateWallet({ network });
        const fundGenesisUtxo = randomUtxo({ ...genesisPartial, txid: fund.category });
        const feeUtxo = randomUtxo({ satoshis: 100000n });

        addUtxos(userWallet.tokenAddress, [fundGenesisUtxo, feeUtxo]);

        const transaction = new PublicFundTransactionBuilder({ provider, system });
        transaction.addInput(fundGenesisUtxo, userWallet.signatureTemplate.unlockP2PKH());
        await transaction.addBroadcast({ fund });
        transaction.addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH());

        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('broadcast new fund tx size', response.hex.length / 2);
    });

    it('should reconstruct broadcast fund', async ({ expect }) => {
        const transaction = new PublicFundTransactionBuilder({ provider, system });
        const { publicFundVaultContract } = transaction.getContracts();

        const utxos = await publicFundVaultContract.getUtxos();

        const fundParts = utxos.filter(u => u.token.nft.capability === 'none');
        let fundHex = '';

        fundParts.forEach(p => fundHex += p.token.nft.commitment);
        
        expect(getFundHex(fund)).to.equal(fundHex);
        
        const decodedFund = decodeFund(fundHex);

        expect(decodedFund.category).to.equal(fund.category);
        expect(decodedFund.amount).to.equal(fund.amount);
        expect(decodedFund.satoshis).to.equal(fund.satoshis);

        expect(decodedFund.assets.length).to.equal(0);
    });

    it('should complete an inflow tx', async ({ expect }) => {
        const userWallet = generateWallet({ network });
        const feeUtxo = randomUtxo({ satoshis: 210000n });

        addUtxos(userWallet.tokenAddress, [feeUtxo]);

        const inflowAmount = 3n;

        const transaction = new FundTokenTransactionBuilder({ provider, system: { ...system, fee: system.fees.execute }, fund });
        await transaction.addInflow({ amount: inflowAmount });
        transaction
            .addInputs([feeUtxo], userWallet.signatureTemplate.unlockP2PKH())
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
        const feeUtxo = randomUtxo({ satoshis: 1000000n });
        const outflowAmount = 1n;
        const fundTokenUtxo = randomUtxo({
            token: randomToken({
                category: fund.category,
                amount: outflowAmount * fund.amount,
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
            });
        
        expect(transaction).not.toFailRequire();
                
        const response = await transaction.send();
        console.log('outflow tx size', response.hex.length / 2);
    });

    it('should allow closing fee threads', async () => {
        const feeUtxo = randomUtxo({ satoshis: 10000n });
        const authUtxo = (await provider.getUtxos(ownerWallet.tokenAddress))[0];
        const transaction = new SystemTransactionBuilder({ provider, system, allowImplicitFungibleTokenBurn: true });

        addUtxos(ownerWallet.tokenAddress, [feeUtxo]);

        await transaction.closeCreateFundFee();
        await transaction.closeExecuteFundFee();
        transaction
            .addInput(feeUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutput({
                to: ownerWallet.tokenAddress,
                amount: DustAmount,
                token: authUtxo.token,
            });

        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('close fee threads tx size', response.hex.length / 2);
    });
});