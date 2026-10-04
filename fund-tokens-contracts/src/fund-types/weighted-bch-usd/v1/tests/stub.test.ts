import { describe, expect, it } from 'vitest';
import { MockNetworkProvider } from 'cashscript';
import { WeightedBchUsd } from '../../../index.js';

describe('Weighted BCH/USD v1 (planned)', () => {
    const provider = new MockNetworkProvider();

    it('is declared but not usable', () => {
        expect(WeightedBchUsd.v1.status).toBe('planned');
        expect(() => WeightedBchUsd.resolve({ type: 'weighted-bch-usd', version: 'v1' }))
            .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_FUND_TYPE', message: expect.stringMatching(/planned/) }));
    });

    it('throws NOT_IMPLEMENTED from its builders and parsers', () => {
        const notImplemented = expect.objectContaining({ code: 'NOT_IMPLEMENTED' });
        expect(() => new WeightedBchUsd.v1.PublicFundTransactionBuilder({ provider, system: {} })).toThrow(notImplemented);
        expect(() => new WeightedBchUsd.v1.FundTokenTransactionBuilder({ provider, system: {}, fund: { category: '00'.repeat(32) } }))
            .toThrow(notImplemented);
        expect(() => WeightedBchUsd.v1.parseSystemParameters({})).toThrow(notImplemented);
    });
});
