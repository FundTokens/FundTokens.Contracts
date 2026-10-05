/**
 * Audit finding AUD-015: two of TransactionManager.outflow()'s loops read the next output with no
 * bounds check, the FundManager output run and the BCH change run:
 *
 *   while(tx.outputs[fundOutputIndex].lockingBytecode == managerContract) { ... }
 *   while(tx.outputs[assetOutputIndex].lockingBytecode == satoshiLockingBytecode && ...) { ... }
 *
 * When either run ends at the last output, the next read is past the end and the script fails,
 * so a valid redemption is rejected. The redeemer's outputs normally follow the custody change
 * (the builders put them there), which hides this; here they come before the manager instead.
 *
 * The redemptions below are valid, so the contracts should accept them. Until the loops are
 * bounded, the "as it stands" tests fail:
 *
 *   - no custody change: "Program attempted to read from an invalid transaction output index.
 *     Transaction output count: 6; requested index: 6", at tx.outputs[fundOutputIndex]
 *   - BCH change last: "... output count: 7; requested index: 7", at tx.outputs[assetOutputIndex]
 *
 * Each control differs only by one more output at the end, and is accepted.
 */
import { generateWallet, type TestWallet } from '@test-utils/wallet.js';
import { randomUtxo } from '@test-utils/random.js';

import { withDust } from '../../../../core/outputs.js';
import { FundTokenTransactionBuilder, getFundBin, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;
const UnitSatoshis = 5000n;

describe('audit: outflow loops reading past the last output (AUD-015)', () => {
    let instance: TestInstance;
    let fund: Fund;
    let user: TestWallet;

    beforeEach(async () => {
        instance = await bootstrapInstance();
        fund = normalizeFund(await createFund(instance, { amount: 10n, satoshis: UnitSatoshis, assets: [] }));
        user = generateWallet();

        // Deposit two units, held in one BCH custody UTXO.
        const { provider, system } = instance;
        const deposit = new FundTokenTransactionBuilder({ provider, system, fund });
        await deposit.addInflow({ units: 2n });
        await deposit
            .addInput(provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 1_000_000n })), user.signatureTemplate.unlockP2PKH())
            .addOutput({ to: user.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: 2n * fund.amount } })
            .addOutput({ to: user.tokenAddress, amount: 800_000n })
            .send();
    });

    /**
     * Redeems `units` with the redeemer's inputs and outputs (0 and 1) before the manager (2), so
     * the manager's runs end the transaction, unless `trailing` adds one more output at the end.
     */
    async function redeem(units: bigint, trailing: boolean) {
        const { provider, system } = instance;
        const tx = new FundTokenTransactionBuilder({ provider, system, fund });
        const { managerContract, fundContract, satoshiAssetContract, feeContract, feeVaultContract } = tx.getContracts();
        const outflowUtxo = (await managerContract.getUtxos()).find(u => u.token?.category === system.outflow)!;
        const feeUtxo = (await feeContract.getUtxos()).find(u => !u.token)!;
        const fundUtxo = (await fundContract.getUtxos()).find(u => u.token?.category === fund.category)!;
        const custody = (await satoshiAssetContract!.getUtxos())[0]!;
        const fundTokens = (await provider.getUtxos(user.tokenAddress)).find(u => u.token?.category === fund.category)!;
        const funding = provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));
        const change = custody.satoshis - units * UnitSatoshis;
        const tokenChange = fundTokens.token!.amount - units * fund.amount;

        tx
            .addInputs([funding, fundTokens], user.signatureTemplate.unlockP2PKH())                       // 0, 1
            .addInput(outflowUtxo, managerContract.unlock.outflow(getFundBin(fund), new Uint8Array()))  // 2
            .addInput(feeUtxo, feeContract.unlock.pay())                                                // 3
            .addInput(fundUtxo, fundContract.unlock.redeem())                                           // 4
            .addInput(custody, satoshiAssetContract!.unlock.release())                                  // 5
            .addOutputs([
                { to: user.tokenAddress, amount: units * UnitSatoshis },                                // 0: released BCH
                tokenChange > 0n                                                                        // 1: change
                    ? { to: user.tokenAddress, amount: 800_000n, token: { category: fund.category, amount: tokenChange } }
                    : { to: user.tokenAddress, amount: 800_000n },
                withDust({ to: managerContract.tokenAddress, token: outflowUtxo.token }),              // 2
                withDust({ to: feeContract.tokenAddress }),                                             // 3
                { to: feeVaultContract.tokenAddress, amount: system.fees.execute.value },               // 4
                withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: fundUtxo.token!.amount + units * fund.amount } }), // 5
            ]);
        if (change > 0n) {
            tx.addOutput({ to: satoshiAssetContract!.tokenAddress, amount: change });                   // 6: BCH change
        }
        if (trailing) {
            tx.addOutput({ to: user.tokenAddress, amount: DustAmount });
        }
        return tx;
    }

    describe('the FundManager output run ends the transaction (no custody change)', () => {
        it('accepts the redemption with one more output after it (control)', async () => {
            await expect(await redeem(2n, true)).toBeAccepted();
        });

        it('accepts the redemption as it stands', async () => {
            await expect(await redeem(2n, false)).toBeAccepted();
        });
    });

    describe('the BCH change run ends the transaction', () => {
        it('accepts the redemption with one more output after it (control)', async () => {
            await expect(await redeem(1n, true)).toBeAccepted();
        });

        it('accepts the redemption as it stands', async () => {
            await expect(await redeem(1n, false)).toBeAccepted();
        });
    });
});
