import { describe, expect, it } from 'vitest';
import {
    decodeFund,
    decodeFundCommitment,
    getFundCommitment,
    getFundHex,
    hashFund,
    normalizeFund,
    parseFund,
    parseSystemParameters,
    type Fund,
} from '../index.js';
import { BitcoinCategory, MaxSatoshis, MaxTokenAmount } from '../../../../core/constants.js';

const cat = (byte: string) => byte.repeat(32);

const fund: Fund = {
    category: cat('77'),
    amount: 10n,
    satoshis: 1000n,
    assets: [{ category: cat('88'), amount: 2n }],
};

describe('fund encoding', () => {
    it('encodes to the documented layout', () => {
        expect(getFundHex(fund)).toBe(
            cat('77')
            + '0a00000000000000' // amount, 8 bytes LE
            + 'e8030000000000' // satoshis, 7 bytes LE
            + cat('88')
            + '0200000000000000',
        );
    });

    it('byte-reverses categories', () => {
        const category = '00'.repeat(31) + 'ff';
        expect(getFundHex({ ...fund, category }).slice(0, 64)).toBe('ff' + '00'.repeat(31));
    });

    it('round-trips through decodeFund, with assets in ascending order', () => {
        const unsorted: Fund = { ...fund, assets: [{ category: cat('99'), amount: 3n }, { category: cat('12'), amount: 4n }] };
        const decoded = decodeFund(getFundHex(unsorted));
        expect(decoded).toEqual({ ...unsorted, assets: [{ category: cat('12'), amount: 4n }, { category: cat('99'), amount: 3n }] });
    });

    it('hashes independently of asset order', () => {
        const a = { category: cat('12'), amount: 1n };
        const b = { category: cat('99'), amount: 1n };
        expect(hashFund({ ...fund, assets: [a, b] })).toBe(hashFund({ ...fund, assets: [b, a] }));
    });

    it('round-trips commitments and accepts uppercase hex', () => {
        const commitment = getFundCommitment(fund);
        expect(commitment.slice(0, 2)).toBe('02');
        expect(decodeFundCommitment(commitment.toUpperCase())).toEqual(fund);
    });

    it('rejects malformed fund encodings', () => {
        const hex = getFundHex(fund);
        expect(() => decodeFund('zz')).toThrow(expect.objectContaining({ code: 'INVALID_ENCODING' }));
        expect(() => decodeFund(hex.slice(0, 90))).toThrow(/invalid length/);
        expect(() => decodeFund(hex + '00')).toThrow(/invalid length/);
    });

    it('rejects commitments with the wrong type or a mismatched hash', () => {
        const commitment = getFundCommitment(fund);
        expect(() => decodeFundCommitment('01' + commitment.slice(2))).toThrow(/type must be 0x02/);
        const tampered = commitment.slice(0, -2) + '03';
        expect(() => decodeFundCommitment(tampered)).toThrow(/hash does not match/);
    });
});

describe('parseFund', () => {
    it('accepts amounts as bigint, number or decimal string and defaults optional fields', () => {
        expect(parseFund({ category: cat('77'), amount: '10', satoshis: 1000 })).toEqual({ ...fund, assets: [] });
        expect(parseFund({ category: cat('77'), amount: 1, assets: [{ category: cat('88'), amount: '5' }] }))
            .toEqual({ category: cat('77'), amount: 1n, satoshis: 0n, assets: [{ category: cat('88'), amount: 5n }] });
    });

    it('lowercases categories and freezes the result', () => {
        const parsed = parseFund({ ...fund, category: cat('AB') });
        expect(parsed.category).toBe(cat('ab'));
        expect(Object.isFrozen(parsed)).toBe(true);
        expect(Object.isFrozen(parsed.assets)).toBe(true);
    });

    it.each([
        ['a non-hex category', { ...fund, category: 'xyz' }, /fund\.category/],
        ['a fractional amount', { ...fund, amount: 1.5 }, /fund\.amount/],
        ['a zero amount', { ...fund, amount: 0n }, /fund\.amount must be between 1/],
        ['an amount above the token maximum', { ...fund, amount: MaxTokenAmount + 1n }, /fund\.amount/],
        ['negative satoshis', { ...fund, satoshis: -1n }, /fund\.satoshis/],
        ['satoshis above the BCH supply', { ...fund, satoshis: MaxSatoshis + 1n }, /fund\.satoshis/],
        ['no backing at all', { ...fund, satoshis: 0n, assets: [] }, /backed by satoshis/],
        ['a zero asset amount', { ...fund, assets: [{ category: cat('88'), amount: 0n }] }, /fund\.assets\[0\]\.amount/],
        ['a duplicated asset', { ...fund, assets: [{ category: cat('88'), amount: 1n }, { category: cat('88'), amount: 2n }] }, /more than once/],
        ['BCH listed as an asset', { ...fund, assets: [{ category: BitcoinCategory, amount: 1n }] }, /fund\.satoshis for BCH/],
        ['its own token as an asset', { ...fund, assets: [{ category: cat('77'), amount: 1n }] }, /its own token/],
    ])('rejects %s', (_, input, message) => {
        expect(() => parseFund(input)).toThrow(message);
    });

    it('normalizeFund skips value checks, for building deliberately invalid transactions', () => {
        expect(normalizeFund({ ...fund, amount: 0n }).amount).toBe(0n);
    });
});

describe('parseSystemParameters', () => {
    const json = {
        inflow: cat('11'),
        outflow: cat('22'),
        publicFund: cat('33'),
        authorization: cat('44'),
        fees: { create: { nft: cat('55'), value: 10000 }, execute: { nft: cat('66'), value: 1000 } },
    };

    it('converts registry JSON to bigint fees and lowercase categories', () => {
        const system = parseSystemParameters({ ...json, inflow: cat('AA') });
        expect(system.inflow).toBe(cat('aa'));
        expect(system.fees).toEqual({ create: { nft: cat('55'), value: 10000n }, execute: { nft: cat('66'), value: 1000n } });
        expect(Object.isFrozen(system.fees.create)).toBe(true);
    });

    it('is idempotent', () => {
        const system = parseSystemParameters(json);
        expect(parseSystemParameters(system)).toEqual(system);
    });

    it.each([
        ['a missing category', { ...json, outflow: undefined }, /system\.outflow/],
        ['missing fees', { ...json, fees: undefined }, /system\.fees must be an object/],
        ['a malformed fee NFT', { ...json, fees: { ...json.fees, create: { nft: 'nope', value: 1 } } }, /system\.fees\.create\.nft/],
        ['a negative fee', { ...json, fees: { ...json.fees, execute: { nft: cat('66'), value: -1 } } }, /system\.fees\.execute\.value/],
        ['an unsafe fee number', { ...json, fees: { ...json.fees, execute: { nft: cat('66'), value: 1e20 } } }, /system\.fees\.execute\.value/],
        ['a reused category', { ...json, outflow: cat('11') }, /distinct/],
        ['a non-object', 'parameters', /system must be an object/],
    ])('rejects %s', (_, input, message) => {
        expect(() => parseSystemParameters(input)).toThrow(message);
    });
});
