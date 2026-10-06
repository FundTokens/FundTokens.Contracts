/**
 * Stress: redemptions releasing many custody UTXOs at once.
 *
 * Each custody input costs the TransactionManager about 4,400 of operation cost (a token
 * reserve; about 3,300 for BCH) and the transaction about 330 to 370 bytes, while the
 * TransactionManager's budget grows only with the fund (32,000 per asset).
 *
 * - Releasing 4 to 6 custody UTXOs of every reserve, at about the largest fund whose redemption
 *   still fits a standard (100,000-byte) transaction: the size runs out first, and every one fits
 *   the budget without padding, with more than 500,000 of headroom left.
 * - A fund with a single token reserve has the least budget for the most custody inputs. Past
 *   about 264 custody UTXOs in one redemption it runs out of budget while the transaction is
 *   still standard (about 290 fit), so the redemption needs padding.
 */
import { generateWallet, type TestWallet } from '@test-utils/wallet.js';
import { operationCost, verifyTransaction } from '@test-utils/consensus.js';
import { randomCategory, randomUtxo } from '@test-utils/random.js';

import { MaxStandardTransactionSize } from '../../../../core/constants.js';
import { withDust } from '../../../../core/outputs.js';
import { FundTokenTransactionBuilder, getFundBin, getPadding, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;
const Timeout = 900_000;

/** Deposits `units`, leaving one more custody UTXO per reserve. */
async function deposit({ provider, system }: TestInstance, fund: Fund, holder: TestWallet, units = 1n) {
    const tx = new FundTokenTransactionBuilder({ provider, system, fund });
    await tx.addInflow({ units });
    await tx
        .addInputs([
            provider.addUtxo(holder.tokenAddress, randomUtxo({ satoshis: 1_000_000n })),
            ...fund.assets.map(a => provider.addUtxo(holder.tokenAddress, randomUtxo({ token: { category: a.category, amount: a.amount * units } }))),
        ], holder.signatureTemplate.unlockP2PKH())
        .addOutput({ to: holder.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: fund.amount * units } })
        .addOutput({ to: holder.tokenAddress, amount: 800_000n })
        .send();
}

/** [custody UTXOs released per reserve, assets besides BCH] */
const cases = [[4, 60], [5, 45], [6, 40]] as const;

describe.each(cases)('stress: one redemption releasing %i custody UTXOs per reserve of a %i-asset fund', (perReserve, assetCount) => {
    it('fits a standard transaction and the TransactionManager\'s budget without padding', async () => {
        const instance = await bootstrapInstance();
        const { provider, system } = instance;
        const holder = generateWallet();
        const fund = normalizeFund(await createFund(instance, {
            amount: 10n,
            satoshis: 1000n,
            assets: Array.from({ length: assetCount }, (_, i) => ({ category: randomCategory(), amount: BigInt(i + 1) })),
        }));
        for (let i = 0; i < perReserve; i++) {
            await deposit(instance, fund, holder);
        }

        // Custody UTXOs are all one unit, so redeeming `perReserve` units releases every one of them
        const units = BigInt(perReserve);
        const tx = new FundTokenTransactionBuilder({ provider, system, fund });
        await tx.addOutflow({ units }); // refuses a redemption too large for a standard transaction
        const { satoshiAssetContract, assetContracts } = tx.getContracts();
        const custody = new Set([satoshiAssetContract!, ...assetContracts].map(c => c.lockingBytecode));
        expect(tx.inputs.filter(u => custody.has(u.lockingBytecode))).toHaveLength((assetCount + 1) * perReserve);

        const fundTokens = (await provider.getUtxos(holder.tokenAddress)).filter(u => u.token?.category === fund.category);
        tx
            .addInputs([provider.addUtxo(holder.tokenAddress, randomUtxo({ satoshis: 1_000_000n })), ...fundTokens], holder.signatureTemplate.unlockP2PKH())
            .addOutputs(fund.assets.map(a => ({ to: holder.tokenAddress, amount: DustAmount, token: { category: a.category, amount: a.amount * units } })))
            .addOutput({ to: holder.tokenAddress, amount: 700_000n + units * fund.satoshis });

        const size = tx.build().length / 2;
        const { cost, budget } = operationCost(tx, 0); // the TransactionManager
        await expect(tx).toBeAccepted();
        expect(size).toBeLessThanOrEqual(MaxStandardTransactionSize);
        expect(cost).toBeLessThan(budget);
        console.log(`${perReserve} custody UTXOs per reserve, ${assetCount} assets: ${tx.inputs.length} inputs, ${size} bytes, `
            + `TransactionManager ${cost} of ${budget} operation cost without padding`);
    }, Timeout);
});

