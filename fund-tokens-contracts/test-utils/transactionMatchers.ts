/**
 * `await expect(tx).toBeAccepted()` / `await expect(tx).toBeRejected(reason?)`.
 *
 * `tx` is a TransactionBuilder or a promise of a send. Unlike `expect(tx.send()).resolves /
 * .rejects`, a failure reports one short line: the txid of a transaction that should have been
 * rejected, or the contract, line and reason of one that should have been accepted. Not the whole
 * transaction or a Bitauth IDE URI.
 *
 * A TransactionBuilder is judged as the network would judge it: by its serialized bytes, not
 * cashscript's in-memory form (which can differ, e.g. a token with amount 0 and no NFT is dropped
 * when encoded). If accepted, those bytes are what is broadcast to the mock network.
 */
import type { TransactionBuilder } from 'cashscript';
import { expect } from 'vitest';
import { verifyTransaction } from './consensus.js';

type Sendable = TransactionBuilder | Promise<unknown>;

const MaxLineLength = 300;

/** The reason part of an error: cashscript appends a key warning and a Bitauth IDE URI after a blank line. */
export function summarizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return (message.split('\n\n')[0] ?? message)
        .split('\n')
        .map(line => (line.length > MaxLineLength ? `${line.slice(0, MaxLineLength)}…` : line))
        .join('\n    ');
}

type Outcome = { accepted: true; txid: string | undefined } | { accepted: false; reason: string };

/** Verifies the serialized transaction, then broadcasts exactly those bytes. */
async function settleTransaction(tx: TransactionBuilder): Promise<Outcome> {
    let hex: string;
    try {
        hex = tx.build();
    } catch (error) {
        return { accepted: false, reason: summarizeError(error) };
    }

    const verdict = verifyTransaction(tx);
    if (verdict !== true) {
        // cashscript names the failing contract, line and statement, when its in-memory check agrees.
        try {
            tx.debug();
        } catch (error) {
            if (!(error instanceof Error && error.message.startsWith('Cannot debug'))) {
                return { accepted: false, reason: summarizeError(error) };
            }
        }
        return { accepted: false, reason: `the serialized transaction is invalid (cashscript's in-memory check passes): ${verdict}` };
    }

    try {
        return { accepted: true, txid: await tx.provider.sendRawTransaction(hex) };
    } catch (error) {
        return { accepted: false, reason: summarizeError(error) };
    }
}

async function settle(actual: Sendable): Promise<Outcome> {
    if ('send' in actual) {
        return settleTransaction(actual);
    }
    try {
        const value = await actual;
        const txid = typeof value === 'object' && value !== null && 'txid' in value ? String(value.txid) : undefined;
        return { accepted: true, txid };
    } catch (error) {
        return { accepted: false, reason: summarizeError(error) };
    }
}

const accepted = (txid: string | undefined) => `it was accepted${txid ? ` (txid ${txid})` : ''}`;

expect.extend({
    async toBeAccepted(actual: Sendable) {
        const outcome = await settle(actual);
        return {
            pass: outcome.accepted,
            message: () => (outcome.accepted
                ? `expected the transaction to be rejected, but ${accepted(outcome.txid)}`
                : `expected the transaction to be accepted, but it was rejected:\n    ${outcome.reason}`),
        };
    },

    async toBeRejected(actual: Sendable, reason?: RegExp | string) {
        const outcome = await settle(actual);
        if (outcome.accepted) {
            return { pass: false, message: () => `expected the transaction to be rejected, but ${accepted(outcome.txid)}` };
        }
        const matches = reason === undefined
            || (typeof reason === 'string' ? outcome.reason.includes(reason) : reason.test(outcome.reason));
        return {
            pass: matches,
            message: () => (matches
                ? `expected the transaction not to be rejected, but it was:\n    ${outcome.reason}`
                : `expected the transaction to be rejected with ${String(reason)}, but it was rejected with:\n    ${outcome.reason}`),
        };
    },
});

declare module 'vitest' {
    interface Assertion<T = any> {
        /** Sends the transaction (or awaits the send) and expects it to succeed. */
        toBeAccepted(): Promise<void>;
        /** Sends the transaction (or awaits the send) and expects it to fail, optionally for `reason`. */
        toBeRejected(reason?: RegExp | string): Promise<void>;
    }
}
