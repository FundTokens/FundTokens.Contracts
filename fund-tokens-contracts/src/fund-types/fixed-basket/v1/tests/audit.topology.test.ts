/**
 * Audit probes around the manager/fee/fund input index relations, with the manager at input 0
 * (so the fund input's `inputs[active - 2]` lookup lands on the manager, never out of range).
 *
 * AUD-003 (regression): AssetManager.release() once parsed the preceding input's unlocking
 * bytecode and scanned back from three inputs earlier, so a redemption whose custody inputs
 * followed the fee directly (no FundManager input) could not run. The first custody input now
 * scans back over locking bytecodes only, and such a redemption is accepted; custody that does
 * not follow the fee or the FundManager inputs is still refused.
 */

import { generateWallet } from '@test-utils/wallet.js';
import { randomUtxo } from '@test-utils/random.js';

import { withDust } from '../../../../core/outputs.js';
import { FundTokenTransactionBuilder, getFundBin, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;

describe('audit: topology probes', () => {
    let instance: TestInstance;
    let fund: Fund;

    beforeAll(async () => {
        instance = await bootstrapInstance();
        fund = normalizeFund(await createFund(instance, {
            amount: 10n,
            satoshis: 1000n,
            assets: [
                { category: '12'.repeat(32), amount: 4n },
                { category: '88'.repeat(32), amount: 2n },
            ],
        }));
    });

    it('accepts an inflow with the manager at input 0, fee at 1 and fund supply at 2', async () => {
        const { provider, system } = instance;
        const user = generateWallet();
        const tx = new FundTokenTransactionBuilder({ provider, system, fund });
        const { managerContract, fundContract, satoshiAssetContract, assetContracts, feeContract, feeVaultContract } = tx.getContracts();

        const inflowUtxo = (await managerContract.getUtxos()).find(u => u.token?.category === system.inflow)!;
        const fundUtxo = (await fundContract.getUtxos()).find(u => u.token?.category === fund.category)!;
        const feeUtxo = (await feeContract.getUtxos()).find(u => !u.token)!;
        const assetUtxos = fund.assets.map(a => provider.addUtxo(user.tokenAddress, randomUtxo({ token: { category: a.category, amount: a.amount } })));
        const funding = provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));

        tx
            .addInput(inflowUtxo, managerContract.unlock.inflow(getFundBin(fund), new Uint8Array()))
            .addInput(feeUtxo, feeContract.unlock.pay())
            .addInput(fundUtxo, fundContract.unlock.mint())
            .addInputs([funding, ...assetUtxos], user.signatureTemplate.unlockP2PKH())
            .addOutputs([
                withDust({ to: managerContract.tokenAddress, token: inflowUtxo.token }),
                withDust({ to: feeContract.tokenAddress }),
                { to: feeVaultContract.tokenAddress, amount: system.fees.execute.value },
                withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: fundUtxo.token!.amount - fund.amount } }),
                { to: satoshiAssetContract!.tokenAddress, amount: fund.satoshis },
                ...fund.assets.map((a, i) => withDust({ to: assetContracts[i]!.tokenAddress, token: { category: a.category, amount: a.amount } })),
                { to: user.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: fund.amount } },
                { to: user.tokenAddress, amount: 800_000n },
            ]);

        await expect(tx).toBeAccepted();
    });

    it('rejects an outflow with the manager at input 0 that pays out assets no custody input released', async () => {
        const { provider, system } = instance;
        const user = generateWallet();
        const tx = new FundTokenTransactionBuilder({ provider, system, fund });
        const { managerContract, fundContract, feeContract, feeVaultContract } = tx.getContracts();

        const outflowUtxo = (await managerContract.getUtxos()).find(u => u.token?.category === system.outflow)!;
        const fundUtxo = (await fundContract.getUtxos()).find(u => u.token?.category === fund.category)!;
        const feeUtxo = (await feeContract.getUtxos()).find(u => !u.token)!;
        const fundTokens = provider.addUtxo(user.tokenAddress, randomUtxo({ token: { category: fund.category, amount: fund.amount } }));
        const funding = provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));

        tx
            .addInput(outflowUtxo, managerContract.unlock.outflow(getFundBin(fund), new Uint8Array()))
            .addInput(feeUtxo, feeContract.unlock.pay())
            .addInput(fundUtxo, fundContract.unlock.redeem())
            .addInputs([funding, fundTokens], user.signatureTemplate.unlockP2PKH())
            .addOutputs([
                withDust({ to: managerContract.tokenAddress, token: outflowUtxo.token }),
                withDust({ to: feeContract.tokenAddress }),
                { to: feeVaultContract.tokenAddress, amount: system.fees.execute.value },
                withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: fundUtxo.token!.amount + fund.amount } }),
                ...fund.assets.map(a => ({ to: user.tokenAddress, amount: DustAmount, token: { category: a.category, amount: a.amount } })),
                { to: user.tokenAddress, amount: fund.satoshis + DustAmount },
            ]);

        await expect(tx).toBeRejected();
    });

    describe('an outflow with no FundManager input (AUD-003)', () => {
        /** Redeems one unit deposited by a new user, the custody inputs following the fee, or an unrelated input when `gap`. */
        async function redeem(gap: boolean) {
            const { provider, system } = instance;
            const user = generateWallet();
            const deposit = new FundTokenTransactionBuilder({ provider, system, fund });
            await deposit.addInflow({ units: 1n });
            await deposit
                .addInputs([
                    provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 1_000_000n })),
                    ...fund.assets.map(a => provider.addUtxo(user.tokenAddress, randomUtxo({ token: { category: a.category, amount: a.amount } }))),
                ], user.signatureTemplate.unlockP2PKH())
                .addOutput({ to: user.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: fund.amount } })
                .addOutput({ to: user.tokenAddress, amount: 800_000n })
                .send();

            const tx = new FundTokenTransactionBuilder({ provider, system, fund });
            const { managerContract, fundContract, satoshiAssetContract, assetContracts, feeContract, feeVaultContract } = tx.getContracts();
            const outflowUtxo = (await managerContract.getUtxos()).find(u => u.token?.category === system.outflow)!;
            const feeUtxo = (await feeContract.getUtxos()).find(u => !u.token)!;
            const satoshiUtxo = (await satoshiAssetContract!.getUtxos()).find(u => u.satoshis === fund.satoshis)!;
            const assetUtxos = await Promise.all(fund.assets.map(async (a, i) =>
                (await assetContracts[i]!.getUtxos()).find(u => u.token?.amount === a.amount)!));
            const fundTokens = (await provider.getUtxos(user.tokenAddress)).find(u => u.token?.category === fund.category)!;
            const funding = provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));

            tx
                .addInput(outflowUtxo, managerContract.unlock.outflow(getFundBin(fund), new Uint8Array()))
                .addInput(feeUtxo, feeContract.unlock.pay());
            if (gap) {
                tx.addInput(provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 10_000n })), user.signatureTemplate.unlockP2PKH());
            }
            tx
                .addInput(satoshiUtxo, satoshiAssetContract!.unlock.release())
                .addInputs(assetUtxos.map((u, i) => ({ ...u, unlocker: assetContracts[i]!.unlock.release() })))
                .addInputs([funding, fundTokens], user.signatureTemplate.unlockP2PKH())
                .addOutputs([
                    withDust({ to: managerContract.tokenAddress, token: outflowUtxo.token }),
                    withDust({ to: feeContract.tokenAddress }),
                    { to: feeVaultContract.tokenAddress, amount: system.fees.execute.value },
                    withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: fund.amount } }), // a new FundManager UTXO collects the tokens
                    ...fund.assets.map(a => ({ to: user.tokenAddress, amount: DustAmount, token: { category: a.category, amount: a.amount } })),
                    { to: user.tokenAddress, amount: 800_000n },
                ]);
            return tx;
        }

        it('accepts custody inputs right after the fee', async () => {
            await expect(await redeem(false)).toBeAccepted();
        });

        it('rejects custody inputs after an unrelated input', async () => {
            await expect(await redeem(true)).toBeRejected(/tx\.inputs\[assetInputIndex\]\.lockingBytecode == satoshiLockingBytecode/);
        });
    });
});
