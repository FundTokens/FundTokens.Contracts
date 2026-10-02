/**
 * Audit findings on VM operation-cost density (checklist 7.6 / 7.3):
 *
 *  V-1: a fund with 40 or more assets can be broadcast and deposited into, but
 *       TransactionManager.outflow() always exceeds its operation-cost budget, so nothing
 *       deposited can ever be redeemed.
 *  V-2: two fixed budgets cap every redemption: the manager's per-asset cost, and
 *       AssetManager.release()'s scan against a constant budget (its unlocking bytecode is
 *       always the same length). At the stress-test size (38 assets), redeeming across two
 *       reserve UTXOs per asset fails; at 30 assets, a 64-input redemption fails.
 *  (Negative result: PublicFundVault.proof() is not a ceiling up to 60 assets.)
 *
 * The invariant: whatever a fund accepts as a deposit, it can redeem. A fix may instead reject
 * such funds at creation or deposit, which also satisfies these tests.
 */
import { TransactionBuilder, randomUtxo } from 'cashscript';

import { generateWallet, type TestWallet } from '@test-utils/wallet.js';

import { FundTokenTransactionBuilder, PublicFundTransactionBuilder, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;
const Timeout = 300_000;

const accepted = async (tx: TransactionBuilder) => {
    try {
        await tx.send();
        return true;
    } catch {
        return false;
    }
};

/** Broadcasts a fund of `assetCount` assets; undefined if the contracts reject it. */
async function broadcastFund(instance: TestInstance, assetCount: number, satoshis = 1000n): Promise<Fund | undefined> {
    const { provider, system } = instance;
    const creator = generateWallet();
    const genesis = randomUtxo({ vout: 0, satoshis: DustAmount });
    const funding = randomUtxo({ satoshis: 100_000n });
    [genesis, funding].forEach(u => provider.addUtxo(creator.tokenAddress, u));
    const fund = normalizeFund({
        category: genesis.txid,
        amount: 10n,
        satoshis,
        // Deterministic, distinct categories.
        assets: Array.from({ length: assetCount }, (_, i) => ({ category: 'a'.repeat(60) + i.toString(16).padStart(4, '0'), amount: BigInt(i + 1) })),
    });

    const tx = new PublicFundTransactionBuilder({ provider, system });
    tx.addInput(genesis, creator.signatureTemplate.unlockP2PKH());
    await tx.addBroadcast({ fund });
    return await accepted(tx.addInput(funding, creator.signatureTemplate.unlockP2PKH())) ? fund : undefined;
}

/** Deposits `units` into `fund`, minting the fund tokens to `holder`; false if the contracts reject it. */
async function deposit({ provider, system }: TestInstance, fund: Fund, holder: TestWallet, units: bigint) {
    const funding = randomUtxo({ satoshis: 400_000n });
    const assetUtxos = fund.assets.map(a => randomUtxo({ token: { category: a.category, amount: a.amount * units } }));
    [funding, ...assetUtxos].forEach(u => provider.addUtxo(holder.tokenAddress, u));
    const tx = new FundTokenTransactionBuilder({ provider, system, fund });
    await tx.addInflow({ units });
    return accepted(tx
        .addInputs([funding, ...assetUtxos], holder.signatureTemplate.unlockP2PKH())
        .addOutput({ to: holder.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: units * fund.amount } })
        .addOutput({ to: holder.tokenAddress, amount: DustAmount }));
}

/** Redeems `units` of `fund` with the builder, spending `holder`'s fund tokens; resolves if the contracts accept it. */
async function redeem({ provider, system }: TestInstance, fund: Fund, holder: TestWallet, units: bigint) {
    const funding = randomUtxo({ satoshis: 1_000_000n });
    provider.addUtxo(holder.tokenAddress, funding);
    const fundTokens = (await provider.getUtxos(holder.tokenAddress)).filter(u => u.token?.category === fund.category);
    const change = fundTokens.reduce((sum, u) => sum + u.token!.amount, 0n) - units * fund.amount;

    const tx = new FundTokenTransactionBuilder({ provider, system, fund });
    await tx.addOutflow({ units });
    tx
        .addInputs([funding, ...fundTokens], holder.signatureTemplate.unlockP2PKH())
        .addOutputs(fund.assets.map(a => ({ to: holder.tokenAddress, amount: DustAmount, token: { category: a.category, amount: units * a.amount } })));
    if (change > 0n) {
        tx.addOutput({ to: holder.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: change } });
    }
    return tx.addOutput({ to: holder.tokenAddress, amount: DustAmount }).send();
}

