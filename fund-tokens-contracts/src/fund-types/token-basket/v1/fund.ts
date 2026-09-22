import { BitcoinCategory, MaxSatoshis, MaxTokenAmount } from '../../../core/constants.js';
import { FundTokensError } from '../../../core/errors.js';
import { assertCategory, assertInRange, assertObject, toBigInt } from '../../../core/validation.js';
import { sortAssets } from './encoding.js';
import type { Fund, FundInput } from './types.js';

/**
 * Normalises a fund's shape without judging its values: amounts become bigint,
 * categories lowercase, assets sorted into contract order. Throws only on values
 * that cannot be represented at all (non-hex categories, non-integer amounts).
 */
export function normalizeFund(input: FundInput | Fund): Fund {
    const fund = assertObject(input, 'fund');
    const assets = fund.assets ?? [];
    if (!Array.isArray(assets)) {
        throw new FundTokensError('INVALID_ARGUMENT', 'fund.assets must be an array');
    }

    return Object.freeze({
        category: assertCategory(fund.category, 'fund.category'),
        amount: toBigInt(fund.amount, 'fund.amount'),
        satoshis: toBigInt(fund.satoshis ?? 0n, 'fund.satoshis'),
        assets: Object.freeze(sortAssets(assets.map((value: unknown, i: number) => {
            const asset = assertObject(value, `fund.assets[${i}]`);
            return Object.freeze({
                category: assertCategory(asset.category, `fund.assets[${i}].category`),
                amount: toBigInt(asset.amount, `fund.assets[${i}].amount`),
            });
        }))),
    });
}

/**
 * Checks a fund against the rules the contracts enforce, plus a few they cannot
 * express but that would make a fund unusable. Throws `INVALID_ARGUMENT`.
 */
export function validateFund(fund: Fund): Fund {
    assertInRange(fund.amount, 'fund.amount', 1n, MaxTokenAmount);
    assertInRange(fund.satoshis, 'fund.satoshis', 0n, MaxSatoshis);

    if (fund.satoshis === 0n && fund.assets.length === 0) {
        throw new FundTokensError('INVALID_ARGUMENT', 'A fund must be backed by satoshis, at least one asset, or both');
    }

    const seen = new Set<string>();
    fund.assets.forEach((asset, i) => {
        assertInRange(asset.amount, `fund.assets[${i}].amount`, 1n, MaxTokenAmount);
        if (asset.category === BitcoinCategory) {
            throw new FundTokensError('INVALID_ARGUMENT', 'Use fund.satoshis for BCH backing, not an asset with the Bitcoin category');
        }
        if (asset.category === fund.category) {
            throw new FundTokensError('INVALID_ARGUMENT', 'A fund cannot hold its own token as an asset');
        }
        if (seen.has(asset.category)) {
            throw new FundTokensError('INVALID_ARGUMENT', `Asset ${asset.category} is listed more than once`);
        }
        seen.add(asset.category);
    });

    return fund;
}

/** `normalizeFund` then `validateFund`: the usual way to accept a fund from outside. */
export const parseFund = (input: FundInput | Fund): Fund => validateFund(normalizeFund(input));
