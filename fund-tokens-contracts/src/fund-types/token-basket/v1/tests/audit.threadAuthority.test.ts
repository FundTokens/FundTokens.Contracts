/**
 * Audit findings (fresh pass, v0.1.0-rc2):
 *
 * A)  FundManager authorizes on thread-token presence at inputs[active - 2], never on the
 *     TransactionManager script. A thread-shaped NFT held at a plain P2PKH (forged with a
 *     thread-category minting NFT, e.g. from the fund-creation smuggling findings) is then a
 *     standalone mint() authority: the fund-token supply leaves with no manager, fee or deposit.
 * A2) The same defect in redeem() takes the supply on its own, and composes with
 *     AssetManager.release() to take the whole reserve as well.
 *
 * The contracts must reject each of these transactions. (The chunk-size check from the same pass
 * is in audit.chunkSize.)
 */
import { swapEndianness } from '@bitauth/libauth';
import { TransactionBuilder, randomUtxo, type SpendableUtxo } from 'cashscript';

import { randomCategory } from '@test-utils/random.js';
import { generateWallet, type TestWallet } from '@test-utils/wallet.js';

import { FundTokenTransactionBuilder, hashFund, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;

/** Mints a thread-shaped NFT (the fund's real commitment) to the attacker's P2PKH, using a rogue minting NFT. */
async function forgeThread({ provider }: TestInstance, attacker: TestWallet, category: string, fund: Fund): Promise<SpendableUtxo> {
    const rogueMinter = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 5000n, token: { category, amount: 0n, nft: { capability: 'minting', commitment: '01' } } }));
    const funding = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 100_000n }));
    const commitment = '02' + swapEndianness(fund.category) + hashFund(fund);

    await new TransactionBuilder({ provider })
        .addInputs([rogueMinter, funding], attacker.signatureTemplate.unlockP2PKH())
        .addOutput({ to: attacker.tokenAddress, amount: 5000n, token: rogueMinter.token! })
        .addOutput({ to: attacker.tokenAddress, amount: DustAmount, token: { category, amount: 0n, nft: { capability: 'none', commitment } } })
        .addOutput({ to: attacker.tokenAddress, amount: 90_000n })
        .send();
    return (await provider.getUtxos(attacker.tokenAddress)).find(u => u.token?.nft?.commitment === commitment)!;
}

