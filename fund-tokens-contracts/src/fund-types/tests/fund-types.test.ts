import { describe, expect, it } from 'vitest';
import { fundTypes, getFundType, TokenBasket, WeightedBchUsd } from '../index.js';

describe('fund types', () => {
    it('are found by library key or registry type', () => {
        expect(getFundType('token-basket')).toBe(TokenBasket);
        expect(getFundType('fixed-basket')).toBe(TokenBasket);
        expect(getFundType('weighted-bch-usd')).toBe(WeightedBchUsd);
        expect(getFundType('mean-reversion')).toBeUndefined();
    });

    it.each(fundTypes.map(t => [t.key, t] as const))('%s describes its versions consistently', (_, type) => {
        expect(Object.keys(type.versions)).toContain(type.latest);
        for (const [id, version] of Object.entries(type.versions)) {
            expect(version.id).toBe(id);
            expect(['supported', 'planned']).toContain(version.status);
        }
    });

    it('have unique keys and registry types', () => {
        expect(new Set(fundTypes.map(t => t.key)).size).toBe(fundTypes.length);
        expect(new Set(fundTypes.map(t => t.registryType)).size).toBe(fundTypes.length);
    });
});

describe('TokenBasket.resolve', () => {
    it('resolves an instance recording the contract version', () => {
        expect(TokenBasket.resolve({ type: 'fixed-basket', version: 'v1' })).toBe(TokenBasket.v1);
    });

    it('resolves releases whose contracts are identical to v1', () => {
        expect(TokenBasket.resolve({ type: 'fixed-basket', version: '0.1.0-rc14' })).toBe(TokenBasket.v1);
        expect(TokenBasket.resolve({ type: 'fixed-basket', version: '0.1.0-rc15' })).toBe(TokenBasket.v1);
    });

    it('rejects releases with different contracts', () => {
        expect(() => TokenBasket.resolve({ type: 'fixed-basket', version: '0.1.0-rc12' }))
            .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_FUND_TYPE', message: expect.stringMatching(/0\.1\.0-rc12/) }));
    });

    it('rejects instances of another type', () => {
        expect(() => TokenBasket.resolve({ type: 'weighted-bch-usd', version: 'v1' })).toThrow(/is not Token Basket/);
    });
});
