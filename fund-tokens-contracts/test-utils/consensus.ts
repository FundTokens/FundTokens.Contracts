/**
 * Consensus verification of a transaction as the network receives it: its serialized bytes.
 *
 * cashscript's `send()` evaluates the in-memory transaction, which can differ from what it
 * serializes (e.g. a token with amount 0 and no NFT is dropped when encoded), skips evaluation
 * entirely for custom unlockers, and evaluates each input against its unlocker's locking bytecode
 * rather than where the UTXO actually sits.
 */
import { createVirtualMachineBch2026, decodeTransaction, hexToBin, type Output } from '@bitauth/libauth';
import type { TransactionBuilder } from 'cashscript';

const vm = createVirtualMachineBch2026();

/**
 * `true`, or the reason BCH 2026 consensus (encoding, scripts and token rules) rejects `tx`.
 *
 * Each input is spent from its unlocker's locking bytecode unless `sourceLockingBytecodes` (hex,
 * one per input) says otherwise.
 */
export function verifyTransaction(tx: TransactionBuilder, sourceLockingBytecodes?: readonly string[]): true | string {
    const transaction = decodeTransaction(hexToBin(tx.build()));
    if (typeof transaction === 'string') {
        return `Invalid transaction encoding: ${transaction}`;
    }
    const sourceOutputs = tx.inputs.map((utxo, i): Output => ({
        lockingBytecode: sourceLockingBytecodes ? hexToBin(sourceLockingBytecodes[i]!) : utxo.unlocker.generateLockingBytecode(),
        valueSatoshis: utxo.satoshis,
        ...(utxo.token && {
            token: {
                category: hexToBin(utxo.token.category),
                amount: utxo.token.amount,
                ...(utxo.token.nft && { nft: { capability: utxo.token.nft.capability, commitment: hexToBin(utxo.token.nft.commitment) } }),
            },
        }),
    }));
    const result = vm.verify({ sourceOutputs, transaction });
    return result === true ? true : String(result);
}
