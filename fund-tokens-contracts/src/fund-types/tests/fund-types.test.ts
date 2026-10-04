import { describe, expect, it } from 'vitest';
import { fundTypes, getFundType, FixedBasket, BchUsdTargetBlend } from '../index.js';

describe('fund types', () => {
    it('are found by key', () => {
        expect(getFundType('fixed-basket')).toBe(FixedBasket);
        expect(getFundType('bch-usd-target-blend')).toBe(BchUsdTargetBlend);
        expect(getFundType('mean-reversion')).toBeUndefined();
    });

    it.each(fundTypes.map(t => [t.key, t] as const))('%s describes its versions consistently', (_, type) => {
        expect(Object.keys(type.versions)).toContain(type.latest);
        for (const [id, version] of Object.entries(type.versions)) {
            expect(version.id).toBe(id);
            expect(['supported', 'planned']).toContain(version.status);
        }
    });

    it('have unique keys', () => {
        expect(new Set(fundTypes.map(t => t.key)).size).toBe(fundTypes.length);
    });
});

describe('FixedBasket.resolve', () => {
    it('resolves an instance recording the contract version', () => {
        expect(FixedBasket.resolve({ type: 'fixed-basket', version: 'v1' })).toBe(FixedBasket.v1);
    });

    it('rejects an npm package version in place of the contract version', () => {
        expect(() => FixedBasket.resolve({ type: 'fixed-basket', version: '0.1.0-rc15' }))
            .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_FUND_TYPE', message: expect.stringMatching(/0\.1\.0-rc15/) }));
    });

    it('rejects instances of another type', () => {
        expect(() => FixedBasket.resolve({ type: 'bch-usd-target-blend', version: 'v1' })).toThrow(/is not Fixed Basket/);
    });
});
