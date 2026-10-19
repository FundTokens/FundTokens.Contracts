/**
 * Audit check (fresh pass, v0.1.0-rc2), revised for P2-1: the broadcaster used to choose the
 * publicFund chunk size, and PublicFundVault.proof() / burn() walk the whole series against a fixed
 * budget, so small chunks could leave a series that broadcasts but can't be burned. Now every chunk
 * but the last is a whole 128-byte commitment, and each later chunk starts with the continuation
 * byte 0x03, so the only series broadcast accepts are the builder's.
 *
 * Every accepted series must stay provable and burnable; every other chunking is refused.
 */
import { TransactionBuilder } from 'cashscript';

import { randomCategory, randomUtxo } from '@test-utils/random.js';
import { generateWallet } from '@test-utils/wallet.js';

import { withDust } from '../../../../core/outputs.js';
import { PublicFundTransactionBuilder, getFundChunks, getFundCommitment, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;

/** The commitment cut into `size`-byte chunks, each after the first opening with `marker` (none: raw pieces). */
function chunked(fund: Fund, size: number, marker: string): string[] {
    const commitment = getFundCommitment(fund);
    const chunks = [commitment.slice(0, size * 2)];
    const step = (size - marker.length / 2) * 2;
    for (let offset = size * 2; offset < commitment.length; offset += step) {
        chunks.push(marker + commitment.slice(offset, offset + step));
    }
    return chunks;
}

/** A fund creation for `assetCount` assets publishing `chunks(fund)` in place of the builder's chunks. */
async function broadcastWith(instance: TestInstance, assetCount: number, chunks: (fund: Fund) => string[]) {
    const { provider, system } = instance;
    const creator = generateWallet();
    const genesis = provider.addUtxo(creator.tokenAddress, randomUtxo({ vout: 0, satoshis: DustAmount }));
    const funding = provider.addUtxo(creator.tokenAddress, randomUtxo({ satoshis: 2_000_000n }));
    const fund = normalizeFund({
        category: genesis.txid,
        amount: 10n,
        satoshis: 1000n,
        assets: Array.from({ length: assetCount }, (_, i) => ({ category: randomCategory(), amount: BigInt(i + 1) })),
    });

    const tx = new PublicFundTransactionBuilder({ provider, system });
    const vault = tx.getContracts().publicFundVaultContract.tokenAddress;
    tx.addInput(genesis, creator.signatureTemplate.unlockP2PKH());
    await tx.addBroadcast({ fund, padding: 1000 });
    while (tx.outputs.at(-1)?.to === vault) tx.outputs.pop();
    for (const commitment of chunks(fund)) {
        tx.addOutput(withDust({ to: vault, token: { category: system.publicFund, amount: 0n, nft: { capability: 'none', commitment } } }));
    }
    return tx.addInput(funding, creator.signatureTemplate.unlockP2PKH());
}

async function seriesTransactions({ provider, system, owner }: TestInstance) {
    const user = generateWallet();
    const [proofFunding, burnFunding] = [randomUtxo({ satoshis: 100_000n }), randomUtxo({ satoshis: 100_000n })].map(u => provider.addUtxo(user.tokenAddress, u));
    const { publicFundVaultContract: vault } = new PublicFundTransactionBuilder({ provider, system }).getContracts();
    const [head, ...rest] = (await vault.getUtxos()).sort((a, b) => a.vout - b.vout);
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

describe('audit: the publicFund chunking is fixed, so no accepted series is trapped', () => {
    // 70 assets is about the most a listing can have and still be burned: proof() and burn() take no padding (LIMITS.md)
    it.each([1, 10, 20, 70])('accepts the builder\'s chunking of %i asset(s), then proves and burns it (control)', async (assets) => {
        const instance = await bootstrapInstance();
        await expect(await broadcastWith(instance, assets, getFundChunks)).toBeAccepted();

        const { proof, burn } = await seriesTransactions(instance);
        // Both spend the same series, so each is evaluated against it rather than sent
        expect(proof).not.toFailRequire();
        expect(burn).not.toFailRequire();
    });

    it.each([[1, 4], [1, 3], [10, 24], [10, 16], [20, 36], [20, 127]])('refuses %i asset(s) in %i-byte chunks', async (assets, size) => {
        const instance = await bootstrapInstance();
        const tx = await broadcastWith(instance, assets, fund => chunked(fund, size, '03'));
        expect(tx).toFailRequireWith('require(lastChunkLength == 128)');
    });

    it.each([['no continuation byte', ''], ['a 0x02 type byte', '02']])('refuses later chunks with %s', async (_, marker) => {
        const instance = await bootstrapInstance();
        const tx = await broadcastWith(instance, 10, fund => chunked(fund, 128, marker));
        expect(tx).toFailRequireWith('require(marker == 0x03)');
    });
});
