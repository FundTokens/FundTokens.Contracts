import { describe, expect, it } from 'vitest';
import { encodeCashAddress } from '@bitauth/libauth';
import { dustThreshold, withDust } from '../outputs.js';
import { FundTokensError, isFundTokensError, RegistryError } from '../errors.js';
import { getAddressPrefix } from '../network.js';
import { shuffle } from '../random.js';
import { assertCategory, toBigInt } from '../validation.js';

const p2sh32 = (() => {
    const encoded = encodeCashAddress({ prefix: 'bchtest', type: 'p2shWithTokens', payload: new Uint8Array(32).fill(7) });
    return typeof encoded === 'string' ? encoded : encoded.address;
})();

describe('toBigInt', () => {
    it('accepts bigints, safe integers and decimal strings', () => {
        expect(toBigInt(5n, 'x')).toBe(5n);
        expect(toBigInt(5, 'x')).toBe(5n);
        expect(toBigInt(' 9223372036854775807 ', 'x')).toBe(9223372036854775807n);
        expect(toBigInt('-3', 'x')).toBe(-3n);
    });

    it.each([1.5, Number.MAX_SAFE_INTEGER + 1, '1e3', '0x10', '', null, undefined, {}])('rejects %s', value => {
        expect(() => toBigInt(value, 'field')).toThrow(/field must be an integer/);
    });
});

describe('assertCategory', () => {
    it('lowercases valid categories and names the field on failure', () => {
        expect(assertCategory('AB'.repeat(32), 'c')).toBe('ab'.repeat(32));
        expect(() => assertCategory('ab'.repeat(31), 'fund.category')).toThrow(/fund\.category must be a 32-byte hex/);
    });
});

describe('dust', () => {
    it('sizes NFT commitments as bytes, not hex characters', () => {
        const token = (bytes: number) => ({ category: '11'.repeat(32), amount: 0n, nft: { capability: 'none' as const, commitment: 'ab'.repeat(bytes) } });
        expect(dustThreshold({ to: p2sh32 })).toBe(576n);
        expect(dustThreshold({ to: p2sh32, token: token(0) })).toBe(678n);
        expect(dustThreshold({ to: p2sh32, token: token(33) })).toBe(780n);
        expect(dustThreshold({ to: p2sh32, token: token(128) })).toBe(1065n);
    });

    it('builds outputs carrying exactly the dust minimum', () => {
        const token = { category: '11'.repeat(32), amount: 5n };
        expect(withDust({ to: p2sh32, token })).toEqual({ to: p2sh32, amount: dustThreshold({ to: p2sh32, token }), token });
        expect(withDust({ to: p2sh32 })).toEqual({ to: p2sh32, amount: 576n });
    });

    it('rejects invalid addresses', () => {
        expect(() => withDust({ to: 'bchtest:nope' })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    });
});

describe('errors', () => {
    it('identifies library errors by code', () => {
        const error = new RegistryError('REGISTRY_NOT_FOUND', 'missing', { url: 'https://x/', status: 404 });
        expect(error).toBeInstanceOf(FundTokensError);
        expect(isFundTokensError(error)).toBe(true);
        expect(isFundTokensError(error, 'REGISTRY_NOT_FOUND')).toBe(true);
        expect(isFundTokensError(error, 'MISSING_UTXO')).toBe(false);
        expect(isFundTokensError(new Error('x'))).toBe(false);
    });
});

describe('helpers', () => {
    it('maps networks to address prefixes', () => {
        expect(getAddressPrefix('mainnet')).toBe('bitcoincash');
        expect(getAddressPrefix('chipnet')).toBe('bchtest');
        expect(getAddressPrefix('mocknet')).toBe('bchtest');
        expect(getAddressPrefix('regtest')).toBe('bchreg');
    });

    it('shuffles into a new array holding the same items', () => {
        const items = Array.from({ length: 50 }, (_, i) => i);
        const shuffled = shuffle(items);
        expect(shuffled).not.toBe(items);
        expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    });
});
