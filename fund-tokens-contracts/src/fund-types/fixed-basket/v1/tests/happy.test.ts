import {
    MockNetworkProvider,
    Network,
    randomToken,
    randomUtxo,
} from 'cashscript';

import { generateWallet } from '@test-utils/wallet.js';

import { SystemFixture } from './support/system.js';
import {
    FundTokenTransactionBuilder,
    PublicFundTransactionBuilder,
    categoryAscending,
    decodeFundCommitment,
    getFundCommitment,
} from '../index.js';
import { randomCategory } from '@test-utils/random.js';

const DustAmount = 1000n;
const DataDustAmount = 1065n;

describe('happy path', () => {
    const network = Network.MOCKNET;
    const genesisPartial = { vout: 0, satoshis: DustAmount };

    ///
    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });

    const ownerWallet = generateWallet();

    const system = {
        inflow: randomCategory(),
        outflow: randomCategory(),
        publicFund: randomCategory(),
        authorization: randomCategory(),
        fees: {
            create: {
                nft: randomCategory(),
                value: 10000n,
            },
            execute: {
                nft: randomCategory(),
                value: 100000n,
            }
        },
    };

    it('should initialize control tokens', async ({ expect }) => {
        const inflowGenesisUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ ...genesisPartial, txid: system.inflow }));
        const outflowGenesisUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ ...genesisPartial, txid: system.outflow }));
        const publicFundGenesisUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ ...genesisPartial, txid: system.publicFund }));
        const createFundFeeGenesisUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ ...genesisPartial, txid: system.fees.create.nft }));
        const executeFundFeeGenesisUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ ...genesisPartial, txid: system.fees.execute.nft }));
        const genesisInputs = [inflowGenesisUtxo, outflowGenesisUtxo, publicFundGenesisUtxo, createFundFeeGenesisUtxo, executeFundFeeGenesisUtxo];
        const authGenesisUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ ...genesisPartial, txid: system.authorization }));
        const feeUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ satoshis: 10000n }));

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

    it('should create new system threads', async ({ expect }) => {
        const feeUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ satoshis: 10000n }));
        const authUtxo = (await provider.getUtxos(ownerWallet.tokenAddress)).filter(u => u.token?.category === system.authorization)[0];
        const transaction = new SystemFixture({ provider, system });

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

    it('should create additional system threads', async ({ expect }) => {
        const feeUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ satoshis: 10000n }));
        const authUtxo = (await provider.getUtxos(ownerWallet.tokenAddress)).filter(u => u.token?.category === system.authorization)[0];
        const transaction = new SystemFixture({ provider, system });

        await transaction.addSystemThreads();
        await transaction.addCreateFundFee();
        await transaction.addExecuteFundFee();

        transaction
            .addInput(feeUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutput({
                to: ownerWallet.tokenAddress,
                amount: DustAmount,
                token: authUtxo.token,
            });

        const response = await transaction.send();
        console.log('create new public fund threads tx size', response.hex.length / 2);
    });

    const fund = {
        category: randomCategory(),
        amount: 10n,
        satoshis: 1000n,
        assets: [
            {
                category: randomCategory(),
                amount: 2n,
            },
            {
                category: randomCategory(),
                amount: 3n,
            },
            {
                category: randomCategory(),
                amount: 4n,
            },
        ].sort(categoryAscending)
    };

    it('should broadcast a new fund', async ({ expect }) => {
        const userWallet = generateWallet();
        const fundGenesisUtxo = provider.addUtxo(userWallet.tokenAddress, randomUtxo({ ...genesisPartial, txid: fund.category }));
        const feeUtxo = provider.addUtxo(userWallet.tokenAddress, randomUtxo({ satoshis: 100000n }));

        const transaction = new PublicFundTransactionBuilder({ provider, system });
        transaction.addInput(fundGenesisUtxo, userWallet.signatureTemplate.unlockP2PKH());
        await transaction.addBroadcast({ fund });
        transaction
            .addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH())
            .addOutput({
                to: userWallet.tokenAddress,
                amount: DustAmount,
            });

        const response = await transaction.send();
        console.log('broadcast new fund tx size', response.hex.length / 2);
    });

    it('should reconstruct broadcast fund', async ({ expect }) => {
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

        expect(decodedFund.assets[0].category).to.equal(fund.assets[0].category);
        expect(decodedFund.assets[0].amount).to.equal(fund.assets[0].amount);

        expect(decodedFund.assets[1].category).to.equal(fund.assets[1].category);
        expect(decodedFund.assets[1].amount).to.equal(fund.assets[1].amount);

        expect(decodedFund.assets[2].category).to.equal(fund.assets[2].category);
        expect(decodedFund.assets[2].amount).to.equal(fund.assets[2].amount);
    });

    it('should be able to prove public fund in a tx', async ({ expect }) => {
        const userWallet = generateWallet();
        const feeUtxo = provider.addUtxo(userWallet.tokenAddress, randomUtxo({ satoshis: 10000n }));

        const transaction = new PublicFundTransactionBuilder({ provider, system });
        const { publicFundVaultContract } = transaction.getContracts();

        const utxos = await publicFundVaultContract.getUtxos();

        transaction
            .addInput(utxos[0], publicFundVaultContract.unlock.proof())
            .addInputs(utxos.slice(1), publicFundVaultContract.unlock.data())
            .addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                ...utxos.map(u => ({
                    to: publicFundVaultContract.tokenAddress,
                    amount: DataDustAmount,
                    token: u.token,
                }))
            ]);
        const response = await transaction.send();
        console.log('prove a public fund on-chain - tx size', response.hex.length / 2);
    });

    it('should complete an inflow tx', async () => {
        const userWallet = generateWallet();
        const feeUtxo = provider.addUtxo(userWallet.tokenAddress, randomUtxo({ satoshis: 110000n }));
        const inflowAmount = 2n;
        const assetUtxos = fund.assets.map(a => provider.addUtxo(userWallet.tokenAddress, randomUtxo({ token: randomToken({ ...a, amount: (a.amount * inflowAmount) + 1n }) })));

        const transaction = new FundTokenTransactionBuilder({ provider, system, fund });
        await transaction.addInflow({ units: inflowAmount });
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

        const response = await transaction.send();
        console.log('inflow tx size', response.hex.length / 2);
    });

    it('should complete a second inflow tx', async () => {
        const userWallet = generateWallet();
        const feeUtxo = provider.addUtxo(userWallet.tokenAddress, randomUtxo({ satoshis: 110000n }));
        const inflowAmount = 3n;
        const assetUtxos = fund.assets.map(a => provider.addUtxo(userWallet.tokenAddress, randomUtxo({ token: randomToken({ ...a, amount: (a.amount * inflowAmount) + 1n }) })));

        const transaction = new FundTokenTransactionBuilder({ provider, system, fund });
        await transaction.addInflow({ units: inflowAmount });
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

        const response = await transaction.send();
        console.log('inflow tx size', response.hex.length / 2);
    });

    it('should complete an outflow tx', async ({ expect }) => {
        const userWallet = generateWallet();
        const feeUtxo = provider.addUtxo(userWallet.tokenAddress, randomUtxo({ satoshis: 1000000n }));
        const outflowAmount = 1n;
        const fundTokenUtxo = provider.addUtxo(userWallet.tokenAddress, randomUtxo({
            token: randomToken({
                category: fund.category,
                amount: (outflowAmount * fund.amount) + 1n,
            })
        }));

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
                token: {
                    category: fund.category,
                    amount: 1n,
                }
            });

        const response = await transaction.send();
        console.log('outflow tx size', response.hex.length / 2);
    });

    it('should allow delisting a public fund', async ({ expect }) => {
        const feeUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ satoshis: 10000n }));

        const authUtxo = (await provider.getUtxos(ownerWallet.tokenAddress)).filter(u => u.token?.category === system.authorization)[0];

        const transaction = new PublicFundTransactionBuilder({ provider, system, allowImplicitFungibleTokenBurn: true });
        const { publicFundVaultContract } = transaction.getContracts();

        const utxos = await publicFundVaultContract.getUtxos();

        transaction
            .addInput(utxos[0], publicFundVaultContract.unlock.burn())
            .addInputs(utxos.slice(1), publicFundVaultContract.unlock.data())
            .addInput(feeUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: authUtxo.token,
                }
            ]);
        expect(transaction).not.toFailRequire();
    });

    it('should allow closing fee threads', async () => {
        const feeUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ satoshis: 10000n }));
        const authUtxo = (await provider.getUtxos(ownerWallet.tokenAddress)).filter(u => u.token?.category === system.authorization)[0];
        const transaction = new SystemFixture({ provider, system, allowImplicitFungibleTokenBurn: true });

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