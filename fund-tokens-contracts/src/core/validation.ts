import { FundTokensError } from './errors.js';

/** Amounts may be given as bigint, a safe integer number, or a decimal string (as JSON APIs return them). */
export type BigIntish = bigint | number | string;

const HexPattern = /^(?:[0-9a-f]{2})*$/i;
const CategoryPattern = /^[0-9a-f]{64}$/i;
const DecimalPattern = /^-?\d+$/;

const invalid = (message: string): FundTokensError => new FundTokensError('INVALID_ARGUMENT', message);

export const isHex = (value: unknown): value is string => typeof value === 'string' && HexPattern.test(value);

/** A 32-byte token category / transaction id, in the usual display (big-endian) order. */
export const isCategory = (value: unknown): value is string => typeof value === 'string' && CategoryPattern.test(value);

/** Returns the category lowercased, or throws naming the offending field. */
export function assertCategory(value: unknown, name: string): string {
    if (!isCategory(value)) {
        throw invalid(`${name} must be a 32-byte hex string (64 hex characters), got ${describe(value)}`);
    }
    return value.toLowerCase();
}

/** Returns the hex lowercased, or throws naming the offending field. */
export function assertHex(value: unknown, name: string): string {
    if (!isHex(value)) {
        throw invalid(`${name} must be an even-length hex string, got ${describe(value)}`);
    }
    return value.toLowerCase();
}

/** Converts a bigint, safe integer or decimal string to bigint, or throws naming the offending field. */
export function toBigInt(value: unknown, name: string): bigint {
    if (typeof value === 'bigint') {
        return value;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
        return BigInt(value);
    }
    if (typeof value === 'string' && DecimalPattern.test(value.trim())) {
        return BigInt(value.trim());
    }
    throw invalid(`${name} must be an integer (bigint, safe integer or decimal string), got ${describe(value)}`);
}

/** Throws unless `min <= value <= max`. */
export function assertInRange(value: bigint, name: string, min: bigint, max: bigint): bigint {
    if (value < min || value > max) {
        throw invalid(`${name} must be between ${min} and ${max}, got ${value}`);
    }
    return value;
}

export function assertObject(value: unknown, name: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw invalid(`${name} must be an object, got ${describe(value)}`);
    }
    return value as Record<string, unknown>;
}

export function describe(value: unknown): string {
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'string') return value.length > 80 ? `'${value.slice(0, 77)}...'` : `'${value}'`;
    if (value === null || value === undefined || typeof value !== 'object') return String(value);
    return Array.isArray(value) ? 'an array' : 'an object';
}
