/**
 * Audit findings (fresh pass, v0.1.0-rc2):
 *
 * A)  FundManager authorizes on thread-token presence at inputs[active - 2], never on the
 *     TransactionManager script. A thread-shaped NFT held at a plain P2PKH (forged with a
 *     thread-category minting NFT, e.g. from the fund-creation smuggling findings) is then a
 *     standalone mint() authority: the fund-token supply leaves with no manager, fee or deposit.
 * A2) The same defect in redeem() composes with AssetManager.release(): one transaction takes
 *     the supply and the whole reserve.
 * B)  (Negative result.) The broadcaster chooses the publicFund NFT chunk size, and
 *     PublicFundVault.proof() / burn() walk the whole series against a fixed budget. Broadcast's
 *     own scans reject small chunk sizes first, so no accepted series is left unprovable.
 *
 * The contracts must reject A and A2, and every accepted series in B must stay provable and burnable.
 */
import { swapEndianness } from '@bitauth/libauth';
import { TransactionBuilder, randomUtxo, type Utxo } from 'cashscript';

import { randomCategory } from '@test-utils/random.js';
import { generateWallet, type TestWallet } from '@test-utils/wallet.js';

import { withDust } from '../../../../core/outputs.js';
import {
    FundTokenTransactionBuilder,
    PublicFundTransactionBuilder,
    getFundCommitment,
    hashFund,
    normalizeFund,
    type Fund,
} from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;

/** Mints a thread-shaped NFT (the fund's real commitment) to the attacker's P2PKH, using a rogue minting NFT. */
async function forgeThread({ provider }: TestInstance, attacker: TestWallet, category: string, fund: Fund): Promise<Utxo> {
    const rogueMinter = randomUtxo({ satoshis: 5000n, token: { category, amount: 0n, nft: { capability: 'minting', commitment: '01' } } });
    const funding = randomUtxo({ satoshis: 100_000n });
    [rogueMinter, funding].forEach(u => provider.addUtxo(attacker.tokenAddress, u));
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

    it('rejects a forged inflow thread at a P2PKH taking the fund supply through mint() (A)', async () => {
        const { provider, system } = instance;
        const fund = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 1000n, assets: [{ category: randomCategory(), amount: 4n }] }));
        const { fundContract } = new FundTokenTransactionBuilder({ provider, system, fund }).getContracts();
        const attacker = generateWallet();
        const forged = await forgeThread(instance, attacker, system.inflow, fund);
        const supply = (await fundContract.getUtxos()).find(u => u.token?.category === fund.category)!;
        const funding = randomUtxo({ satoshis: 5_000_000n });
        provider.addUtxo(attacker.tokenAddress, funding);

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

    it('rejects a forged outflow thread taking the supply through redeem() and the reserve through release() (A2)', async () => {
        const { provider, system } = instance;
        const fund = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 0n, assets: [{ category: randomCategory(), amount: 4n }] }));
        const asset = fund.assets[0]!;
        const { fundContract, assetContracts } = new FundTokenTransactionBuilder({ provider, system, fund }).getContracts();
        const assetContract = assetContracts[0]!;

        // One honest deposit, so the reserve holds something.
        const user = generateWallet();
        const userFunding = randomUtxo({ satoshis: 400_000n });
        const userAsset = randomUtxo({ token: { category: asset.category, amount: asset.amount * 5n } });
        [userFunding, userAsset].forEach(u => provider.addUtxo(user.tokenAddress, u));
        const inflow = new FundTokenTransactionBuilder({ provider, system, fund });
        await inflow.addInflow({ units: 5n });
        await inflow
            .addInputs([userFunding, userAsset], user.signatureTemplate.unlockP2PKH())
            .addOutput({ to: user.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: 5n * fund.amount } })
            .send();

        const attacker = generateWallet();
        const forged = await forgeThread(instance, attacker, system.outflow, fund);
        const supply = (await fundContract.getUtxos())
            .filter(u => u.token?.category === fund.category)
            .sort((a, b) => (a.token!.amount > b.token!.amount ? -1 : 1))[0]!;
        const reserve = (await assetContract.getUtxos()).filter(u => u.token?.category === asset.category);
        const reserveTotal = reserve.reduce((sum, u) => sum + u.token!.amount, 0n);
        const funding = randomUtxo({ satoshis: 5_000_000n });
        provider.addUtxo(attacker.tokenAddress, funding);

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

