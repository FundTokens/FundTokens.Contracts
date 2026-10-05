import {
    bigIntToBinUint64LEClamped,
    binToBigIntUint256BE,
    binToBigIntUint64LE,
    binToHex,
    hash256,
    hexToBin,
    swapEndianness,
} from '@bitauth/libauth';
import { FundTokensError } from '../../../core/errors.js';
import { isHex } from '../../../core/validation.js';
import type { Fund, FundAsset } from './types.js';

/**
 * Fund encoding (all integers little-endian):
 *
 *   category  32 bytes  (byte-reversed, as the VM sees it)
 *   amount     8 bytes
 *   satoshis   7 bytes
 *   per asset: category 32 bytes (byte-reversed) + amount 8 bytes
 *
 * 47 bytes plus 40 per asset. Commitments are 0x02 + hash256(fund) + fund.
 */
const FundHeaderHexLength = (32 + 8 + 7) * 2;
const AssetHexLength = (32 + 8) * 2;
const HashHexLength = 32 * 2;
const CommitmentType = '02';

/** Orders assets by category, compared as 256-bit big-endian integers (the order the contracts require). */
export function categoryAscending(a: { category: string }, b: { category: string }): number {
    const left = binToBigIntUint256BE(hexToBin(a.category));
    const right = binToBigIntUint256BE(hexToBin(b.category));
    return left === right ? 0 : left > right ? 1 : -1;
}

export const sortAssets = <T extends { category: string }>(assets: readonly T[]): T[] => [...assets].sort(categoryAscending);

/**
 * Encodes a fund as the contracts expect it. Assets are sorted first, so input order doesn't matter.
 *
 * Encoding does not validate: out-of-range amounts are clamped, not rejected.
 * Use `validateFund` (the builders do by default) to reject them.
 */
export function getFundHex(fund: Fund): string {
    const parts = [
        swapEndianness(fund.category),
        binToHex(bigIntToBinUint64LEClamped(fund.amount)),
        binToHex(bigIntToBinUint64LEClamped(fund.satoshis)).slice(0, 14),
    ];
    for (const asset of sortAssets(fund.assets)) {
        parts.push(swapEndianness(asset.category), binToHex(bigIntToBinUint64LEClamped(asset.amount)));
    }
    return parts.join('');
}

export const getFundBin = (fund: Fund): Uint8Array => hexToBin(getFundHex(fund));

/** hash256 of the fund encoding; what the contracts commit to. */
export const hashFund = (fund: Fund): string => binToHex(hash256(getFundBin(fund)));

/** The most padding one push can carry: a stack item is at most 10,000 bytes. */
export const MaxPaddingBytes = 10_000;

/**
 * Padding for `broadcast()`, `inflow()` and `outflow()`, which ignore it. An input's operation
 * cost budget is (41 + its unlocking bytecode length) × 800, so each byte of padding buys 800 more:
 * how a fund too large to process within the default budget pays for the compute it needs.
 */
export function getPadding(bytes: number): Uint8Array {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MaxPaddingBytes) {
        throw new FundTokensError('INVALID_ARGUMENT', `padding must be a whole number of bytes from 0 to ${MaxPaddingBytes}; got ${bytes}`);
    }
    return new Uint8Array(bytes);
}

/** The commitment of a fund's inflow and outflow threads: type byte, fund category (byte-reversed), fund hash. */
export const getThreadCommitment = (fund: Fund): string => CommitmentType + swapEndianness(fund.category) + hashFund(fund);

/** The full public fund commitment: type byte, fund hash, then the fund encoding. */
export function getFundCommitment(fund: Fund): string {
    const fundHex = getFundHex(fund);
    return CommitmentType + binToHex(hash256(hexToBin(fundHex))) + fundHex;
}

const invalidEncoding = (message: string) => new FundTokensError('INVALID_ENCODING', message);

/** Decodes the output of `getFundHex`. */
export function decodeFund(hex: string): Fund {
    if (!isHex(hex)) {
        throw invalidEncoding('Fund encoding must be an even-length hex string');
    }
    if (hex.length < FundHeaderHexLength || (hex.length - FundHeaderHexLength) % AssetHexLength !== 0) {
        throw invalidEncoding(
            `Fund encoding has an invalid length of ${hex.length / 2} bytes; expected 47 bytes plus 40 per asset`,
        );
    }
    const data = hex.toLowerCase();

    const assets: FundAsset[] = [];
    for (let offset = FundHeaderHexLength; offset < data.length; offset += AssetHexLength) {
        assets.push({
            category: swapEndianness(data.slice(offset, offset + 64)),
            amount: binToBigIntUint64LE(hexToBin(data.slice(offset + 64, offset + AssetHexLength))),
        });
    }

    return {
        category: swapEndianness(data.slice(0, 64)),
        amount: binToBigIntUint64LE(hexToBin(data.slice(64, 80))),
        satoshis: binToBigIntUint64LE(hexToBin(data.slice(80, 94) + '00')),
        assets,
    };
}

/** Decodes the output of `getFundCommitment`, verifying the embedded hash. */
export function decodeFundCommitment(hex: string): Fund {
    if (!isHex(hex)) {
        throw invalidEncoding('Fund commitment must be an even-length hex string');
    }
    const data = hex.toLowerCase();
    if (data.slice(0, 2) !== CommitmentType) {
        throw invalidEncoding(`Fund commitment type must be 0x${CommitmentType}, got 0x${data.slice(0, 2)}`);
    }
    const hash = data.slice(2, 2 + HashHexLength);
    const fundHex = data.slice(2 + HashHexLength);
    const fund = decodeFund(fundHex);
    if (hash !== binToHex(hash256(hexToBin(fundHex)))) {
        throw invalidEncoding('Fund commitment hash does not match the fund it carries');
    }
    return fund;
}
