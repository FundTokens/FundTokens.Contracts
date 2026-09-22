import { beforeAll, describe, expect, it } from 'vitest';
import { MockNetworkProvider, randomToken, randomUtxo } from 'cashscript';
import { generateWallet } from '@test-utils/wallet.js';
import { FundTokensRegistry } from '../../registry/FundTokensRegistry.js';
import type { RegistryFund, RegistryInstance } from '../../registry/types.js';
import { FundTypeResolver, TokenBasket } from '../index.js';
import { bootstrapInstance, randomSystem, type TestInstance } from '../token-basket/v1/tests/support/bootstrap.js';

const { v1 } = TokenBasket;

/** System parameters as the registry serves them: JSON, fee values as numbers. */
const asRegistryJson = (system: TokenBasket.v1.SystemParameters) => ({
    ...system,
    fees: {
        create: { nft: system.fees.create.nft, value: Number(system.fees.create.value) },
        execute: { nft: system.fees.execute.nft, value: Number(system.fees.execute.value) },
    },
});

const registryInstance = (overrides: Partial<RegistryInstance> = {}): RegistryInstance => ({
    id: 1,
    name: 'test instance',
    network: 'chipnet',
    type: 'fixed-basket',
    status: 'main',
    version: 'v1',
    txid: null,
    parameters: asRegistryJson(randomSystem()),
    syncedHeight: 0,
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
    ...overrides,
});

const registryFund = (instanceId: number, overrides: Partial<RegistryFund['fund']> = {}): RegistryFund => ({
    category: '77'.repeat(32),
    instanceId,
    genesisTxid: '77'.repeat(32),
    genesisHeight: 1,
    genesisTimestamp: 1,
    lockingBytecode: '',
    fund: { category: '77'.repeat(32), amount: '10', satoshis: '1000', assets: [{ category: '88'.repeat(32), amount: '2' }], ...overrides },
    authheadTxid: '77'.repeat(32),
    authheadHeight: 1,
    burned: false,
    createdAt: '',
    updatedAt: '',
});

describe('FundTypeResolver', () => {
    const provider = new MockNetworkProvider();
    const resolver = new FundTypeResolver({ provider });

    describe('supports', () => {
        it.each([
            ['the contract version id', { type: 'fixed-basket', version: 'v1' }, true],
            ['a release with identical contracts', { type: 'fixed-basket', version: '0.1.0-rc15' }, true],
            ['a release with different contracts', { type: 'fixed-basket', version: '0.1.0-rc12' }, false],
            ['an unknown fund type', { type: 'mean-reversion', version: 'v1' }, false],
            ['a library key instead of the registry type', { type: 'token-basket', version: 'v1' }, false],
            ['a planned fund type', { type: 'weighted-bch-usd', version: 'v1' }, false],
        ])('%s: %s', (_, instance, expected) => {
            expect(FundTypeResolver.supports(instance)).toBe(expected);
        });

        it('works as a filter callback', () => {
            const instances = [registryInstance(), registryInstance({ id: 2, version: '0.1.0-rc12' })];
            expect(instances.filter(FundTypeResolver.supports).map(i => i.id)).toEqual([1]);
        });
    });

    describe('resolve', () => {
        it('returns the matching version, with parsed parameters, contracts and builder classes', () => {
            const instance = registryInstance();
            const resolved = resolver.resolve(instance);

            expect(resolved).toBeInstanceOf(v1.TokenBasketInstance);
            expect(resolved).toMatchObject({ key: 'token-basket', registryType: 'fixed-basket', version: 'v1' });
            expect(resolved.system).toEqual(v1.parseSystemParameters(instance.parameters));
            expect(resolved.system.fees.execute.value).toBeTypeOf('bigint');
            expect(resolved.PublicFundTransactionBuilder).toBe(v1.PublicFundTransactionBuilder);
            expect(resolved.FundTokenTransactionBuilder).toBe(v1.FundTokenTransactionBuilder);

            const expected = v1.deriveSystemContracts(provider, resolved.system);
            expect(resolved.contracts.publicFundVaultContract.tokenAddress).toBe(expected.publicFundVaultContract.tokenAddress);
            expect(resolved.contracts.executeFundFeeContract.tokenAddress).toBe(expected.executeFundFeeContract.tokenAddress);
        });

        it('creates builders bound to the provider and parameters', () => {
            const resolved = resolver.resolve(registryInstance());
            const fund = registryFund(1).fund;

            const publicBuilder = resolved.createPublicFundBuilder({ maximumFeeSatoshis: 50_000n });
            expect(publicBuilder).toBeInstanceOf(v1.PublicFundTransactionBuilder);
            expect(publicBuilder.provider).toBe(provider);
            expect(publicBuilder.options.maximumFeeSatoshis).toBe(50_000n);

            const fundBuilder = resolved.createFundTokenBuilder(fund);
            expect(fundBuilder).toBeInstanceOf(v1.FundTokenTransactionBuilder);
            expect(fundBuilder.system).toEqual(resolved.system);
            expect(fundBuilder.contracts.fundContract.tokenAddress).toBe(resolved.getFundContracts(fund).fundContract.tokenAddress);
        });

        it.each([
            ['an unknown fund type', { type: 'mean-reversion' }, /not known/],
            ['an unsupported version', { version: '0.1.0-rc12' }, /not supported/],
            ['a planned fund type', { type: 'weighted-bch-usd' }, /planned/],
        ])('rejects %s', (_, overrides, message) => {
            expect(() => resolver.resolve(registryInstance(overrides)))
                .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_FUND_TYPE', message: expect.stringMatching(message) }));
        });

        it('rejects malformed parameters', () => {
            expect(() => resolver.resolve(registryInstance({ parameters: { inflow: 'nope' } })))
                .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
        });
    });

    describe('resolveFund', () => {
        it('parses a registry fund record and derives its contracts', () => {
            const instance = registryInstance({ id: 7 });
            const record = registryFund(7);
            const { fund, contracts, instance: resolved, createBuilder } = resolver.resolveFund(record, instance);

            expect(fund).toEqual({ category: '77'.repeat(32), amount: 10n, satoshis: 1000n, assets: [{ category: '88'.repeat(32), amount: 2n }] });
            expect(resolved.version).toBe('v1');
            expect(contracts.fundContract.tokenAddress).toBe(resolved.getFundContracts(fund).fundContract.tokenAddress);
            expect(createBuilder().fund).toEqual(fund);
        });

        it('rejects a fund from another instance', () => {
            expect(() => resolver.resolveFund(registryFund(2), registryInstance({ id: 1 })))
                .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', message: expect.stringMatching(/instance 2/) }));
        });

        it('rejects an invalid fund', () => {
            expect(() => resolver.resolveFund(registryFund(1, { amount: '0' }), registryInstance()))
                .toThrow(/fund\.amount/);
        });
    });

    it('accepts FundTokensRegistry output as-is', async () => {
        const instance = registryInstance();
        const record = registryFund(instance.id);
        const responses: Record<string, unknown> = {
            'api/instances': { current: { 'fixed-basket': instance.id }, instances: [instance] },
            [`api/funds/${record.category}`]: { ...record, authchain: [], identityHistory: [] },
        };
        const registry = new FundTokensRegistry({
            url: 'https://registry.example/',
            fetch: async input => new Response(JSON.stringify(responses[new URL(String(input)).pathname.slice(1)])),
        });

        const current = await registry.getCurrentInstance(TokenBasket);
        const fundRecord = (await registry.getFund(record.category))!;
        const owner = (await registry.getInstance(fundRecord.instanceId))!;

        expect(resolver.resolve(current).version).toBe('v1');
        expect(resolver.resolveFund(fundRecord, owner).fund.amount).toBe(10n);
    });
});

