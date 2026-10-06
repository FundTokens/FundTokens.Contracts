/**
 * Audit finding AUD-008: TransactionManager.outflow() accounts a token reserve's fungible units
 * only, not the BCH each custody UTXO carries with them.
 *
 * Policy: that BCH is carrier value (the dust a deposit puts on each custody UTXO), not backing.
 * A redemption that releases all of a custody UTXO's tokens may claim its BCH. What the contracts
 * do enforce is that custody is released only by redeeming fund tokens: taking the same custody
 * UTXO without redeeming any is refused.
 */
import { randomCategory, randomUtxo } from '@test-utils/random.js';
import { generateWallet, type TestWallet } from '@test-utils/wallet.js';

import { withDust } from '../../../../core/outputs.js';
import { FundTokenTransactionBuilder, getFundBin, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;

describe('audit: carrier BCH on token custody (AUD-008)', () => {
    let instance: TestInstance;
    let fund: Fund;
    let holder: TestWallet;

    beforeEach(async () => {
        instance = await bootstrapInstance();
        fund = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 0n, assets: [{ category: randomCategory(), amount: 4n }] }));
        holder = generateWallet();

        // An honest one-unit deposit: one custody UTXO holding the unit's 4 tokens and its carrier BCH
        const { provider, system } = instance;
        const deposit = new FundTokenTransactionBuilder({ provider, system, fund });
        await deposit.addInflow({ units: 1n });
        await deposit
            .addInputs([
                provider.addUtxo(holder.tokenAddress, randomUtxo({ satoshis: 400_000n })),
                provider.addUtxo(holder.tokenAddress, randomUtxo({ token: { category: fund.assets[0]!.category, amount: fund.assets[0]!.amount } })),
            ], holder.signatureTemplate.unlockP2PKH())
            .addOutput({ to: holder.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: fund.amount } })
            .addOutput({ to: holder.tokenAddress, amount: 200_000n })
            .send();
    });

    /** Releases the custody UTXO whole to the holder, redeeming the unit's fund tokens or (`redeemed: false`) none. */
    async function release(redeemed: boolean) {
        const { provider, system } = instance;
        const tx = new FundTokenTransactionBuilder({ provider, system, fund });
        const { managerContract, fundContract, assetContracts, feeContract, feeVaultContract } = tx.getContracts();
        const thread = (await managerContract.getUtxos()).find(u => u.token?.category === system.outflow)!;
        const feeUtxo = (await feeContract.getUtxos()).find(u => !u.token)!;
        const supply = (await fundContract.getUtxos()).find(u => u.token?.category === fund.category)!;
        const [custody] = await assetContracts[0]!.getUtxos();
        const fundTokens = (await provider.getUtxos(holder.tokenAddress)).find(u => u.token?.category === fund.category)!;
        const funding = provider.addUtxo(holder.tokenAddress, randomUtxo({ satoshis: 400_000n }));

        tx
            .addInput(thread, managerContract.unlock.outflow(getFundBin(fund), new Uint8Array()))
            .addInput(feeUtxo, feeContract.unlock.pay())
            .addInput(supply, fundContract.unlock.redeem())
            .addInput(custody!, assetContracts[0]!.unlock.release())
            .addInputs(redeemed ? [funding, fundTokens] : [funding], holder.signatureTemplate.unlockP2PKH())
            .addOutputs([
                withDust({ to: managerContract.tokenAddress, token: thread.token }),
                withDust({ to: feeContract.tokenAddress }),
                { to: feeVaultContract.tokenAddress, amount: system.fees.execute.value },
                withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: supply.token!.amount + (redeemed ? fund.amount : 0n) } }),
                // the released tokens, and the custody UTXO's BCH on top of the holder's change
                withDust({ to: holder.tokenAddress, token: { category: fund.assets[0]!.category, amount: custody!.token!.amount } }),
                { to: holder.tokenAddress, amount: 200_000n + custody!.satoshis },
            ]);
        return { tx, custody: custody!, assetContract: assetContracts[0]! };
    }

    it('lets a redemption releasing all of a custody UTXO\'s tokens claim its BCH', async () => {
        const { tx, custody, assetContract } = await release(true);
        expect(custody.token!.amount).toBe(fund.assets[0]!.amount);
        expect(custody.satoshis).toBeGreaterThan(0n);
        await expect(tx).toBeAccepted();
        expect(await assetContract.getUtxos()).toHaveLength(0);
    });

    it('rejects releasing the custody UTXO and its BCH without redeeming fund tokens', async () => {
        const { tx } = await release(false);
        await expect(tx).toBeRejected(/fundLockingAmount > 0/);
    });
});
