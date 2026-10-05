/**
 * Audit finding (fresh pass): the thread NFT's commitment is never pinned when the manager
 * recreates it. TransactionManager.inflow() and outflow() check only the locking bytecode and
 * category, assuming no minting token of the thread category can share a transaction with a live
 * thread. Given one (e.g. from the fund-creation smuggling findings), the thread's commitment is
 * attacker-chosen while it stays at the manager with the thread category: it passes every
 * builder filter, but the manager can never accept it again.
 *
 * The contracts must reject this transaction.
 */
import { swapEndianness } from '@bitauth/libauth';

import { randomCategory, randomUtxo } from '@test-utils/random.js';
import { generateWallet } from '@test-utils/wallet.js';

import { FundTokenTransactionBuilder, hashFund, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;

describe('audit: thread commitment unpinned on recreation', () => {
    let instance: TestInstance;
    let fund: Fund;

    beforeAll(async () => {
        instance = await bootstrapInstance();
        fund = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 0n, assets: [{ category: randomCategory(), amount: 4n }] }));
    });

    it('rejects an inflow that rewrites the thread commitment while a thread-category minting NFT is present', async () => {
        const { provider, system } = instance;
        const attacker = generateWallet();
        const rogueMinter = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 5000n, token: { category: system.inflow, amount: 0n, nft: { capability: 'minting', commitment: '01' } } }));
        const funding = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 400_000n }));
        const asset = provider.addUtxo(attacker.tokenAddress, randomUtxo({ token: { category: fund.assets[0]!.category, amount: fund.assets[0]!.amount } }));

        const tx = new FundTokenTransactionBuilder({ provider, system, fund });
        const { managerContract } = tx.getContracts();
        const threadBefore = (await managerContract.getUtxos()).find(u => u.token?.category === system.inflow)!;
        await tx.addInflow({ units: 1n });

        // An ordinary one-unit deposit, except the recreated thread names a fund that does not exist.
        const decoy = normalizeFund({ category: randomCategory(), amount: 10n, satoshis: 0n, assets: [{ category: randomCategory(), amount: 1n }] });
        const poison = '02' + swapEndianness(decoy.category) + hashFund(decoy);
        tx.outputs[0] = { ...tx.outputs[0]!, token: { category: system.inflow, amount: 0n, nft: { capability: 'none', commitment: poison } } };

        await tx
            .addInputs([rogueMinter, funding, asset], attacker.signatureTemplate.unlockP2PKH())
            .addOutput({ to: attacker.tokenAddress, amount: 5000n, token: rogueMinter.token! })
            .addOutput({ to: attacker.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: fund.amount } })
            .addOutput({ to: attacker.tokenAddress, amount: 290_000n });

        await expect(tx).toBeRejected();
        const threads = (await managerContract.getUtxos()).filter(u => u.token?.category === system.inflow);
        expect(threads.map(u => u.token!.nft!.commitment)).toEqual([threadBefore.token!.nft!.commitment]);
    });
});
