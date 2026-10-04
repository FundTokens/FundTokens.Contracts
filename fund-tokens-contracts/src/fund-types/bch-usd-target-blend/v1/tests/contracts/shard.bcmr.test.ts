/**
 * The BCMR parse bytecode for shard NFTs (docs/agents/bch-usd-target-blend/v1/DESIGN.md#bcmr), run the way
 * BCMR v2 clients run it: in the standardized NFT parsing transaction, with the shard UTXO as input 0
 * and the parse bytecode as input 1's locking bytecode. The bottom altstack item is the NFT type (the
 * op byte); the items above it are the fields, in order.
 */
import {
    bigIntToBinUint64LE,
    binToHex,
    cashAssemblyToBin,
    createVirtualMachineBch2026,
    hexToBin,
    numberToBinInt32LE,
    vmNumberToBigInt,
} from '@bitauth/libauth';
import { randomCategory } from '@test-utils/random.js';

/** Shard NFT parse bytecode: op (type), index, count, units, epoch, BCH reserve, unreleased fund tokens. */
const ShardParseAsm = `
    OP_0 OP_UTXOTOKENCOMMITMENT OP_SIZE <15> OP_EQUALVERIFY
    OP_1 OP_SPLIT OP_SWAP OP_TOALTSTACK
    OP_1 OP_SPLIT OP_SWAP OP_BIN2NUM OP_TOALTSTACK
    OP_1 OP_SPLIT OP_SWAP OP_BIN2NUM OP_TOALTSTACK
    OP_8 OP_SPLIT OP_SWAP OP_BIN2NUM OP_TOALTSTACK
    OP_BIN2NUM OP_TOALTSTACK
    OP_0 OP_UTXOVALUE OP_TOALTSTACK
    OP_0 OP_UTXOTOKENAMOUNT OP_TOALTSTACK
`;

const vm = createVirtualMachineBch2026();
const parseBytecode = cashAssemblyToBin(ShardParseAsm) as Uint8Array;

/** Runs the parse bytecode against an NFT UTXO as BCMR v2 specifies; returns the altstack, bottom first. */
function parse(utxo: { valueSatoshis: bigint; amount: bigint; commitment: string }) {
    const state = vm.evaluate({
        inputIndex: 1,
        sourceOutputs: [
            {
                lockingBytecode: hexToBin('aa20' + '11'.repeat(32) + '87'),
                valueSatoshis: utxo.valueSatoshis,
                token: { category: hexToBin(randomCategory()), amount: utxo.amount, nft: { capability: 'mutable', commitment: hexToBin(utxo.commitment) } },
            },
            { lockingBytecode: parseBytecode, valueSatoshis: 0n },
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
    return state;
}

const commitment = (op: number, index: number, count: number, units: bigint, epoch: number) =>
    `0${op}${index.toString(16).padStart(2, '0')}${count.toString(16).padStart(2, '0')}${binToHex(bigIntToBinUint64LE(units))}${binToHex(numberToBinInt32LE(epoch))}`;

describe('Shard NFT BCMR parsing', () => {
    it('reads the op as the type and every field in order', () => {
        const state = parse({ valueSatoshis: 123_456_789n, amount: 900_000_000_000_000n, commitment: commitment(2, 3, 4, 1_234n, 1_791_131_277) });
        expect(state.error).toBeUndefined();
        expect(state.stack).toEqual([Uint8Array.of(1)]); // the unlocking OP_1, alone: the parse succeeds
        const [type, ...fields] = state.alternateStack;
        expect(binToHex(type!)).toBe('02');
        expect(fields.map(field => vmNumberToBigInt(field) as bigint)).toEqual([3n, 4n, 1_234n, 1_791_131_277n, 123_456_789n, 900_000_000_000_000n]);
    });

    it.each([1, 2, 3, 4, 5, 6])('types op 0x0%i by its byte', op => {
        const state = parse({ valueSatoshis: 1_000n, amount: 1n, commitment: commitment(op, 0, 1, 0n, 0) });
        expect(state.error).toBeUndefined();
        expect(binToHex(state.alternateStack[0]!)).toBe(`0${op}`);
    });

    it('fails on a commitment that is not a shard state', () => {
        const state = parse({ valueSatoshis: 1_000n, amount: 1n, commitment: commitment(2, 0, 1, 5n, 0).slice(0, -2) });
        expect(state.error).toBeDefined();
    });
});