/**
 * Broadcasts a fund and makes the given deposits. Undefined if the contracts refuse the fund or
 * any deposit, which is an acceptable fix: then nothing is locked in.
 */
async function fundWithDeposits(assetCount: number, deposits: bigint[], satoshis?: bigint) {
    const instance = await bootstrapInstance();
    const holder = generateWallet();
    const fund = await broadcastFund(instance, assetCount, satoshis);
    if (!fund) return undefined;
    for (const units of deposits) {
        if (!await deposit(instance, fund, holder, units)) return undefined;
    }
    return { redeem: (units: bigint) => redeem(instance, fund, holder, units) };
}

describe('audit: large funds stay redeemable (V-1)', () => {
    it('39 assets: deposits and redeems (control)', async () => {
        const setup = await fundWithDeposits(39, [3n]);
        expect(setup).toBeDefined();
        await expect(setup!.redeem(1n)).toBeAccepted();
    }, Timeout);

    it('40 assets: a fund that accepts a deposit can redeem it', async () => {
        const setup = await fundWithDeposits(40, [3n]);
        if (!setup) return;
        await expect(setup.redeem(1n)).toBeAccepted();
        await expect(setup.redeem(2n)).toBeAccepted();
    }, Timeout);

    it('40 assets without satoshi backing: a fund that accepts a deposit can redeem it', async () => {
        const setup = await fundWithDeposits(40, [3n], 0n);
        if (!setup) return;
        await expect(setup.redeem(1n)).toBeAccepted();
    }, Timeout);
});

describe('audit: PublicFundVault.proof() is not a ceiling (negative result)', () => {
    it.each([39, 50, 60])('%i assets: proof() accepts the broadcast series', async assetCount => {
        const instance = await bootstrapInstance();
        expect(await broadcastFund(instance, assetCount)).toBeDefined();

        const { provider, system } = instance;
        const user = generateWallet();
        const funding = randomUtxo({ satoshis: 10_000n });
        provider.addUtxo(user.tokenAddress, funding);
        const { publicFundVaultContract: vault } = new PublicFundTransactionBuilder({ provider, system }).getContracts();
        const [head, ...rest] = await vault.getUtxos();
        const proof = new TransactionBuilder({ provider })
            .addInput(head!, vault.unlock.proof())
            .addInputs(rest, vault.unlock.data())
            .addInput(funding, user.signatureTemplate.unlockP2PKH())
            .addOutputs([head!, ...rest].map(u => ({ to: vault.tokenAddress, amount: u.satoshis, token: u.token! })))
            .addOutput({ to: user.tokenAddress, amount: 2000n });

        await expect(proof).toBeAccepted();
    }, Timeout);
});

describe('audit: redemptions spanning several reserve UTXOs (V-2)', () => {
    it('38 assets: redeems each reserve UTXO in turn (control)', async () => {
        const setup = await fundWithDeposits(38, [3n, 3n]);
        expect(setup).toBeDefined();
        await expect(setup!.redeem(3n)).toBeAccepted();
        await expect(setup!.redeem(3n)).toBeAccepted();
    }, Timeout);

    it('38 assets: a single redemption spanning two reserve UTXOs per asset', async () => {
        const setup = await fundWithDeposits(38, [3n, 3n]);
        if (!setup) return;
        await expect(setup.redeem(4n)).toBeAccepted();
    }, Timeout);

    it('30 assets: a 64-input redemption', async () => {
        const setup = await fundWithDeposits(30, [3n, 3n]);
        if (!setup) return;
        await expect(setup.redeem(4n)).toBeAccepted();
    }, Timeout);
});
