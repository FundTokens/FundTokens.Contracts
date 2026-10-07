/**
 * Consensus verification of a transaction as the network receives it: its serialized bytes.
 *
 * cashscript's `debug()` evaluates the in-memory transaction, which can differ from what it
 * serializes (e.g. a token with amount 0 and no NFT is dropped when encoded), and `send()` skips
 * it entirely for custom unlockers.
 */
import { createVirtualMachineBch2026, decodeTransaction, hexToBin, type Output } from '@bitauth/libauth';
import type { TransactionBuilder } from 'cashscript';

const vm = createVirtualMachineBch2026();

/**
 * `true`, or the reason BCH 2026 consensus (encoding, scripts and token rules) rejects `tx`.
 *
 * Each input is spent from its UTXO's locking bytecode unless `sourceLockingBytecodes` (hex, one
 * per input) says otherwise.
 */
export function verifyTransaction(tx: TransactionBuilder, sourceLockingBytecodes?: readonly string[]): true | string {
    const transaction = decodeTransaction(hexToBin(tx.build()));
    if (typeof transaction === 'string') {
        return `Invalid transaction encoding: ${transaction}`;
    }
    const result = vm.verify({ sourceOutputs: sourceOutputsOf(tx, sourceLockingBytecodes), transaction });
    return result === true ? true : String(result);
}

/**
 * An input's operation cost and its budget ((41 + unlocking bytecode length) × 800), evaluated
 * with libauth. Much faster than cashscript's `getVmResourceUsage()` on large transactions.
 */
export function operationCost(tx: TransactionBuilder, inputIndex: number): { cost: number; budget: number } {
    const transaction = decodeTransaction(hexToBin(tx.build()));
    if (typeof transaction === 'string') {
        throw new Error(`Invalid transaction encoding: ${transaction}`);
    }
    const state = vm.evaluate({ inputIndex, sourceOutputs: sourceOutputsOf(tx), transaction });
    return { cost: state.metrics.operationCost, budget: (41 + transaction.inputs[inputIndex]!.unlockingBytecode.length) * 800 };
}

function sourceOutputsOf(tx: TransactionBuilder, sourceLockingBytecodes?: readonly string[]): Output[] {
    return tx.inputs.map((utxo, i): Output => ({
        lockingBytecode: sourceLockingBytecodes ? hexToBin(sourceLockingBytecodes[i]!) : hexToBin(utxo.lockingBytecode),
        valueSatoshis: utxo.satoshis,
        ...(utxo.token && {
            token: {
                category: hexToBin(utxo.token.category),
                amount: utxo.token.amount,
                ...(utxo.token.nft && { nft: { capability: utxo.token.nft.capability, commitment: hexToBin(utxo.token.nft.commitment) } }),
            },
        }),
    }));
}
