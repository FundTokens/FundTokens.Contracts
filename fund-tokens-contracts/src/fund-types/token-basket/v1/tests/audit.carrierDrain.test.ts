/**
 * Audit finding (v0.1.0-rc2): TransactionManager.outflow()'s token accounting covers only the
 * fungible amount. The satoshis carried by a token reserve UTXO, and an immutable NFT riding the
 * same category, are outside it even when every reserve input is inside the manager's accounted
 * run. A zero-unit outflow that preserves every fund token and every fungible reserve unit can
 * still strip both.
 *
 * Such a reserve can be deposited through inflow() today (the deposit output's value and NFT are
 * not pinned) or simply paid to the asset contract; it is seeded directly here so the test holds
 * whichever side the fix lands on.
 *
 * The contracts must reject the drain.
 */
import { randomUtxo, type SpendableUtxo } from 'cashscript';

import { randomCategory } from '@test-utils/random.js';
import { generateWallet } from '@test-utils/wallet.js';

import { withDust } from '../../../../core/outputs.js';
import { FundTokenTransactionBuilder, getFundBin, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';

const CarrierValue = 50_000n;
const NftCommitment = 'cafe';

describe('audit: carrier value and immutable NFT drained by a zero-unit outflow', () => {
    let instance: TestInstance;
    let fund: Fund;
    let reserve: SpendableUtxo;

    const nftToken = (amount: bigint) =>
        ({ category: fund.assets[0]!.category, amount, nft: { capability: 'none' as const, commitment: NftCommitment } });

    beforeEach(async () => {
        instance = await bootstrapInstance();
        fund = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 0n, assets: [{ category: randomCategory(), amount: 4n }] }));
        const { assetContracts } = new FundTokenTransactionBuilder({ provider: instance.provider, system: instance.system, fund }).getContracts();
        reserve = instance.provider.addUtxo(assetContracts[0]!.tokenAddress, randomUtxo({ satoshis: CarrierValue, token: nftToken(fund.assets[0]!.amount) }));
    });

    /** An outflow of zero units spending the reserve as the only accounted custody input. */
    async function buildOutflow(outputs: (contracts: ReturnType<FundTokenTransactionBuilder['getContracts']>, attacker: string) => Parameters<FundTokenTransactionBuilder['addOutputs']>[0]) {
        const { provider, system } = instance;
        const attacker = generateWallet();
        const tx = new FundTokenTransactionBuilder({ provider, system, fund });
        const contracts = tx.getContracts();
        const { managerContract, fundContract, assetContracts, feeContract, feeVaultContract } = contracts;
        const outflowThread = (await managerContract.getUtxos()).find(u => u.token?.category === system.outflow)!;
        const supply = (await fundContract.getUtxos()).find(u => u.token?.category === fund.category)!;
        const feeUtxo = (await feeContract.getUtxos()).find(u => !u.token)!;
        const funding = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 400_000n }));

        tx
            .addInput(outflowThread, managerContract.unlock.outflow(getFundBin(fund), new Uint8Array()))  // 0
            .addInput(feeUtxo, feeContract.unlock.pay())                                // 1
            .addInput(supply, fundContract.unlock.redeem())                             // 2
            .addInput(reserve, assetContracts[0]!.unlock.release())                     // 3 accounted reserve
            .addInput(funding, attacker.signatureTemplate.unlockP2PKH())                // 4
            .addOutputs([
                withDust({ to: managerContract.tokenAddress, token: outflowThread.token }),
                withDust({ to: feeContract.tokenAddress }),
                { to: feeVaultContract.tokenAddress, amount: system.fees.execute.value },
                withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: supply.token!.amount } }), // fund tokens unchanged
                ...outputs(contracts, attacker.tokenAddress),
            ]);
        return { tx, contracts, attacker };
    }

    it('rejects taking the reserve units without redeeming fund tokens (control)', async () => {
        const { tx } = await buildOutflow((_, attacker) => [
            withDust({ to: attacker, token: nftToken(fund.assets[0]!.amount) }),
            { to: attacker, amount: 200_000n },
        ]);
        await expect(tx).toBeRejected();
    });

    it('rejects stripping the carrier value and immutable NFT while keeping every reserve unit', async () => {
        const { tx, contracts, attacker } = await buildOutflow(({ assetContracts }, to) => [
            withDust({ to: assetContracts[0]!.tokenAddress, token: { category: fund.assets[0]!.category, amount: fund.assets[0]!.amount } }), // units kept, NFT and carrier gone
            withDust({ to, token: nftToken(0n) }),
            { to, amount: 300_000n + CarrierValue },
        ]);

        await expect(tx).toBeRejected();
        expect(await contracts.assetContracts[0]!.getUtxos()).toContainEqual(reserve);
        expect((await instance.provider.getUtxos(attacker.tokenAddress)).filter(u => u.token)).toHaveLength(0);
    });
});