describe('audit: broadcaster-chosen chunk size cannot trap a publicFund series (B)', () => {
    const isValid = (tx: TransactionBuilder) => {
        try {
            tx.debug();
            return true;
        } catch {
            return false;
        }
    };

    /** Broadcasts `assetCount` assets with the definition split into `chunkSize`-byte NFTs; false if rejected. */
    async function broadcastChunked(instance: TestInstance, assetCount: number, chunkSize: number) {
        const { provider, system } = instance;
        const creator = generateWallet();
        const genesis = randomUtxo({ vout: 0, satoshis: DustAmount });
        const funding = randomUtxo({ satoshis: 2_000_000n });
        [genesis, funding].forEach(u => provider.addUtxo(creator.tokenAddress, u));
        const fund = normalizeFund({
            category: genesis.txid,
            amount: 10n,
            satoshis: 1000n,
            assets: Array.from({ length: assetCount }, (_, i) => ({ category: randomCategory(), amount: BigInt(i + 1) })),
        });

        const tx = new PublicFundTransactionBuilder({ provider, system });
        const vault = tx.getContracts().publicFundVaultContract.tokenAddress;
        tx.addInput(genesis, creator.signatureTemplate.unlockP2PKH());
        await tx.addBroadcast({ fund });
        while (tx.outputs.at(-1)?.to === vault) tx.outputs.pop();
        const commitment = getFundCommitment(fund);
        for (let offset = 0; offset < commitment.length; offset += chunkSize * 2) {
            tx.addOutput(withDust({
                to: vault,
                token: { category: system.publicFund, amount: 0n, nft: { capability: 'none', commitment: commitment.slice(offset, offset + chunkSize * 2) } },
            }));
        }
        tx.addInput(funding, creator.signatureTemplate.unlockP2PKH());
        if (!isValid(tx)) return false;
        await tx.send();
        return true;
    }

    async function seriesTransactions({ provider, system, owner }: TestInstance) {
        const user = generateWallet();
        const [proofFunding, burnFunding] = [randomUtxo({ satoshis: 100_000n }), randomUtxo({ satoshis: 100_000n })];
        [proofFunding, burnFunding].forEach(u => provider.addUtxo(user.tokenAddress, u));
        const { publicFundVaultContract: vault } = new PublicFundTransactionBuilder({ provider, system }).getContracts();
        const [head, ...rest] = await vault.getUtxos();
        const auth = (await provider.getUtxos(owner.tokenAddress)).find(u => u.token?.category === system.authorization)!;

        const proof = new TransactionBuilder({ provider })
            .addInput(head!, vault.unlock.proof())
            .addInputs(rest, vault.unlock.data())
            .addInput(proofFunding, user.signatureTemplate.unlockP2PKH())
            .addOutputs([head!, ...rest].map(u => ({ to: vault.tokenAddress, amount: u.satoshis, token: u.token! })))
            .addOutput({ to: user.tokenAddress, amount: 20_000n });

        const burn = new TransactionBuilder({ provider })
            .addInput(head!, vault.unlock.burn())
            .addInputs(rest, vault.unlock.data())
            .addInput(auth, owner.signatureTemplate.unlockP2PKH())
            .addInput(burnFunding, user.signatureTemplate.unlockP2PKH())
            .addOutput({ to: owner.tokenAddress, amount: DustAmount, token: auth.token! })
            .addOutput({ to: user.tokenAddress, amount: 20_000n });

        return { proof, burn };
    }

    const cases: [assets: number, chunkSize: number][] = [[1, 128], [1, 4], [1, 3], [10, 24], [10, 18], [10, 16], [20, 36], [20, 16]];

    it.each(cases)('%i asset(s) in %i-byte chunks: rejected at broadcast, or provable and burnable', async (assets, chunkSize) => {
        const instance = await bootstrapInstance();
        const accepted = await broadcastChunked(instance, assets, chunkSize);
        if (chunkSize === 128) expect(accepted).toBe(true); // the builder's own chunking always broadcasts
        if (!accepted) return;

        const { proof, burn } = await seriesTransactions(instance);
        expect(isValid(proof)).toBe(true);
        expect(isValid(burn)).toBe(true);
    });
});
