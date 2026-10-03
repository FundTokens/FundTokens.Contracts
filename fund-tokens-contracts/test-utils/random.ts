import { randomBytes } from 'node:crypto';
import { randomUtxo as cashscriptRandomUtxo, type Utxo } from 'cashscript';

/**
 * A random 32-byte token category.
 *
 * Use this rather than `randomToken().category`: cashscript derives those from an
 * integer below 10,000, so a fund with a few dozen random assets collides often.
 */
export const randomCategory = (): string => randomBytes(32).toString('hex');

/**
 * cashscript's `randomUtxo()` with a random 32-byte txid (unless `defaults` sets one).
 *
 * cashscript picks the txid from an integer below 10,000 and the vout below 10, so tests
 * creating hundreds of UTXOs (large funds) reuse outpoints, and the mock network then spends
 * whichever UTXO it finds first at that outpoint.
 */
export const randomUtxo = <T extends Partial<Utxo>>(defaults?: T): Utxo & T =>
    cashscriptRandomUtxo({ txid: randomCategory(), ...defaults } as T);
