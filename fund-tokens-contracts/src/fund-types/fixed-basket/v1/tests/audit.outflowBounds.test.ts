/**
 * Audit finding AUD-015: two of TransactionManager.outflow()'s loops read the next output with no
 * bounds check, the FundManager output run and the BCH change run. When either run ended at the
 * last output, the next read was past the end and the script failed, so a valid redemption was
 * rejected ("Program attempted to read from an invalid transaction output index"). The
 * redeemer's outputs normally follow the custody change (the builders put them there), which hid
 * this; here they come before the manager instead.
 *
 * Both loops are bounded now, and these redemptions must be accepted. Each control differs only by
 * one more output at the end.
 *
 * The bounded change loops also refuse custody that could never be spent again: BCH change
 * carrying a token (the BCH AssetManager releases only tokenless UTXOs), and another category at
 * an asset's custody address right after its change (an AssetManager releases only its own).
 */
import { generateWallet, type TestWallet } from '@test-utils/wallet.js';
import { randomCategory, randomUtxo } from '@test-utils/random.js';

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
     * With `token`, the redeemer also spends a fungible token (input 6) and pays it onto the BCH
     * change or the trailing output.
     */
    async function redeem(units: bigint, trailing: boolean, token?: 'change' | 'trailing') {
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
        const stray = { category: randomCategory(), amount: 5n };

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
        if (token) {
            tx.addInput(provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 10_000n, token: stray })), user.signatureTemplate.unlockP2PKH()); // 6
        }
        if (change > 0n) {
            tx.addOutput(token === 'change'                                                             // 6: BCH change
                ? { to: satoshiAssetContract!.tokenAddress, amount: change, token: stray }
                : { to: satoshiAssetContract!.tokenAddress, amount: change });
        }
        if (trailing) {
            tx.addOutput(token === 'trailing' ? { to: user.tokenAddress, amount: DustAmount, token: stray } : { to: user.tokenAddress, amount: DustAmount });
        }
        return tx;
    }

    describe('the FundManager output run ends the transaction (no custody change)', () => {
        it('accepts the redemption with one more output after it (control)', async () => {
            await expect(await redeem(2n, true)).toBeAccepted();
        });

        it('accepts the redemption ending at the last output', async () => {
            await expect(await redeem(2n, false)).toBeAccepted();
        });
    });

    describe('the BCH change run ends the transaction', () => {
        it('accepts the redemption with one more output after it (control)', async () => {
            await expect(await redeem(1n, true)).toBeAccepted();
        });

        it('accepts the redemption ending at the last output', async () => {
            await expect(await redeem(1n, false)).toBeAccepted();
        });
    });

    describe('asset change followed by another category at the same custody address', () => {
        /** Redeems one unit of a one-asset fund with the builder; a stray token goes to the asset's custody right after its change, or to the redeemer. */
        async function redeemAsset(strayTo: 'custody' | 'redeemer') {
            const { provider, system } = instance;
            const assetFund = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 0n, assets: [{ category: randomCategory(), amount: 4n }] }));
            const asset = assetFund.assets[0]!;
            const deposit = new FundTokenTransactionBuilder({ provider, system, fund: assetFund });
            await deposit.addInflow({ units: 2n });
            await deposit
                .addInputs([
                    provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 1_000_000n })),
                    provider.addUtxo(user.tokenAddress, randomUtxo({ token: { category: asset.category, amount: 2n * asset.amount } })),
                ], user.signatureTemplate.unlockP2PKH())
                .addOutput({ to: user.tokenAddress, amount: DustAmount, token: { category: assetFund.category, amount: 2n * assetFund.amount } })
                .addOutput({ to: user.tokenAddress, amount: 800_000n })
                .send();

            const tx = new FundTokenTransactionBuilder({ provider, system, fund: assetFund });
            await tx.addOutflow({ units: 1n });
            const { assetContracts } = tx.getContracts();
            const stray = { category: randomCategory(), amount: 5n };
            const fundTokens = (await provider.getUtxos(user.tokenAddress)).find(u => u.token?.category === assetFund.category)!;
            return tx
                .addInputs([
                    provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 1_000_000n })),
                    fundTokens,
                    provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 10_000n, token: stray })),
                ], user.signatureTemplate.unlockP2PKH())
                .addOutput(withDust({ to: strayTo === 'custody' ? assetContracts[0]!.tokenAddress : user.tokenAddress, token: stray })) // right after the asset change
                .addOutput(withDust({ to: user.tokenAddress, token: { category: asset.category, amount: asset.amount } }))
                .addOutput(withDust({ to: user.tokenAddress, token: { category: assetFund.category, amount: assetFund.amount } }))
                .addOutput({ to: user.tokenAddress, amount: 800_000n });
        }

        it('accepts the stray token paid to the redeemer (control)', async () => {
            await expect(await redeemAsset('redeemer')).toBeAccepted();
        });

        it('rejects it at the asset custody address, where it could never be released', async () => {
            await expect(await redeemAsset('custody')).toBeRejected(/tx\.outputs\[assetOutputIndex\]\.tokenCategory == nft_assetCategory/);
        });
    });

    describe('BCH change carrying a token', () => {
        it('accepts the token paid to the redeemer (control)', async () => {
            await expect(await redeem(1n, true, 'trailing')).toBeAccepted();
        });

        it('rejects the token paid onto the BCH change, where it could never be released', async () => {
            await expect(await redeem(1n, true, 'change')).toBeRejected(/tx\.outputs\[assetOutputIndex\]\.tokenCategory == 0x/);
        });
    });
});
