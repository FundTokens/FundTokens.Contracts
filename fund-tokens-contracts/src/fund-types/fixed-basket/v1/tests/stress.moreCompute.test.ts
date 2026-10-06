import {
    MockNetworkProvider,
    Network,
} from 'cashscript';

import { generateWallet } from '@test-utils/wallet.js';

import { SystemFixture } from './support/system.js';
import {
    FundTokenTransactionBuilder,
    MaxFundAssets,
    PublicFundTransactionBuilder,
} from '../index.js';
import { randomCategory, randomUtxo } from '@test-utils/random.js';

const DustAmount = 1065n;

/** `total` split into `parts` positive amounts. */
const split = (total: bigint, parts: number): bigint[] => {
    const share = total / BigInt(parts);
    return Array.from({ length: parts }, (_, i) => (i < parts - 1 ? share : total - share * BigInt(parts - 1)));
};

describe(`stress: the largest fund the builders accept (${MaxFundAssets} assets)`, () => {
    const network = Network.MOCKNET;
    const genesisPartial = { vout: 0, satoshis: DustAmount };

    ///
    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });

    const ownerWallet = generateWallet();
    const holder = generateWallet();

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

    const numberOfFundAssets = MaxFundAssets;

    const fund = {
        category: '7777777777777777777777777777777777777777777777777777777777777777',
        amount: 10n,
        satoshis: 1000n,
        assets: Array.from({ length: numberOfFundAssets }, (_, index) => ({
            category: randomCategory(),
            amount: BigInt(index + 1),
        })),
    };

    // Every asset moves through several UTXOs: each deposit pays each asset from `inputsPerAsset`
    // UTXOs and leaves its own custody UTXO per asset, and the redemption releases
    // `releasedPerAsset` custody UTXOs of every asset into `outputsPerAsset` outputs per asset.
    // At this many assets, releasing every deposit's custody (three per asset), or paying each asset
    // out in two outputs, takes a redemption past the 100,000-byte standard transaction size.
    const inputsPerAsset = 2;
    const outputsPerAsset = 1;
    const deposits = 3;
    const unitsPerDeposit = 3n;
    const releasedPerAsset = 2;
    const redeemedUnits = unitsPerDeposit * BigInt(releasedPerAsset - 1) + 1n; // more than one deposit's custody

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

    it(`should refuse to build a fund of more than ${MaxFundAssets} assets`, async ({ expect }) => {
        const userWallet = generateWallet();
        const genesis = provider.addUtxo(userWallet.tokenAddress, randomUtxo({ ...genesisPartial, txid: randomCategory() }));
        const oversized = { ...fund, category: genesis.txid, assets: [...fund.assets, { category: randomCategory(), amount: 1n }] };

        // Every redemption releases every asset; past this size it nears the standard transaction size
        const transaction = new PublicFundTransactionBuilder({ provider, system });
        transaction.addInput(genesis, userWallet.signatureTemplate.unlockP2PKH());
        await expect(transaction.addBroadcast({ fund: oversized, padding: 1000 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        expect(() => new FundTokenTransactionBuilder({ provider, system, fund: oversized })).toThrow(/at most 100 assets/);
    });

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
        const padding = 300;
        const transaction = await broadcast(padding);
        const usage = transaction.getVmResourceUsage()[PublicFundInput]!;
        console.log(`broadcast() with ${padding} bytes of padding: ${usage.operationCost} of ${usage.maximumOperationCost} operation cost`);

        expect(transaction).not.toFailRequire();

        const response = await transaction.send();
        console.log('broadcast new fund tx size', response.hex.length / 2);
    });

    it.each(Array.from({ length: deposits }, (_, i) => i + 1))(`should complete inflow tx %i of ${deposits}, paying each asset from ${inputsPerAsset} UTXOs`, async () => {
        const feeUtxo = provider.addUtxo(holder.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));
        // Each asset comes from `inputsPerAsset` UTXOs, with one token of change
        const assetUtxos = fund.assets.flatMap(a => split(a.amount * unitsPerDeposit + 1n, inputsPerAsset)
            .map(amount => provider.addUtxo(holder.tokenAddress, randomUtxo({ token: { category: a.category, amount } }))));

        const transaction = new FundTokenTransactionBuilder({ provider, system, fund });
        await transaction.addInflow({ units: unitsPerDeposit });
        transaction
            .addInputs([feeUtxo, ...assetUtxos], holder.signatureTemplate.unlockP2PKH())
            .addOutput({
                to: holder.tokenAddress,
                amount: DustAmount,
                token: {
                    category: fund.category,
                    amount: unitsPerDeposit * fund.amount,
                }
            })
            .addOutputs(fund.assets.map(a => ({
                to: holder.tokenAddress,
                amount: DustAmount,
                token: {
                    category: a.category,
                    amount: 1n,
                }
            })))
            .addOutput({
                to: holder.tokenAddress,
                amount: DustAmount,
            });

        await expect(transaction).toBeAccepted();
        console.log('inflow tx size', transaction.build().length / 2);
    }, 300_000);

    it(`should refuse to build a redemption releasing all ${deposits} custody UTXOs per asset, naming the units that fit`, async () => {
        const transaction = new FundTokenTransactionBuilder({ provider, system, fund });
        await expect(transaction.addOutflow({ units: unitsPerDeposit * BigInt(deposits - 1) + 1n })).rejects.toMatchObject({
            code: 'TRANSACTION_TOO_LARGE',
            message: expect.stringContaining(`redeem at most ${unitsPerDeposit * BigInt(releasedPerAsset)} unit(s)`),
        });
    });

    it(`should complete an outflow tx releasing ${releasedPerAsset} custody UTXOs per asset into ${outputsPerAsset} outputs per asset`, async ({ expect }) => {
        const feeUtxo = provider.addUtxo(holder.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));
        const fundTokenUtxos = (await provider.getUtxos(holder.tokenAddress)).filter(u => u.token?.category === fund.category);
        const fundTokens = fundTokenUtxos.reduce((sum, u) => sum + u.token!.amount, 0n);

        const outflow = async (padding: number) => {
            const transaction = new FundTokenTransactionBuilder({ provider, system, fund });
            await transaction.addOutflow({ units: redeemedUnits, padding });
            return transaction
                .addInputs([feeUtxo, ...fundTokenUtxos], holder.signatureTemplate.unlockP2PKH())
                .addOutputs(fund.assets.flatMap(a => split(a.amount * redeemedUnits, outputsPerAsset).map(amount => ({
                    to: holder.tokenAddress,
                    amount: DustAmount,
                    token: {
                        category: a.category,
                        amount,
                    }
                }))))
                .addOutput({
                    to: holder.tokenAddress,
                    amount: DustAmount,
                    token: {
                        category: fund.category,
                        amount: fundTokens - redeemedUnits * fund.amount,
                    }
                })
                .addOutput({
                    to: holder.tokenAddress,
                    amount: DustAmount,
                });
        };
        // Releasing two custody UTXOs per asset fits the TransactionManager's budget without padding
        const padding = 0;
        const transaction = await outflow(padding);
        const custody = new Set(transaction.getContracts().assetContracts.map(contract => contract.lockingBytecode));
        expect(transaction.inputs.filter(u => custody.has(u.lockingBytecode))).toHaveLength(numberOfFundAssets * releasedPerAsset);

        await expect(transaction).toBeAccepted();
        console.log(`outflow() with ${padding} bytes of padding, ${transaction.inputs.length} inputs, ${transaction.outputs.length} outputs: tx size ${transaction.build().length / 2}`);
    }, 900_000);

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
