/**
 * Audit probes around the manager/fee/fund input index relations, with the manager at input 0
 * (so the fund input's `inputs[active - 2]` lookup lands on the manager, never out of range).
 */
import { randomUtxo } from 'cashscript';

import { generateWallet } from '@test-utils/wallet.js';

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
            .addInput(inflowUtxo, managerContract.unlock.inflow(getFundBin(fund)))
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
});
