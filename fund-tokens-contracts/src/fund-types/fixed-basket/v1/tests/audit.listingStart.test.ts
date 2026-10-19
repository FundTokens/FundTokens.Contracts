/**
 * Audit finding P2-1: PublicFundVault.proof() didn't check that it starts at a listing's first
 * chunk. A creator could fill a fund's asset fields so that, from a later chunk on, the series
 * reads as `0x02 · hash(Y) · Y`: a valid definition of a fund Y that never went through PublicFund
 * (so its genesis and supply were never checked). proof() run from that chunk proved Y listed.
 *
 * Now every chunk after the first starts with the continuation byte 0x03, which proof() leaves out
 * of later chunks but not of the chunk it starts from, so it can only start at a first chunk.
 * Here the vault UTXOs are placed directly (as broadcast would leave them) to isolate proof().
 */
import { MockNetworkProvider, TransactionBuilder } from 'cashscript';

import { randomCategory, randomUtxo } from '@test-utils/random.js';
import { generateWallet } from '@test-utils/wallet.js';

import { deriveSystemContracts } from '../contracts.js';
import { getFundChunks, getFundCommitment, normalizeFund } from '../index.js';
import { randomSystem } from './support/bootstrap.js';

const DustAmount = 2000n;

describe('audit: a vault proof starting at a later chunk (P2-1)', () => {
    const provider = new MockNetworkProvider({ updateUtxoSet: true });
    const system = randomSystem();
    const vault = deriveSystemContracts(provider, system).publicFundVaultContract;

    // Y: the fund an attacker wants proven listed, e.g. a private fund with pre-minted supply
    const y = normalizeFund({ category: randomCategory(), amount: 1n, satoshis: 1000n, assets: Array.from({ length: 4 }, () => ({ category: randomCategory(), amount: 1n })) });

    /** Places `chunks` at the vault as one series (one transaction) and returns their UTXOs. */
    const series = (chunks: string[]) => {
        const txid = randomCategory();
        return chunks.map((commitment, vout) => provider.addUtxo(vault.tokenAddress, randomUtxo({
            txid, vout, satoshis: DustAmount,
            token: { category: system.publicFund, amount: 0n, nft: { capability: 'none', commitment } },
        })));
    };

    /** proof() from `chunks[0]`, with the chunks after it as data(). */
    const prove = (chunks: ReturnType<typeof series>) => {
        const user = generateWallet();
        const funding = provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 100_000n }));
        return new TransactionBuilder({ provider })
            .addInput(chunks[0]!, vault.unlock.proof(new Uint8Array()))
            .addInputs(chunks.slice(1), vault.unlock.data())
            .addInput(funding, user.signatureTemplate.unlockP2PKH())
            .addOutputs(chunks.map(u => ({ to: vault.tokenAddress, amount: u.satoshis, token: u.token! })))
            .addOutput({ to: user.tokenAddress, amount: 90_000n });
    };

    it('proves Y from the first chunk of its own listing (control)', async () => {
        await expect(prove(series(getFundChunks(y)))).toBeAccepted();
    });

    it('refuses a later chunk without the continuation byte, though the joined data still hashes', async () => {
        // proof() drops each later chunk's first byte unchecked; data() checks it is 0x03
        const [first, ...later] = getFundChunks(y);
        await expect(prove(series([first!, ...later.map(chunk => `05${chunk.slice(2)}`)]))).toBeRejected(/nftCommitment\.split\(1\)\[0\] == 0x03/);
    });

    it('refuses to prove Y from a later chunk of another listing that carries it', async () => {
        // Another listing whose data, from its second chunk on, is Y's commitment: before the fix the
        // later chunks carried it as is, and proof() from the second chunk read exactly Y
        const commitment = getFundCommitment(y);
        const carried = [`02${'ab'.repeat(127)}`];
        for (let offset = 0; offset < commitment.length; offset += 127 * 2) {
            carried.push(`03${commitment.slice(offset, offset + 127 * 2)}`);
        }
        const [, ...fromSecond] = series(carried);
        await expect(prove(fromSecond)).toBeRejected(/type == 0x02/);
    });
});
