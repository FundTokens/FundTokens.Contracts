/**
 * The BCMR parse bytecode for shard NFTs (docs/agents/bch-usd-target-blend/v1/DESIGN.md#bcmr), run the way
 * BCMR v2 clients run it. The bottom altstack item is the NFT type (the op byte); the items above it are
 * the fields, in order.
 */
import { bigIntToBinUint64LE, binToHex, numberToBinInt32LE } from '@bitauth/libauth';
import { num, parseBytecode, parseNft } from '@test-utils/bcmr.js';

/** Shard NFT parse bytecode: op (type), index, count, units, epoch, BCH reserve, unreleased fund tokens. */
const ShardParse = parseBytecode(`
    OP_0 OP_UTXOTOKENCOMMITMENT OP_SIZE <15> OP_EQUALVERIFY
    OP_1 OP_SPLIT OP_SWAP OP_TOALTSTACK
    OP_1 OP_SPLIT OP_SWAP OP_BIN2NUM OP_TOALTSTACK
    OP_1 OP_SPLIT OP_SWAP OP_BIN2NUM OP_TOALTSTACK
    OP_8 OP_SPLIT OP_SWAP OP_BIN2NUM OP_TOALTSTACK
    OP_BIN2NUM OP_TOALTSTACK
    OP_0 OP_UTXOVALUE OP_TOALTSTACK
    OP_0 OP_UTXOTOKENAMOUNT OP_TOALTSTACK
`);

const commitment = (op: number, index: number, count: number, units: bigint, epoch: number) =>
    `0${op}${index.toString(16).padStart(2, '0')}${count.toString(16).padStart(2, '0')}${binToHex(bigIntToBinUint64LE(units))}${binToHex(numberToBinInt32LE(epoch))}`;

describe('Shard NFT BCMR parsing', () => {
    it('is the bytecode the design publishes', () => {
        expect(binToHex(ShardParse)).toBe('00cf825f88517f7c6b517f7c816b517f7c816b587f7c816b816b00c66b00d06b');
    });

    it('reads the op as the type and every field in order', () => {
        const parsed = parseNft(ShardParse, {
            capability: 'mutable',
            valueSatoshis: 123_456_789n,
            amount: 900_000_000_000_000n,
            commitment: commitment(2, 3, 4, 1_234n, 1_791_131_277),
        });
        expect(parsed.error).toBeUndefined();
        expect(parsed.type).toBe('02');
        expect(parsed.fields.map(num)).toEqual([3n, 4n, 1_234n, 1_791_131_277n, 123_456_789n, 900_000_000_000_000n]);
    });

    it.each([1, 2, 3, 4, 5, 6])('types op 0x0%i by its byte', op => {
        const parsed = parseNft(ShardParse, { capability: 'mutable', amount: 1n, commitment: commitment(op, 0, 1, 0n, 0) });
        expect(parsed.error).toBeUndefined();
        expect(parsed.type).toBe(`0${op}`);
    });

    it('fails on a commitment that is not a shard state', () => {
        const parsed = parseNft(ShardParse, { capability: 'mutable', amount: 1n, commitment: commitment(2, 0, 1, 5n, 0).slice(0, -2) });
        expect(parsed.error).toBeDefined();
    });
});
