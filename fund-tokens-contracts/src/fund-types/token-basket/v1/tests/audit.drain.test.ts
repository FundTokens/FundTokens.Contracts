/**
 * Audit finding (Phase 1): an outflow that redeems zero fund units, with a non-contract
 * input placed straight after the fund input, stops the manager's asset walk before it
 * reaches the asset UTXOs. Those asset inputs are then unaccounted and could be sent anywhere.
 *
 * The contracts must reject this transaction.
 */
import { randomToken, randomUtxo } from 'cashscript';

import { generateWallet } from '@test-utils/wallet.js';
import { randomCategory } from '@test-utils/random.js';

import { withDust } from '../../../../core/outputs.js';
import { FundTokenTransactionBuilder, getFundBin, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;

describe('audit: zero-unit outflow drain', () => {
    let instance: TestInstance;
    let fund: Fund;

    beforeAll(async () => {
        instance = await bootstrapInstance();
        // A single token asset and no BCH backing keeps the topology minimal.
        fund = normalizeFund(await createFund(instance, {
            amount: 10n,
            satoshis: 0n,
            assets: [{ category: randomCategory(), amount: 4n }],
        }));

        // Stock the asset contract with several reserve UTXOs through legitimate inflows.
        for (const units of [5n, 7n]) {
            const user = generateWallet();
            const funding = instance.provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 200_000n }));
            const assetUtxos = fund.assets.map(a => instance.provider.addUtxo(user.tokenAddress, randomUtxo({ token: randomToken({ category: a.category, amount: a.amount * units }) })));

            const inflow = new FundTokenTransactionBuilder({ provider: instance.provider, system: instance.system, fund });
            await inflow.addInflow({ units });
            await inflow
                .addInputs([funding, ...assetUtxos], user.signatureTemplate.unlockP2PKH())
                .addOutput({ to: user.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: units * fund.amount } })
                .send();
        }
    });

    it('rejects an outflow redeeming zero units that releases unaccounted asset UTXOs', async () => {
        const { provider, system } = instance;
        const attacker = generateWallet();
        const tx = new FundTokenTransactionBuilder({ provider, system, fund });
        const { managerContract, fundContract, assetContracts, feeContract, feeVaultContract } = tx.getContracts();
        const assetContract = assetContracts[0]!;
        const asset = fund.assets[0]!;

        const outflowUtxo = (await managerContract.getUtxos()).find(u => u.token?.category === system.outflow)!;
        const fundUtxo = (await fundContract.getUtxos())
            .filter(u => u.token?.category === fund.category)
            .sort((a, b) => (a.token!.amount > b.token!.amount ? -1 : 1))[0]!;
        const feeUtxo = (await feeContract.getUtxos()).find(u => !u.token)!;
        const assetUtxos = (await assetContract.getUtxos()).filter(u => u.token?.category === asset.category);
        const reserves = assetUtxos.reduce((sum, u) => sum + u.token!.amount, 0n);
        expect(assetUtxos.length).toBeGreaterThan(1);

        // Sits between the fund input and the asset inputs, ending the manager's asset walk early.
        const gapUtxo = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));

        tx
            .addInput(outflowUtxo, managerContract.unlock.outflow(getFundBin(fund)))           // 0
            .addInput(feeUtxo, feeContract.unlock.pay())                                       // 1
            .addInput(fundUtxo, fundContract.unlock.redeem())                                  // 2
            .addInput(gapUtxo, attacker.signatureTemplate.unlockP2PKH())                       // 3
            .addInputs(assetUtxos.map(u => ({ ...u, unlocker: assetContract.unlock.release() }))) // 4.. unaccounted
            .addOutputs([
                withDust({ to: managerContract.tokenAddress, token: outflowUtxo.token }),                          // 0 manager return
                withDust({ to: feeContract.tokenAddress }),                                                        // 1 fee return
                { to: feeVaultContract.tokenAddress, amount: system.fees.execute.value },                          // 2 fee payment
                withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: fundUtxo.token!.amount } }), // 3 fund unchanged
                { to: attacker.tokenAddress, amount: DustAmount, token: { category: asset.category, amount: reserves } },        // 4 all reserves
                { to: attacker.tokenAddress, amount: 800_000n },                                                   // 5 change
            ]);

        await expect(tx).toBeRejected();

        const remaining = (await assetContract.getUtxos())
            .filter(u => u.token?.category === asset.category)
            .reduce((sum, u) => sum + u.token!.amount, 0n);
        expect(remaining).toBe(reserves);
    });
});

describe('audit: zero-unit outflow drain (satoshi backing)', () => {
    let instance: TestInstance;
    let fund: Fund;

    beforeAll(async () => {
        instance = await bootstrapInstance();
        // BCH backing only, no token assets.
        fund = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 5000n, assets: [] }));

        // Stock the satoshi contract with several backing UTXOs through legitimate inflows.
        for (const units of [5n, 7n]) {
            const user = generateWallet();
            const funding = instance.provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 500_000n }));

            const inflow = new FundTokenTransactionBuilder({ provider: instance.provider, system: instance.system, fund });
            await inflow.addInflow({ units });
            await inflow
                .addInput(funding, user.signatureTemplate.unlockP2PKH())
                .addOutput({ to: user.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: units * fund.amount } })
                .send();
        }
    });

    it('rejects an outflow redeeming zero units that releases unaccounted satoshi UTXOs', async () => {
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
        const satoshiUtxos = (await satoshiContract.getUtxos()).filter(u => !u.token);
        const backing = satoshiUtxos.reduce((sum, u) => sum + u.satoshis, 0n);
        expect(satoshiUtxos.length).toBeGreaterThan(1);

        // Sits between the fund input and the satoshi inputs, ending the manager's walk early.
        const gapUtxo = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));

        tx
            .addInput(outflowUtxo, managerContract.unlock.outflow(getFundBin(fund)))               // 0
            .addInput(feeUtxo, feeContract.unlock.pay())                                           // 1
            .addInput(fundUtxo, fundContract.unlock.redeem())                                      // 2
            .addInput(gapUtxo, attacker.signatureTemplate.unlockP2PKH())                           // 3
            .addInputs(satoshiUtxos.map(u => ({ ...u, unlocker: satoshiContract.unlock.release() }))) // 4.. unaccounted
            .addOutputs([
                withDust({ to: managerContract.tokenAddress, token: outflowUtxo.token }),                          // 0 manager return
                withDust({ to: feeContract.tokenAddress }),                                                        // 1 fee return
                { to: feeVaultContract.tokenAddress, amount: system.fees.execute.value },                          // 2 fee payment
                withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: fundUtxo.token!.amount } }), // 3 fund unchanged
                { to: attacker.tokenAddress, amount: backing + 890_000n },                                         // 4 all backing + change
            ]);

        await expect(tx).toBeRejected();

        const remaining = (await satoshiContract.getUtxos())
            .filter(u => !u.token)
            .reduce((sum, u) => sum + u.satoshis, 0n);
        expect(remaining).toBe(backing);
    });
});