describe('stress: one redemption releasing 280 custody UTXOs of a single-token fund', () => {
    const custodyCount = 280;

    it('needs padding to fit the TransactionManager\'s budget, while still a standard transaction', async () => {
        const instance = await bootstrapInstance();
        const { provider, system } = instance;
        const holder = generateWallet();
        const fund = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 0n, assets: [{ category: randomCategory(), amount: 3n }] }));
        const asset = fund.assets[0]!;
        const units = BigInt(custodyCount);

        // One deposit gives the holder a single fund token UTXO; custody is then fragmented into one-unit UTXOs
        await deposit(instance, fund, holder, units);
        const { managerContract, fundContract, assetContracts, feeContract, feeVaultContract } = new FundTokenTransactionBuilder({ provider, system, fund }).getContracts();
        const fragments = Array.from({ length: custodyCount }, () =>
            provider.addUtxo(assetContracts[0]!.tokenAddress, randomUtxo({ satoshis: DustAmount, token: { category: asset.category, amount: asset.amount } })));
        const thread = (await managerContract.getUtxos()).find(u => u.token?.category === system.outflow)!;
        const feeUtxo = (await feeContract.getUtxos()).find(u => !u.token)!;
        const supply = (await fundContract.getUtxos()).find(u => u.token?.category === fund.category)!;
        const fundTokens = (await provider.getUtxos(holder.tokenAddress)).find(u => u.token?.category === fund.category)!;
        const funding = provider.addUtxo(holder.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));

        const redeem = (padding: number) => new FundTokenTransactionBuilder({ provider, system, fund })
            .addInput(thread, managerContract.unlock.outflow(getFundBin(fund), getPadding(padding)))
            .addInput(feeUtxo, feeContract.unlock.pay())
            .addInput(supply, fundContract.unlock.redeem())
            .addInputs(fragments, assetContracts[0]!.unlock.release())
            .addInputs([funding, fundTokens], holder.signatureTemplate.unlockP2PKH())
            .addOutputs([
                withDust({ to: managerContract.tokenAddress, token: thread.token }),
                withDust({ to: feeContract.tokenAddress }),
                { to: feeVaultContract.tokenAddress, amount: system.fees.execute.value },
                withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: supply.token!.amount + units * fund.amount } }),
                withDust({ to: holder.tokenAddress, token: { category: asset.category, amount: asset.amount * units } }),
                { to: holder.tokenAddress, amount: 800_000n },
            ]);

        await expect(redeem(0)).toBeRejected(/operation cost/);

        // The least padding that fits
        let low = 1;
        let high = 1000;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (verifyTransaction(redeem(middle)) === true) {
                high = middle;
            } else {
                low = middle + 1;
            }
        }
        const tx = redeem(low);
        const size = tx.build().length / 2;
        const { cost, budget } = operationCost(tx, 0);
        await expect(tx).toBeAccepted();
        expect(size).toBeLessThanOrEqual(MaxStandardTransactionSize);
        console.log(`${custodyCount} custody UTXOs of a single-token fund: ${size} bytes, `
            + `needs ${low} bytes of padding (TransactionManager ${cost} of ${budget} operation cost)`);
    }, Timeout);
});
