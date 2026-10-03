import {
    MockNetworkProvider,
    Network,
    randomToken,
} from 'cashscript';

import { bigIntToBinUint256BEClamped, binToHex } from '@bitauth/libauth'

import { generateWallet } from '@test-utils/wallet.js';

import { SystemFixture } from './support/system.js';
import {
    FundTokenTransactionBuilder,
    PublicFundTransactionBuilder,
} from '../index.js';
import { randomCategory, randomUtxo } from '@test-utils/random.js';

const DustAmount = 1065n;

describe('happy path', () => {
    const network = Network.MOCKNET;
    const genesisPartial = { vout: 0, satoshis: DustAmount };

    ///
    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });

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

    it('should initialize control tokens', async ({ expect }) => {
        const inflowGenesisUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ ...genesisPartial, txid: system.inflow }));
        const outflowGenesisUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ ...genesisPartial, txid: system.outflow }));
        const publicFundGenesisUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ ...genesisPartial, txid: system.publicFund }));
        const createFundFeeGenesisUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ ...genesisPartial, txid: system.fees.create.nft }));
        const executeFundFeeGenesisUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ ...genesisPartial, txid: system.fees.execute.nft }));
        const authGenesisUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ ...genesisPartial, txid: system.authorization }));
        const genesisInputs = [inflowGenesisUtxo, outflowGenesisUtxo, publicFundGenesisUtxo, createFundFeeGenesisUtxo, executeFundFeeGenesisUtxo];
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

        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('initialize system tx size', response.hex.length / 2);
    });

    it('should create new system threads', async ({ expect }) => {
        const feeUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ satoshis: 10000n }));
        const authUtxo = (await provider.getUtxos(ownerWallet.tokenAddress))[0];
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

        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('create new public fund threads tx size', response.hex.length / 2);
    });

    const numberOfFundAssets = 80;

    const fund = {
        category: '7777777777777777777777777777777777777777777777777777777777777777',
        amount: 10n,
        satoshis: 1000n,
        assets: Array.from({ length: numberOfFundAssets }, (_, index) => ({
            category: randomCategory(),
            amount: BigInt(index + 1),
        })),
    };

    it(`should broadcast a new fund of ${numberOfFundAssets} assets by buying more compute`, async ({ expect }) => {
        const userWallet = generateWallet();
        const fundGenesisUtxo = provider.addUtxo(userWallet.tokenAddress, randomUtxo({ ...genesisPartial, txid: fund.category }));
        const feeUtxo = provider.addUtxo(userWallet.tokenAddress, randomUtxo({ satoshis: 100000n }));

        const broadcast = async (padding: number) => {
            const transaction = new PublicFundTransactionBuilder({ provider, system });
            transaction.addInput(fundGenesisUtxo, userWallet.signatureTemplate.unlockP2PKH());
            await transaction.addBroadcast({ fund, padding });
            return transaction.addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH());
        };
        const PublicFundInput = 5;

        // An input's operation cost budget is (41 + its unlocking bytecode length) × 800. PublicFund's
        // unlocking bytecode doesn't grow with the fund, so past 78 assets broadcast() runs out of compute
        await expect(await broadcast(0)).toBeRejected(/operation cost density limit/);

        // Buy more: each byte of padding in PublicFund's unlocking bytecode adds 800 to its budget
        const padding = 100;
        const transaction = await broadcast(padding);
        const usage = transaction.getVmResourceUsage()[PublicFundInput]!;
        console.log(`broadcast() with ${padding} bytes of padding: ${usage.operationCost} of ${usage.maximumOperationCost} operation cost`);

        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('broadcast new fund tx size', response.hex.length / 2);
    });

    it('should complete an inflow tx', async ({ expect }) => {
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
            })))
            .addOutput({
                to: userWallet.tokenAddress,
                amount: DustAmount,
            });
        
        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('inflow tx size', response.hex.length / 2);
    });

    it('should complete an outflow tx', async ({ expect }) => {
        const userWallet = generateWallet();
        const feeUtxo = provider.addUtxo(userWallet.tokenAddress, randomUtxo({ satoshis: 1000000n }));
        const outflowAmount = 2n;
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
            })
            .addOutput({
                to: userWallet.tokenAddress,
                amount: DustAmount,
            });
        
        expect(transaction).not.toFailRequire();
                
        const response = await transaction.send();
        console.log('outflow tx size', response.hex.length / 2);
    }, 300_000);

    it('should allow closing fee threads', async () => {
        const feeUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ satoshis: 10000n }));
        const authUtxo = (await provider.getUtxos(ownerWallet.tokenAddress))[0];
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

        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('close fee threads tx size', response.hex.length / 2);
    });
});