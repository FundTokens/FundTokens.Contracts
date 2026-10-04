import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { delay, http, HttpResponse } from 'msw';

import { FundTokensRegistry } from '../FundTokensRegistry.js';
import { RegistryError } from '../../core/errors.js';
import { FixedBasket } from '../../fund-types/index.js';

const baseUrl = 'https://registry.example/';
const api = (path: string) => new URL(path, baseUrl).toString();

const parameters = {
    inflow: 'e0d54a60c24356a3b82d080bcc660fe8969e66a11c2274fd98270ce4e78c94f7',
    outflow: '59d7bc4b04bf55911702ae29f2f56d87007db1acd30d58d47ae72233404ba296',
    publicFund: '29c32af5e8e1a4ba7813d5d89b76aa128f469f2fa4cc05223498814df3fbac74',
    authorization: 'b10d6a2922dfd02871608facc759820a5e5e8716581c789f971a239e1c059ccd',
    fees: {
        create: { nft: '84e8bcdc849e84ce75d08fc506fb5d17eaf648ed30954aa205debfdb9e43650d', value: 10000 },
        execute: { nft: 'a6d1374bf1c723700d9078b1b49cff75de19c1f73ab58bb1acef67b36824046d', value: 1000 },
    },
};

const instance = (id: number, overrides: Record<string, unknown> = {}) => ({
    id,
    name: `instance ${id}`,
    network: 'chipnet',
    type: 'fixed-basket',
    status: 'main',
    version: 'v1',
    txid: '25ba2ba581763504fd6b5b8d50d0697b927e9dd76b320bde9040ceddd44e69dd',
    parameters,
    syncedHeight: 324608,
    createdAt: '2026-09-21T04:11:12.004Z',
    updatedAt: '2026-09-22T19:09:42.484Z',
    ...overrides,
});

const fund = (n: number) => ({
    category: n.toString(16).padStart(64, '0'),
    instanceId: 1,
    genesisTxid: n.toString(16).padStart(64, 'a'),
    genesisHeight: 319239,
    genesisTimestamp: 1786882735,
    lockingBytecode: 'aa20' + '11'.repeat(32) + '87',
    fund: { category: n.toString(16).padStart(64, '0'), amount: '1', satoshis: '1000', assets: [{ category: 'bb'.repeat(32), amount: '100' }] },
    authheadTxid: n.toString(16).padStart(64, 'a'),
    authheadHeight: 319239,
    burned: false,
    createdAt: '2026-09-21T04:11:30.962Z',
    updatedAt: '2026-09-21T04:11:30.962Z',
});

const healthy = {
    status: 'ok',
    network: 'chipnet',
    uptimeSeconds: 74,
    electrum: { connected: true, host: 'chipnet.imaginary.cash' },
    sync: { running: false, lastRunAt: '2026-09-22T19:09:42.485Z', lastChainHeight: 324608, consecutiveFailures: 0, lastError: null, reorgsHandled: 0 },
    registry: { version: '0.2.0', funds: 4, pendingMetadata: 0 },
};

const allFunds = Array.from({ length: 5 }, (_, i) => fund(i + 1));
let instancesRequests = 0;

const server = setupServer(
    http.get(api('api/health'), () => HttpResponse.json(healthy)),
    http.get(api('api/health/live'), () => HttpResponse.json({ status: 'ok' })),
    http.get(api('api/instances'), () => {
        instancesRequests += 1;
        return HttpResponse.json({
            current: { 'fixed-basket': 1, 'mean-reversion': null },
            instances: [instance(1), instance(2, { status: 'dep', version: '0.1.0-rc14' })],
        });
    }),
    http.get(api('api/funds'), ({ request }) => {
        const query = new URL(request.url).searchParams;
        const limit = Number(query.get('limit'));
        const offset = Number(query.get('offset'));
        return HttpResponse.json({ total: allFunds.length, limit, offset, funds: allFunds.slice(offset, offset + limit) });
    }),
    http.get(api('api/funds/:category'), ({ params }) => {
        const found = allFunds.find(f => f.category === params.category);
        return found
            ? HttpResponse.json({ ...found, authchain: [], identityHistory: [] })
            : HttpResponse.json({ error: 'Not Found', message: 'Unknown fund category' }, { status: 404 });
    }),
    http.get(api('api/registry/versions'), () =>
        HttpResponse.json({ versions: [{ id: 2, version: '0.2.0', contentHash: 'ab', identities: 4, createdAt: '2026-09-21T04:11:30.963Z' }] })),
    http.get(api('.well-known/bitcoin-cash-metadata-registry.json'), () =>
        HttpResponse.json({ $schema: 'https://cashtokens.org/bcmr-v2.schema.json', version: { major: 0, minor: 2, patch: 0 }, identities: {} })),
);

