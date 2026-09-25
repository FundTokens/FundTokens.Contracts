import {
    MockNetworkProvider,
    Network,
    randomToken,
    randomUtxo,
    type Utxo,
} from 'cashscript';

import { generateWallet } from '@test-utils/wallet.js';

import { SystemFixture } from './support/system.js';
import {
    FundTokenTransactionBuilder,
    PublicFundTransactionBuilder,
    type Fund,
    decodeFundCommitment,
    getFundCommitment,
} from '../index.js';

const DustAmount = 1000n;

describe('edge case test', () => {
    const genesisPartial = { vout: 0, satoshis: DustAmount };

    ///
    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });
    const addUtxos = (address: string, utxos: Utxo[]) => utxos.forEach(u => provider.addUtxo(address, u));

    const ownerWallet = generateWallet();

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

    it('should initialize control tokens', async () => {
        const inflowGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.inflow });
        const outflowGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.outflow });
        const publicFundGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.publicFund });
        const createFundFeeGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.fees.create.nft });
        const executeFundFeeGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.fees.execute.nft });
        const authGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.authorization });
        const genesisInputs = [inflowGenesisUtxo, outflowGenesisUtxo, publicFundGenesisUtxo, createFundFeeGenesisUtxo, executeFundFeeGenesisUtxo];
        const feeUtxo = randomUtxo({ satoshis: 10000n });

        addUtxos(ownerWallet.tokenAddress, [feeUtxo, ...genesisInputs, authGenesisUtxo]);

        const transaction = new SystemFixture({ provider, system });
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
                        commitment: '01FFFF01',
                    }
                }
            });

        const response = await transaction.send();
        console.log('initialize system tx size', response.hex.length / 2);
    });

    it('should create new system threads', async () => {
        const feeUtxo = randomUtxo({ satoshis: 10000n });
        const authUtxo = (await provider.getUtxos(ownerWallet.tokenAddress))[0];
        const transaction = new SystemFixture({ provider, system });

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

        const response = await transaction.send();
        console.log('create new public fund threads tx size', response.hex.length / 2);
    });

    const fund: Fund = {
        category: '6666666666666666666666666666666666666666666666666666666666666666',
        amount: 1n,
        satoshis: 10000n,
        assets: [],
    };

    it('should test new funds', async () => {
        const userWallet = generateWallet();
        const fundGenesisUtxo = randomUtxo({ ...genesisPartial, txid: fund.category });
        const feeUtxo = randomUtxo({ satoshis: 100000n });

        addUtxos(userWallet.tokenAddress, [fundGenesisUtxo, feeUtxo]);

        const transaction = new PublicFundTransactionBuilder({ provider, system });
        transaction.addInput(fundGenesisUtxo, userWallet.signatureTemplate.unlockP2PKH());
        await transaction.addBroadcast({ fund });
        transaction.addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH());

        const response = await transaction.send();
        console.log('broadcast new fund tx size', response.hex.length / 2);
    });

    it('should reconstruct broadcast fund', async () => {
        const transaction = new PublicFundTransactionBuilder({ provider, system });
        const { publicFundVaultContract } = transaction.getContracts();

        const utxos = await publicFundVaultContract.getUtxos();

        const fundParts = utxos.filter(u => u.token?.nft?.capability === 'none');
        let fundHex = '';

        fundParts.forEach(p => fundHex += p.token!.nft!.commitment);
        
        expect(getFundCommitment(fund)).to.equal(fundHex);
        
        const decodedFund = decodeFundCommitment(fundHex);

        expect(decodedFund.category).to.equal(fund.category);
        expect(decodedFund.amount).to.equal(fund.amount);
        expect(decodedFund.satoshis).to.equal(fund.satoshis);

        expect(decodedFund.assets.length).to.equal(0);
    });

    it('should complete an inflow tx', async () => {
        const userWallet = generateWallet();
        const feeUtxo = randomUtxo({ satoshis: 210000n });

        addUtxos(userWallet.tokenAddress, [feeUtxo]);

        const inflowAmount = 3n;

        const transaction = new FundTokenTransactionBuilder({ provider, system, fund });
        await transaction.addInflow({ units: inflowAmount });
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

        const response = await transaction.send();
        console.log('inflow tx size', response.hex.length / 2);
    });

    it('should complete an outflow tx', async () => {
        const userWallet = generateWallet();
        const feeUtxo = randomUtxo({ satoshis: 1000000n });
        const outflowAmount = 1n;
        const fundTokenUtxo = randomUtxo({
            token: randomToken({
                category: fund.category,
                amount: outflowAmount * fund.amount,
            })
        });

        addUtxos(userWallet.tokenAddress, [feeUtxo, fundTokenUtxo]);

        const transaction = new FundTokenTransactionBuilder({ provider, system, fund });
        await transaction.addOutflow({ units: outflowAmount });
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
                
        const response = await transaction.send();
        console.log('outflow tx size', response.hex.length / 2);
    });

    it('should allow closing fee threads', async () => {
        const feeUtxo = randomUtxo({ satoshis: 10000n });
        const authUtxo = (await provider.getUtxos(ownerWallet.tokenAddress))[0];
        const transaction = new SystemFixture({ provider, system, allowImplicitFungibleTokenBurn: true });

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

        const response = await transaction.send();
        console.log('close fee threads tx size', response.hex.length / 2);
    });
});