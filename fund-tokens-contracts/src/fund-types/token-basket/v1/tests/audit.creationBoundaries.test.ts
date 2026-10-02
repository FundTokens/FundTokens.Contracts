/**
 * Audit checks on fund-creation boundaries:
 *
 *  D-6 (retracted): startup's satoshi ceiling is exactly the maximum supply, 2,100,000,000,000,000.
 *      The literal 2100000000000001 compiles to OP_WITHIN, whose upper bound is exclusive.
 *  D-7: a fund with neither satoshi backing nor assets is rejected at creation.
 */
import { randomUtxo } from 'cashscript';

import { generateWallet } from '@test-utils/wallet.js';

import { MaxSatoshis } from '../../../../core/constants.js';
import { PublicFundTransactionBuilder } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;

/** A broadcast built without the builder's validation, so the contracts alone decide. */
async function buildBroadcast({ provider, system }: TestInstance, fund: { amount: bigint; satoshis: bigint }) {
    const creator = generateWallet();
    const genesis = randomUtxo({ vout: 0, satoshis: DustAmount });
    const funding = randomUtxo({ satoshis: 100_000n });
    [genesis, funding].forEach(u => provider.addUtxo(creator.tokenAddress, u));

    const tx = new PublicFundTransactionBuilder({ provider, system });
    tx.addInput(genesis, creator.signatureTemplate.unlockP2PKH());
    await tx.addBroadcast({ fund: { ...fund, category: genesis.txid, assets: [] }, validate: false });
    return tx
        .addInput(funding, creator.signatureTemplate.unlockP2PKH())
        .addOutput({ to: creator.tokenAddress, amount: DustAmount });
}

describe('audit: fund-creation boundaries', () => {
    let instance: TestInstance;

    beforeAll(async () => {
        instance = await bootstrapInstance();
    });

    it('accepts a fund backed by exactly the maximum satoshi supply (D-6)', async () => {
        await expect(createFund(instance, { amount: 10n, satoshis: MaxSatoshis, assets: [] })).toBeAccepted();
    });

    it('rejects a fund backed by one satoshi more than the maximum supply (D-6)', async () => {
        const tx = await buildBroadcast(instance, { amount: 10n, satoshis: MaxSatoshis + 1n });
        await expect(tx).toBeRejected();
    });

    it('rejects a fund with no satoshi backing and no assets (D-7)', async () => {
        const tx = await buildBroadcast(instance, { amount: 10n, satoshis: 0n });
        await expect(tx).toBeRejected();
    });
});
