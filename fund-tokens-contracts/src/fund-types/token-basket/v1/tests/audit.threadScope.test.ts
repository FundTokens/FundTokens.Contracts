/**
 * Audit check: thread authority is fund-scoped. Anyone can hold an outflow-category NFT whose
 * commitment names a fund they defined themselves, but it cannot release a different fund's
 * assets: AssetManager keys on the thread commitment's fund hash, never on the category alone.
 */
import { swapEndianness } from '@bitauth/libauth';
import { TransactionBuilder, randomUtxo } from 'cashscript';

import { randomCategory } from '@test-utils/random.js';
import { generateWallet } from '@test-utils/wallet.js';

import { FundTokenTransactionBuilder, hashFund, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;

describe('audit: a foreign fund thread cannot reach another fund\'s backing', () => {
    let instance: TestInstance;
    let victim: Fund;

    beforeAll(async () => {
        instance = await bootstrapInstance();
        const { provider, system } = instance;
        victim = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 1000n, assets: [{ category: randomCategory(), amount: 2n }] }));

        // One honest inflow stocks the victim's reserves.
        const user = generateWallet();
        const funding = provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));
        const assetUtxos = victim.assets.map(a => provider.addUtxo(user.tokenAddress, randomUtxo({ token: { category: a.category, amount: a.amount } })));
        const inflow = new FundTokenTransactionBuilder({ provider, system, fund: victim });
        await inflow.addInflow({ units: 1n });
        await inflow
            .addInputs([funding, ...assetUtxos], user.signatureTemplate.unlockP2PKH())
            .addOutput({ to: user.tokenAddress, amount: DustAmount, token: { category: victim.category, amount: victim.amount } })
            .send();
    });

    it('rejects releasing victim assets alongside an outflow thread for an attacker-defined fund', async () => {
        const { provider, system } = instance;
        const attacker = generateWallet();
        const { assetContracts } = new FundTokenTransactionBuilder({ provider, system, fund: victim }).getContracts();
        const assetContract = assetContracts[0]!;

        const attackerFund = normalizeFund({ category: randomCategory(), amount: 1n, satoshis: 5000n, assets: [] });
        const commitment = '02' + swapEndianness(attackerFund.category) + hashFund(attackerFund);
        const thread = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 2000n, token: { category: system.outflow, amount: 0n, nft: { capability: 'none', commitment } } }));
        const funding = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));
        const reserve = (await assetContract.getUtxos()).find(u => u.token?.category === victim.assets[0]!.category)!;

        const tx = new TransactionBuilder({ provider })
            .addInput(thread, attacker.signatureTemplate.unlockP2PKH())
            .addInput(reserve, assetContract.unlock.release())
            .addInput(funding, attacker.signatureTemplate.unlockP2PKH())
            .addOutputs([
                { to: attacker.tokenAddress, amount: DustAmount, token: reserve.token! },
                { to: attacker.tokenAddress, amount: 900_000n },
            ]);

        await expect(tx).toBeRejected();
        expect(await assetContract.getUtxos()).toContainEqual(reserve);
    });
});
