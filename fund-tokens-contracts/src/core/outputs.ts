import {
    binToHex,
    cashAddressToLockingBytecode,
    encodeTransactionOutput,
    getDustThreshold,
    hash256,
    hexToBin,
    type Output as LibauthOutput,
} from '@bitauth/libauth';
import type { Output, TokenDetails } from 'cashscript';
import { FundTokensError } from './errors.js';

/** An output whose satoshi value is filled in as the dust minimum. */
export interface DustOutputTemplate {
    to: string;
    token?: TokenDetails | undefined;
}

export function lockingBytecodeOf(address: string): Uint8Array {
    const result = cashAddressToLockingBytecode(address);
    if (typeof result === 'string') {
        throw new FundTokensError('INVALID_ARGUMENT', `'${address}' is not a valid CashAddress: ${result}`);
    }
    return result.bytecode;
}

export const lockingBytecodeHexOf = (address: string): string => binToHex(lockingBytecodeOf(address));

/** hash256 of hex bytecode, as hex; how contracts commit to one another. */
export const hashBytecode = (bytecodeHex: string): string => binToHex(hash256(hexToBin(bytecodeHex)));

function toLibauthOutput(to: string | Uint8Array, valueSatoshis: bigint, token: TokenDetails | undefined): LibauthOutput {
    const output: LibauthOutput = {
        lockingBytecode: typeof to === 'string' ? lockingBytecodeOf(to) : to,
        valueSatoshis,
    };
    if (token) {
        output.token = {
            amount: token.amount,
            category: hexToBin(token.category),
            ...(token.nft && {
                nft: {
                    capability: token.nft.capability,
                    commitment: hexToBin(token.nft.commitment),
                },
            }),
        };
    }
    return output;
}

/** The smallest satoshi value the network accepts for this output. */
export const dustThreshold = ({ to, token }: DustOutputTemplate): bigint => getDustThreshold(toLibauthOutput(to, 0n, token));

/** The output's size in a serialized transaction, in bytes. */
export const outputSize = ({ to, amount, token }: Output): number => encodeTransactionOutput(toLibauthOutput(to, amount, token)).length;

/** Builds an output carrying exactly the dust minimum. */
export function withDust(template: DustOutputTemplate): Output {
    const output: Output = { to: template.to, amount: dustThreshold(template) };
    if (template.token) {
        output.token = template.token;
    }
    return output;
}
