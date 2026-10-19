/**
 * Audit finding P2-2: a mint (or redemption) may return the fund's supply as any number of
 * FundManager outputs, so one cheap mint can split it into ~1,000 one-token UTXOs. addInflow()
 * took supply UTXOs in random order without a size check, so most later mints spent many
 * fragments and exceeded the standard transaction size.
 *
 * The builder now spends a single covering UTXO when one exists, largest first otherwise, and
 * refuses a mint too large to relay, naming the most units that fit.
 */
import { MockNetworkProvider } from 'cashscript';
import { generateWallet } from '@test-utils/wallet.js';
import { randomCategory, randomUtxo } from '@test-utils/random.js';

import { withDust } from '../../../../core/outputs.js';
import { deriveFundContracts, deriveSystemContracts } from '../contracts.js';
import { getThreadCommitment } from '../encoding.js';
import { normalizeFund } from '../fund.js';
import { FundTokenTransactionBuilder } from '../FundTokenTransactionBuilder.js';
import type { FundInput } from '../types.js';
import { bootstrapInstance, createFund, randomSystem, type TestInstance } from './support/bootstrap.js';

const Fragments = 100;

describe('audit: minting from fragmented fund supply (P2-2)', () => {
    let instance: TestInstance;
    let fund: FundInput;

    beforeAll(async () => {
        instance = await bootstrapInstance();
        fund = await createFund(instance, { amount: 1000n, satoshis: 1000n, assets: [] });
    });

    const builder = () => new FundTokenTransactionBuilder({ provider: instance.provider, system: instance.system, fund });

    /** Mints `units` through the builder for a new user, returning the transaction unsent. */
    async function mint(units: bigint) {
        const user = generateWallet();
        const tx = await builder().addInflow({ units });
        return tx
            .addInput(instance.provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 2_000_000n })), user.signatureTemplate.unlockP2PKH())
            .addOutput({ to: user.tokenAddress, amount: 1000n, token: { category: fund.category, amount: units * 1000n } });
    }

    it('lets a mint return the supply as many one-token UTXOs', async () => {
        const tx = await mint(1n);
        const { fundContract } = builder().contracts;
        // Output 3 is the supply change (after the thread, fee return and fee payment)
        const change = tx.outputs[3]!.token!.amount;
        tx.outputs.splice(3, 1,
            withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: change - BigInt(Fragments) } }),
            ...Array.from({ length: Fragments }, () => withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: 1n } })));
        await expect(tx).toBeAccepted();

        const supply = (await fundContract.getUtxos()).filter(u => u.token?.category === fund.category);
        expect(supply.length).toBeGreaterThan(Fragments);
    });

    it('then mints from the one UTXO that covers it, not from the fragments', async () => {
        const tx = await mint(5n);
        const supplyInputs = tx.inputs.filter(u => u.token?.category === fund.category);
        expect(supplyInputs).toHaveLength(1);
        expect(supplyInputs[0]!.token!.amount).toBeGreaterThan(5000n);
        await expect(tx).toBeAccepted();
    });

    describe('with no UTXO covering the mint', () => {
        // A supply made only of one-unit fragments, on its own network (threads and fees as mock UTXOs)
        const provider = new MockNetworkProvider();
        const system = randomSystem();
        const fragmented = normalizeFund({ category: randomCategory(), amount: 1000n, satoshis: 1000n, assets: [] });
        const { managerContract, fundContract } = deriveFundContracts(provider, system, fragmented);
        provider.addUtxo(managerContract.tokenAddress, randomUtxo({
            token: { category: system.inflow, amount: 0n, nft: { capability: 'none', commitment: getThreadCommitment(fragmented) } },
        }));
        provider.addUtxo(deriveSystemContracts(provider, system).executeFundFeeContract.tokenAddress, randomUtxo());
        for (let i = 0; i < 1500; i++) {
            provider.addUtxo(fundContract.tokenAddress, randomUtxo({ token: { category: fragmented.category, amount: 1000n } }));
        }
        const fragmentedBuilder = () => new FundTokenTransactionBuilder({ provider, system, fund: fragmented });

        it('refuses a mint too large to relay, naming the most units that fit', async () => {
            const refusal = await fragmentedBuilder().addInflow({ units: 1500n }).catch((error: unknown) => error);
            expect(refusal).toMatchObject({ code: 'TRANSACTION_TOO_LARGE', message: expect.stringMatching(/mint at most \d+ unit\(s\) per transaction/) });

            const most = BigInt(/mint at most (\d+)/.exec((refusal as Error).message)![1]!);
            expect(most).toBeGreaterThan(100n);
            const fits = await fragmentedBuilder().addInflow({ units: most });
            expect(fits.inputs.filter(u => u.token?.category === fragmented.category)).toHaveLength(Number(most));
            await expect(fragmentedBuilder().addInflow({ units: most + 1n })).rejects.toMatchObject({ code: 'TRANSACTION_TOO_LARGE' });
        });

        it('mints a few units from fragments, largest first (control)', async () => {
            const tx = await fragmentedBuilder().addInflow({ units: 3n });
            expect(tx.inputs.filter(u => u.token?.category === fragmented.category)).toHaveLength(3);
        });
    });
});