describe('audit: FundManager authorizes on thread-token presence (A, A2)', () => {
    let instance: TestInstance;

    beforeEach(async () => {
        instance = await bootstrapInstance();
    });

    /** A token-only fund with one honest 5-unit deposit, so its reserve holds something. */
    async function fundWithReserve() {
        const { provider, system } = instance;
        const fund = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 0n, assets: [{ category: randomCategory(), amount: 4n }] }));
        const asset = fund.assets[0]!;
        const user = generateWallet();
        const userFunding = provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 400_000n }));
        const userAsset = provider.addUtxo(user.tokenAddress, randomUtxo({ token: { category: asset.category, amount: asset.amount * 5n } }));
        const inflow = new FundTokenTransactionBuilder({ provider, system, fund });
        await inflow.addInflow({ units: 5n });
        await inflow
            .addInputs([userFunding, userAsset], user.signatureTemplate.unlockP2PKH())
            .addOutput({ to: user.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: 5n * fund.amount } })
            .send();

        const { fundContract, assetContracts } = new FundTokenTransactionBuilder({ provider, system, fund }).getContracts();
        const supply = (await fundContract.getUtxos())
            .filter(u => u.token?.category === fund.category)
            .sort((a, b) => (a.token!.amount > b.token!.amount ? -1 : 1))[0]!;
        return { fund, asset, fundContract, assetContract: assetContracts[0]!, supply };
    }

    it('rejects a forged inflow thread at a P2PKH taking the fund supply through mint() (A)', async () => {
        const { provider, system } = instance;
        const fund = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 1000n, assets: [{ category: randomCategory(), amount: 4n }] }));
        const { fundContract } = new FundTokenTransactionBuilder({ provider, system, fund }).getContracts();
        const attacker = generateWallet();
        const forged = await forgeThread(instance, attacker, system.inflow, fund);
        const supply = (await fundContract.getUtxos()).find(u => u.token?.category === fund.category)!;
        const funding = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 5_000_000n }));

        const steal = new TransactionBuilder({ provider })
            .addInput(forged, attacker.signatureTemplate.unlockP2PKH())  // 0 forged thread
            .addInput(funding, attacker.signatureTemplate.unlockP2PKH()) // 1 filler
            .addInput(supply, fundContract.unlock.mint())                // 2 fund supply
            .addOutput({ to: attacker.tokenAddress, amount: DustAmount, token: forged.token! })
            .addOutput({ to: attacker.tokenAddress, amount: DustAmount })
            .addOutput({ to: attacker.tokenAddress, amount: DustAmount })
            .addOutput({ to: fundContract.tokenAddress, amount: DustAmount })
            .addOutput({ to: attacker.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: supply.token!.amount } })
            .addOutput({ to: attacker.tokenAddress, amount: 4_900_000n });

        await expect(steal).toBeRejected();
        expect(await fundContract.getUtxos()).toContainEqual(supply);
    });

    it('rejects a forged outflow thread taking the fund supply through redeem() alone (A2)', async () => {
        const { provider, system } = instance;
        const { fund, fundContract, supply } = await fundWithReserve();
        const attacker = generateWallet();
        const forged = await forgeThread(instance, attacker, system.outflow, fund);
        const funding = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 5_000_000n }));

        const steal = new TransactionBuilder({ provider })
            .addInput(forged, attacker.signatureTemplate.unlockP2PKH())  // 0 forged outflow thread
            .addInput(funding, attacker.signatureTemplate.unlockP2PKH()) // 1 filler
            .addInput(supply, fundContract.unlock.redeem())              // 2 fund supply
            .addOutput({ to: attacker.tokenAddress, amount: DustAmount, token: forged.token! })
            .addOutput({ to: attacker.tokenAddress, amount: DustAmount })
            .addOutput({ to: attacker.tokenAddress, amount: DustAmount })
            .addOutput({ to: fundContract.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: 1n } })
            .addOutput({ to: attacker.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: supply.token!.amount - 1n } })
            .addOutput({ to: attacker.tokenAddress, amount: 4_900_000n });

        await expect(steal).toBeRejected();
        expect(await fundContract.getUtxos()).toContainEqual(supply);
    });

    it('rejects a forged outflow thread taking the supply through redeem() and the reserve through release() (A2)', async () => {
        const { provider, system } = instance;
        const { fund, asset, fundContract, assetContract, supply } = await fundWithReserve();
        const attacker = generateWallet();
        const forged = await forgeThread(instance, attacker, system.outflow, fund);
        const reserve = (await assetContract.getUtxos()).filter(u => u.token?.category === asset.category);
        const reserveTotal = reserve.reduce((sum, u) => sum + u.token!.amount, 0n);
        const funding = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 5_000_000n }));

        const steal = new TransactionBuilder({ provider })
            .addInput(forged, attacker.signatureTemplate.unlockP2PKH())                            // 0 forged outflow thread
            .addInput(funding, attacker.signatureTemplate.unlockP2PKH())                           // 1 filler
            .addInput(supply, fundContract.unlock.redeem())                                        // 2 fund supply
            .addInputs(reserve.map(u => ({ ...u, unlocker: assetContract.unlock.release() })))     // 3.. reserve
            .addOutput({ to: attacker.tokenAddress, amount: DustAmount, token: forged.token! })
            .addOutput({ to: attacker.tokenAddress, amount: DustAmount })
            .addOutput({ to: attacker.tokenAddress, amount: DustAmount })
            .addOutput({ to: fundContract.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: 1n } })
            .addOutput({ to: attacker.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: supply.token!.amount - 1n } })
            .addOutput({ to: attacker.tokenAddress, amount: DustAmount, token: { category: asset.category, amount: reserveTotal } })
            .addOutput({ to: attacker.tokenAddress, amount: 4_900_000n });

        await expect(steal).toBeRejected();
        const remaining = (await assetContract.getUtxos()).reduce((sum, u) => sum + (u.token?.amount ?? 0n), 0n);
        expect(remaining).toBe(reserveTotal);
    });
});
