/**
 * BCMR v2 NFT parsing, as clients run it (https://github.com/bitjson/chip-bcmr, `ParsableNftCollection`).
 *
 * The parse bytecode is input 1's locking bytecode in the standardized NFT parsing transaction: version 2,
 * input 0 spends the UTXO holding the NFT (empty unlocking bytecode, sequence 0), input 1 spends the empty
 * hash outpoint with unlocking bytecode OP_1 (sequence 0), one OP_RETURN output of value 0, locktime 0.
 * On success the bottom altstack item is the NFT's type (the key into `parse.types`) and the items above it
 * are the type's fields, in order.
 */
import { binToHex, cashAssemblyToBin, createVirtualMachineBch2026, hexToBin, vmNumberToBigInt } from '@bitauth/libauth';
import { randomCategory } from './random.js';

const vm = createVirtualMachineBch2026();

export interface NftUtxo {
    /** Commitment hex. */
    commitment: string;
    capability?: 'none' | 'mutable' | 'minting';
    category?: string;
    valueSatoshis?: bigint;
    amount?: bigint;
}

export interface ParsedNft {
    /** Why the parse failed, if it did: clients then treat the NFT as unparsable. */
    error?: string;
    /** The NFT type (bottom altstack item), as hex. */
    type?: string;
    /** Field values above the type, bottom first. */
    fields: Uint8Array[];
}

/** Compiles CashAssembly parse code to bytecode, throwing on errors. */
export function parseBytecode(asm: string): Uint8Array {
    const bytecode = cashAssemblyToBin(asm);
    if (typeof bytecode === 'string') {
        throw new Error(bytecode);
    }
    return bytecode;
}

/** Runs `bytecode` against an NFT UTXO as a BCMR v2 client would. */
export function parseNft(bytecode: Uint8Array, nft: NftUtxo): ParsedNft {
    const state = vm.evaluate({
        inputIndex: 1,
        sourceOutputs: [
            {
                lockingBytecode: hexToBin(`aa20${'11'.repeat(32)}87`),
                valueSatoshis: nft.valueSatoshis ?? 1_000n,
                token: {
                    category: hexToBin(nft.category ?? randomCategory()),
                    amount: nft.amount ?? 0n,
                    nft: { capability: nft.capability ?? 'none', commitment: hexToBin(nft.commitment) },
                },
            },
            { lockingBytecode: bytecode, valueSatoshis: 0n },
        ],
        transaction: {
            version: 2,
            inputs: [
                { outpointTransactionHash: hexToBin(randomCategory()), outpointIndex: 0, sequenceNumber: 0, unlockingBytecode: Uint8Array.of() },
                { outpointTransactionHash: new Uint8Array(32), outpointIndex: 0, sequenceNumber: 0, unlockingBytecode: Uint8Array.of(0x51) },
            ],
            outputs: [{ lockingBytecode: Uint8Array.of(0x6a), valueSatoshis: 0n }],
            locktime: 0,
        },
    });
    // A successful parse leaves exactly the unlocking OP_1 on the stack, like any passing input
    const clean = state.stack.length === 1 && binToHex(state.stack[0]!) === '01';
    const error = state.error ?? (clean ? undefined : `the parse left ${state.stack.length} stack items`);
    if (error !== undefined) {
        return { error, fields: [] };
    }
    const [type, ...fields] = state.alternateStack;
    return { type: type && binToHex(type), fields };
}

/** A number field's value. */
export const num = (field: Uint8Array | undefined): bigint => vmNumberToBigInt(field ?? Uint8Array.of(), { requireMinimalEncoding: false }) as bigint;

/** A hex or binary field's value. */
export const hex = (field: Uint8Array | undefined): string => binToHex(field ?? Uint8Array.of());