describe('FundTypeResolver on a live instance', () => {
    let testInstance: TestInstance;
    beforeAll(async () => {
        testInstance = await bootstrapInstance();
    });

    it('creates, mints and redeems a fund using only resolved classes', async () => {
        const { provider, system } = testInstance;
        const resolved = new FundTypeResolver({ provider }).resolve(registryInstance({ parameters: asRegistryJson(system) }));
        const user = generateWallet();
        const unlock = user.signatureTemplate.unlockP2PKH();

        // Create
        const genesis = randomUtxo({ vout: 0, satoshis: 1000n });
        const createFunding = randomUtxo({ satoshis: 100_000n });
        const asset = randomToken().category;
        [genesis, createFunding].forEach(u => provider.addUtxo(user.tokenAddress, u));
        const broadcast = resolved.createPublicFundBuilder().addInput(genesis, unlock);
        await broadcast.addBroadcast({ fund: { category: genesis.txid, amount: 10n, satoshis: 1000n, assets: [{ category: asset, amount: 2n }] } });
        await broadcast.addInput(createFunding, unlock).send();

        // Mint 1 unit: 10 fund tokens for 1000 sats + 2 of the asset
        const { fund, createBuilder } = resolved.forFund({ category: genesis.txid, amount: '10', satoshis: '1000', assets: [{ category: asset, amount: '2' }] });
        const deposit = randomUtxo({ token: { category: asset, amount: 2n } });
        const mintFunding = randomUtxo({ satoshis: 200_000n });
        [deposit, mintFunding].forEach(u => provider.addUtxo(user.tokenAddress, u));
        const mint = await createBuilder().addInflow({ units: 1n });
        await mint
            .addInputs([mintFunding, deposit], unlock)
            .addOutput({ to: user.tokenAddress, amount: 1000n, token: { category: fund.category, amount: 10n } })
            .send();

        // Redeem it
        const tokens = (await provider.getUtxos(user.tokenAddress)).find(u => u.token?.category === fund.category)!;
        const redeemFunding = randomUtxo({ satoshis: 200_000n });
        provider.addUtxo(user.tokenAddress, redeemFunding);
        const redeem = await createBuilder().addOutflow({ units: 1n });
        await redeem
            .addInputs([redeemFunding, tokens], unlock)
            .addOutput({ to: user.tokenAddress, amount: 1000n, token: { category: asset, amount: 2n } })
            .addOutput({ to: user.tokenAddress, amount: 1000n })
            .send();

        const custody = resolved.getFundContracts(fund);
        expect(await custody.assetContracts[0]!.getUtxos()).toHaveLength(0);
        expect(await custody.satoshiAssetContract!.getUtxos()).toHaveLength(0);
    });
});
