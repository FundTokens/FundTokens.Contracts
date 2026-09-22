/**
 * Runs against a real registry when FUNDTOKENS_REGISTRY_URL is set, e.g.
 *   FUNDTOKENS_REGISTRY_URL=http://localhost:3002 yarn test src/registry
 * Skipped otherwise. Read-only.
 */
import { describe, expect, it } from 'vitest';
import { FundTokensRegistry } from '../FundTokensRegistry.js';
import { getFundType, TokenBasket } from '../../fund-types/index.js';

const url = process.env.FUNDTOKENS_REGISTRY_URL;

describe.skipIf(!url)('FundTokensRegistry (live)', () => {
    const registry = new FundTokensRegistry({ url });

    it('is healthy', async () => {
        const health = await registry.getHealth();
        expect(health.error).toBeUndefined();
        expect(health.ready).toBe(true);
    });

    it('lists instances whose types this library recognises', async () => {
        const instances = await registry.getInstances();
        expect(instances.length).toBeGreaterThan(0);
        for (const instance of instances) {
            expect(typeof instance.id).toBe('number');
            expect(getFundType(instance.type), `unknown fund type '${instance.type}'`).toBeDefined();
        }
    });

    it('serves a current token basket instance with parseable parameters', async () => {
        const instance = await registry.getCurrentInstance(TokenBasket);
        expect(() => TokenBasket.v1.parseSystemParameters(instance.parameters)).not.toThrow();
    });

    it('pages funds and resolves each one', async () => {
        let seen = 0;
        for await (const fund of registry.iterateFunds({ pageSize: 2 })) {
            seen += 1;
            expect(() => TokenBasket.v1.parseFund(fund.fund)).not.toThrow();
            const detail = await registry.getFund(fund.category);
            expect(detail?.category).toBe(fund.category);
        }
        const { total } = await registry.getFunds({ limit: 1 });
        expect(seen).toBe(total);
    });

    it('serves registry metadata', async () => {
        expect(Array.isArray(await registry.getDocumentVersions())).toBe(true);
        expect(await registry.getMetadataRegistry()).toHaveProperty('identities');
    });
});