describe('FundTokensRegistry', () => {
    beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
    afterEach(() => {
        server.resetHandlers();
        instancesRequests = 0;
    });
    afterAll(() => server.close());

    const registry = () => new FundTokensRegistry({ url: baseUrl });

    describe('construction', () => {
        it('defaults to the chipnet public registry', () => {
            const client = new FundTokensRegistry();
            expect(client.network).toBe('chipnet');
            expect(client.url).toBe('https://chipnet-registry.fundtokens.cash/');
        });

        it('derives the URL from the network and normalises a missing trailing slash', () => {
            expect(new FundTokensRegistry({ network: 'mainnet' }).url).toBe('https://mainnet-registry.fundtokens.cash/');
            expect(new FundTokensRegistry({ url: 'http://localhost:3002' }).url).toBe('http://localhost:3002/');
        });

        it('rejects malformed options', () => {
            expect(() => new FundTokensRegistry({ url: 'not a url' })).toThrow(/absolute URL/);
            expect(() => new FundTokensRegistry({ network: 'chip net/../x' })).toThrow(/plain name/);
        });
    });

    describe('health', () => {
        it('reports a healthy registry as ready', async () => {
            const health = await registry().getHealth();
            expect(health.ready).toBe(true);
            expect(health.httpStatus).toBe(200);
            expect(health.registry?.funds).toBe(4);
        });

        it('reports a degraded registry (503) as not ready without throwing', async () => {
            server.use(http.get(api('api/health'), () => HttpResponse.json({ ...healthy, status: 'degraded' }, { status: 503 })));
            const health = await registry().getHealth();
            expect(health).toMatchObject({ ready: false, httpStatus: 503, status: 'degraded' });
        });

        it('reports an unreachable registry as not ready without throwing', async () => {
            server.use(http.get(api('api/health'), () => HttpResponse.error()));
            const health = await registry().getHealth();
            expect(health).toMatchObject({ ready: false, httpStatus: 0, status: 'unreachable' });
            expect(health.error).toBeTruthy();
        });

        it('checks liveness', async () => {
            expect(await registry().isLive()).toBe(true);
            server.use(http.get(api('api/health/live'), () => new HttpResponse(null, { status: 500 })));
            expect(await registry().isLive()).toBe(false);
        });
    });

    describe('instances', () => {
        it('lists instances, optionally by fund type', async () => {
            const client = registry();
            expect(await client.getInstances()).toHaveLength(2);
            expect(await client.getInstances({ type: 'fixed-basket' })).toHaveLength(2);
            expect(await client.getInstances({ type: 'mean-reversion' })).toHaveLength(0);
        });

        it('accepts a fund type descriptor in place of its key', async () => {
            const client = registry();
            expect((await client.getCurrentInstance(FixedBasket)).id).toBe(1);
            expect((await client.getCurrentInstance('fixed-basket')).id).toBe(1);
            expect(await client.getInstances({ type: FixedBasket })).toHaveLength(2);
        });

        it('returns the current instance ids per type', async () => {
            expect(await registry().getCurrentInstanceIds()).toEqual({ 'fixed-basket': 1, 'mean-reversion': null });
        });

        it('finds an instance by id', async () => {
            const client = registry();
            expect((await client.getInstance(2))?.status).toBe('dep');
            expect(await client.getInstance(99)).toBeUndefined();
        });

        it('throws REGISTRY_NOT_FOUND when a type has no current instance', async () => {
            await expect(registry().getCurrentInstance('mean-reversion')).rejects.toMatchObject({ code: 'REGISTRY_NOT_FOUND' });
            await expect(registry().getCurrentInstance('unknown-type')).rejects.toBeInstanceOf(RegistryError);
        });

        it('returns copies, so callers cannot corrupt the cache', async () => {
            const client = registry();
            const first = await client.getCurrentInstance(FixedBasket);
            (first.parameters as Record<string, unknown>).inflow = 'tampered';
            const second = await client.getCurrentInstance(FixedBasket);
            expect(second.parameters.inflow).toBe(parameters.inflow);
            expect(second).not.toBe(first);
        });

        it('caches instance listings and shares in-flight requests', async () => {
            const client = registry();
            await Promise.all([client.getInstances(), client.getCurrentInstance(FixedBasket), client.getInstance(1)]);
            await client.getCurrentInstanceIds();
            expect(instancesRequests).toBe(1);

            client.clearCache();
            await client.getInstances();
            expect(instancesRequests).toBe(2);
        });

        it('does not cache when cacheTtlMs is 0', async () => {
            const client = new FundTokensRegistry({ url: baseUrl, cacheTtlMs: 0 });
            await client.getInstances();
            await client.getInstances();
            expect(instancesRequests).toBe(2);
        });

        it('does not cache failures', async () => {
            const client = registry();
            server.use(http.get(api('api/instances'), () => HttpResponse.json({ error: 'boom' }, { status: 500 }), { once: true }));
            await expect(client.getInstances()).rejects.toMatchObject({ code: 'REGISTRY_REQUEST_FAILED', status: 500 });
            expect(await client.getInstances()).toHaveLength(2);
        });

        it('yields parameters that the matching fund type version parses', async () => {
            const current = await registry().getCurrentInstance(FixedBasket);
            const version = FixedBasket.resolve(current);
            const system = version.parseSystemParameters(current.parameters);
            expect(version.id).toBe('v1');
            expect(system.fees.execute.value).toBe(1000n);
        });
    });

    describe('funds', () => {
        it('pages through funds', async () => {
            const page = await registry().getFunds({ limit: 2, offset: 2 });
            expect(page).toMatchObject({ total: 5, limit: 2, offset: 2 });
            expect(page.funds.map(f => f.category)).toEqual([allFunds[2]!.category, allFunds[3]!.category]);
        });

        it('iterates every fund across pages', async () => {
            const categories: string[] = [];
            for await (const f of registry().iterateFunds({ pageSize: 2 })) {
                categories.push(f.category);
            }
            expect(categories).toEqual(allFunds.map(f => f.category));
        });

        it('returns a fund with its history, and undefined for an unknown fund', async () => {
            const client = registry();
            const found = await client.getFund(allFunds[0]!.category);
            expect(found?.fund.amount).toBe('1');
            expect(found?.authchain).toEqual([]);
            expect(await client.getFund('ff'.repeat(32))).toBeUndefined();
        });

        it('parses a registry fund with the fixed basket fund parser', async () => {
            const found = await registry().getFund(allFunds[0]!.category);
            const parsed = FixedBasket.v1.parseFund(found!.fund);
            expect(parsed).toMatchObject({ amount: 1n, satoshis: 1000n, assets: [{ amount: 100n }] });
        });

        it('validates the category before asking the registry', async () => {
            await expect(registry().getFund('not-a-category')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        });
    });

    describe('metadata', () => {
        it('lists registry document versions', async () => {
            expect(await registry().getDocumentVersions()).toEqual([expect.objectContaining({ version: '0.2.0' })]);
        });

        it('fetches the BCMR document', async () => {
            expect(await registry().getMetadataRegistry()).toHaveProperty('identities');
        });
    });

    describe('errors', () => {
        it('reports HTTP errors with the status and server message', async () => {
            server.use(http.get(api('api/registry/versions'), () => HttpResponse.json({ error: 'x', message: 'database locked' }, { status: 500 })));
            const error = await registry().getDocumentVersions().catch(e => e);
            expect(error).toBeInstanceOf(RegistryError);
            expect(error).toMatchObject({ code: 'REGISTRY_REQUEST_FAILED', status: 500, url: api('api/registry/versions') });
            expect(error.message).toMatch(/database locked/);
        });

        it('rejects responses that are not JSON', async () => {
            server.use(http.get(api('api/instances'), () => HttpResponse.text('OK')));
            await expect(registry().getInstances()).rejects.toMatchObject({ code: 'REGISTRY_INVALID_RESPONSE' });
        });

        it('rejects responses with the wrong shape, naming the URL', async () => {
            // The legacy registry keyed instances by hash rather than returning { current, instances }.
            server.use(http.get(api('api/instances'), () => HttpResponse.json({ hash: instance(1) })));
            await expect(registry().getInstances()).rejects.toMatchObject({
                code: 'REGISTRY_INVALID_RESPONSE',
                url: api('api/instances'),
            });
        });

        it('times out slow requests', async () => {
            server.use(http.get(api('api/registry/versions'), async () => {
                await delay(500);
                return HttpResponse.json({ versions: [] });
            }));
            const client = new FundTokensRegistry({ url: baseUrl, timeoutMs: 50 });
            await expect(client.getDocumentVersions()).rejects.toThrow(/timed out after 50ms/);
        });

        it('uses a supplied fetch implementation', async () => {
            const calls: string[] = [];
            const client = new FundTokensRegistry({
                url: 'https://custom.example/',
                fetch: async input => {
                    calls.push(String(input));
                    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
                },
            });
            expect(await client.isLive()).toBe(true);
            expect(calls).toEqual(['https://custom.example/api/health/live']);
        });
    });
});
