/**
 * Consensus verification for the transactions cashscript cannot check itself.
 *
 * `send()` verifies locally only when every input has a standard unlocker, and even then it
 * evaluates each input against its unlocker's locking bytecode rather than the locking bytecode
 * the UTXO actually sits at. Use this for custom unlockers, or UTXOs spent from somewhere else.
 */
import { createVirtualMachineBch2026, decodeTransactionUnsafe, hexToBin, type Output } from '@bitauth/libauth';
import type { TransactionBuilder } from 'cashscript';

const vm = createVirtualMachineBch2026();

/** `true`, or the reason BCH 2026 consensus (scripts and token rules) rejects the transaction. */
export function verifyTransaction(tx: TransactionBuilder, sourceLockingBytecodes: readonly string[]): true | string {
    const sourceOutputs = tx.inputs.map((utxo, i): Output => ({
        lockingBytecode: hexToBin(sourceLockingBytecodes[i]!),
        valueSatoshis: utxo.satoshis,
        ...(utxo.token && {
            token: {
                category: hexToBin(utxo.token.category),
                amount: utxo.token.amount,
                ...(utxo.token.nft && { nft: { capability: utxo.token.nft.capability, commitment: hexToBin(utxo.token.nft.commitment) } }),
            },
        }),
    }));
    const result = vm.verify({ sourceOutputs, transaction: decodeTransactionUnsafe(hexToBin(tx.build())) });
    return result === true ? true : String(result);
}
