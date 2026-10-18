import { bigIntToBinUint64LEClamped, binToHex, swapEndianness } from '@bitauth/libauth';
import { FundTokensError } from '../../../core/errors.js';
import { assertCategory, assertInRange, assertObject, toBigInt } from '../../../core/validation.js';
import { MaxTokenAmount } from '../../../core/constants.js';
import type { FeeParameters, SystemParameters, SystemParametersInput } from './types.js';

function parseFee(value: unknown, name: string): FeeParameters {
    const fee = assertObject(value, name);
    return Object.freeze({
        nft: assertCategory(fee.nft, `${name}.nft`),
        // The fee contract takes an int; negative values would never be payable.
        value: assertInRange(toBigInt(fee.value, `${name}.value`), `${name}.value`, 0n, MaxTokenAmount),
    });
}

/**
 * Validates and normalises fixed basket v1 system parameters.
 *
 * Accepts the registry's JSON (fee values as numbers) or already-parsed
 * parameters, and returns a frozen copy with lowercase categories and bigint fees.
 */
export function parseSystemParameters(input: SystemParametersInput | SystemParameters | unknown): SystemParameters {
    const system = assertObject(input, 'system');
    const fees = assertObject(system.fees, 'system.fees');

    const parsed: SystemParameters = {
        inflow: assertCategory(system.inflow, 'system.inflow'),
        outflow: assertCategory(system.outflow, 'system.outflow'),
        publicFund: assertCategory(system.publicFund, 'system.publicFund'),
        authorization: assertCategory(system.authorization, 'system.authorization'),
        fees: Object.freeze({
            create: parseFee(fees.create, 'system.fees.create'),
            execute: parseFee(fees.execute, 'system.fees.execute'),
        }),
    };

    const tokens = [parsed.inflow, parsed.outflow, parsed.publicFund, parsed.authorization, parsed.fees.create.nft, parsed.fees.execute.nft];
    if (new Set(tokens).size !== tokens.length) {
        throw new FundTokensError('INVALID_ARGUMENT', 'system token categories must all be distinct');
    }

    return Object.freeze(parsed);
}

/**
 * The instance data: `system` serialized as the contracts take it, the 208 bytes the instance
 * NFTs hash (docs/agents/fixed-basket/v1/ENCODINGS.md#instance-data). Categories are in
 * internal byte order, fee values 8-byte little-endian.
 */
export function getInstanceDataHex(system: SystemParameters): string {
    const value = (amount: bigint) => binToHex(bigIntToBinUint64LEClamped(amount));
    return swapEndianness(system.inflow)
        + swapEndianness(system.outflow)
        + swapEndianness(system.publicFund)
        + swapEndianness(system.authorization)
        + swapEndianness(system.fees.create.nft) + value(system.fees.create.value)
        + swapEndianness(system.fees.execute.nft) + value(system.fees.execute.value);
}
