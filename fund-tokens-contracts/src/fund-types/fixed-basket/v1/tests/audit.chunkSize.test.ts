/**
 * Audit check (fresh pass, v0.1.0-rc2; negative result): the broadcaster chooses the publicFund
 * NFT chunk size, and PublicFundVault.proof() / burn() walk the whole series against a fixed
 * budget. Broadcast's own scans reject small chunk sizes first, so no accepted series is left
 * unprovable.
 *
 * Every accepted series must stay provable and burnable.
 */
import { TransactionBuilder, randomUtxo } from 'cashscript';

import { randomCategory } from '@test-utils/random.js';
import { generateWallet } from '@test-utils/wallet.js';

import { withDust } from '../../../../core/outputs.js';
import { PublicFundTransactionBuilder, getFundCommitment, normalizeFund } from '../index.js';
import { bootstrapInstance, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;

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
    const [proofFunding, burnFunding] = [randomUtxo({ satoshis: 100_000n }), randomUtxo({ satoshis: 100_000n })].map(u => provider.addUtxo(user.tokenAddress, u));
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

describe('audit: broadcaster-chosen chunk size cannot trap a publicFund series', () => {
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
