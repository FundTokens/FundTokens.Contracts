/**
 * Audit finding (N-1 variant, "fake deposit mint"): an outflow whose walk is ended early by a
 * non-contract input leaves a custody input unaccounted. Routing that input's value back into
 * the manager's accounted outputs, with a negative fund-locking amount, books a deposit that
 * never happened: fund tokens are minted for free and the fund is silently under-backed.
 *
 * The contracts must reject this transaction.
 *
 * T-1 (correction): with the manager at input 0, the fund input cannot sit at index 1 (the fee
 * slot), so there is no shape in which FundManager.mint() is bypassed.
 */
import { randomUtxo } from 'cashscript';

import { generateWallet } from '@test-utils/wallet.js';

import { withDust } from '../../../../core/outputs.js';
import { FundTokenTransactionBuilder, getFundBin, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;

describe('audit: fake-deposit mint (N-1 variant)', () => {
    let instance: TestInstance;
    let fund: Fund;

    beforeAll(async () => {
        instance = await bootstrapInstance();
        const { provider, system } = instance;
        fund = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 5000n, assets: [] }));

        // Two legitimate inflows stock the satoshi backing with separate UTXOs.
        for (const units of [5n, 7n]) {
            const user = generateWallet();
            const funding = provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 500_000n }));
            const inflow = new FundTokenTransactionBuilder({ provider, system, fund });
            await inflow.addInflow({ units });
            await inflow
                .addInput(funding, user.signatureTemplate.unlockP2PKH())
                .addOutput({ to: user.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: units * fund.amount } })
                .send();
        }
    });

    it('rejects an outflow that books an unaccounted custody input as a deposit and mints fund tokens', async () => {
        const { provider, system } = instance;
        const attacker = generateWallet();
        const tx = new FundTokenTransactionBuilder({ provider, system, fund });
        const { managerContract, fundContract, satoshiAssetContract, feeContract, feeVaultContract } = tx.getContracts();
        const satoshiContract = satoshiAssetContract!;

        const outflowUtxo = (await managerContract.getUtxos()).find(u => u.token?.category === system.outflow)!;
        const fundUtxo = (await fundContract.getUtxos())
            .filter(u => u.token?.category === fund.category)
            .sort((a, b) => (a.token!.amount > b.token!.amount ? -1 : 1))[0]!;
        const feeUtxo = (await feeContract.getUtxos()).find(u => !u.token)!;
        const backingUtxos = (await satoshiContract.getUtxos()).filter(u => !u.token);
        const backing = backingUtxos.reduce((sum, u) => sum + u.satoshis, 0n);
        expect(backing).toBe(12n * fund.satoshis);

        const gapUtxo = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));
        const reserve = backingUtxos[0]!;
        const minted = 5n * fund.amount;

        tx
            .addInput(outflowUtxo, managerContract.unlock.outflow(getFundBin(fund)))  // 0
            .addInput(feeUtxo, feeContract.unlock.pay())                              // 1
            .addInput(fundUtxo, fundContract.unlock.redeem())                         // 2 accounted supply
            .addInput(gapUtxo, attacker.signatureTemplate.unlockP2PKH())              // 3 ends the walk
            .addInput(reserve, satoshiContract.unlock.release())                      // 4 unaccounted
            .addOutputs([
                withDust({ to: managerContract.tokenAddress, token: outflowUtxo.token }),
                withDust({ to: feeContract.tokenAddress }),
                { to: feeVaultContract.tokenAddress, amount: system.fees.execute.value },
                withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: fundUtxo.token!.amount - minted } }),
                { to: satoshiContract.tokenAddress, amount: reserve.satoshis },                                  // "deposit" funded by input 4
                { to: attacker.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: minted } },
                { to: attacker.tokenAddress, amount: 890_000n },
            ]);

        await expect(tx).toBeRejected();
        const attackerTokens = (await provider.getUtxos(attacker.tokenAddress)).filter(u => u.token?.category === fund.category);
        expect(attackerTokens).toHaveLength(0);
    });

    it('rejects an inflow with the fund supply at input 1, where the manager expects the fee (T-1)', async () => {
        const { provider, system } = instance;
        const user = generateWallet();
        const tx = new FundTokenTransactionBuilder({ provider, system, fund });
        const { managerContract, fundContract, satoshiAssetContract, feeContract, feeVaultContract } = tx.getContracts();

        const inflowUtxo = (await managerContract.getUtxos()).find(u => u.token?.category === system.inflow)!;
        const fundUtxo = (await fundContract.getUtxos()).find(u => u.token?.category === fund.category)!;
        const feeUtxo = (await feeContract.getUtxos()).find(u => !u.token)!;
        const funding = provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 2_000_000n }));

        tx
            .addInput(inflowUtxo, managerContract.unlock.inflow(getFundBin(fund))) // 0
            .addInput(fundUtxo, fundContract.unlock.mint())                        // 1
            .addInput(feeUtxo, feeContract.unlock.pay())                           // 2
            .addInput(funding, user.signatureTemplate.unlockP2PKH())
            .addOutputs([
                withDust({ to: managerContract.tokenAddress, token: inflowUtxo.token }),
                withDust({ to: feeContract.tokenAddress }),
                { to: feeVaultContract.tokenAddress, amount: system.fees.execute.value },
                withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: fundUtxo.token!.amount - fund.amount } }),
                { to: satoshiAssetContract!.tokenAddress, amount: fund.satoshis },
                { to: user.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: fund.amount } },
                { to: user.tokenAddress, amount: 1_000_000n },
            ]);

        await expect(tx).toBeRejected();
    });
});
