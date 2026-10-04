/**
 * Fungible tokens on NFTs: a contract that carries an NFT forward keeps its token amount, and the
 * NFTs it mints carry none. (A minting NFT in the transaction lets it mint fungible tokens of its
 * category anywhere, including onto the NFTs it creates or returns.)
 */
import { TransactionBuilder, type Output } from 'cashscript';

import { generateWallet } from '@test-utils/wallet.js';
import { randomCategory, randomUtxo } from '@test-utils/random.js';

import { withDust } from '../../../../core/outputs.js';
import { FundTokenTransactionBuilder, PublicFundTransactionBuilder, getFundCommitment, normalizeFund } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';
import { buildManualBroadcast } from './support/broadcast.js';

const DustAmount = 1000n;

/** `output` with `amount` fungible tokens of its NFT's category added, at the dust minimum again. */
const withTokens = (output: Output, amount: bigint): Output =>
    withDust({ to: output.to as string, token: { ...output.token!, amount } });

describe('fungible tokens on NFTs', () => {
    let instance: TestInstance;

    beforeAll(async () => {
        instance = await bootstrapInstance();
    });

    describe('fund creation', () => {
        /** A fund creation paying the default create fee; outputs (s = 1): 2 inflow and 3 outflow minting NFTs, 6 inflow and 7 outflow threads, 9 PublicFund minting NFT, 10 first fund data chunk. */
        async function creation() {
            const { provider, system } = instance;
            const { createFundFeeContract, feeVaultContract } = new PublicFundTransactionBuilder({ provider, system }).getContracts();
            const feeUtxo = (await createFundFeeContract.getUtxos()).find(u => !u.token)!;
            const { tx, creator } = await buildManualBroadcast(instance, {
                fee: { utxo: feeUtxo, unlocker: createFundFeeContract.unlock.pay() },
                feeOutputs: [withDust({ to: createFundFeeContract.tokenAddress }), { to: feeVaultContract.tokenAddress, amount: system.fees.create.value }],
            });
            tx.addOutput({ to: creator.tokenAddress, amount: 500_000n });
            return tx;
        }

        it('accepts NFTs minted and returned without fungible tokens (control)', async () => {
            await expect(await creation()).toBeAccepted();
        });

        it.each([
            ['the minted inflow thread', 6, /tx\.outputs\[inflowOutput\]\.tokenAmount == 0/],
            ['the minted outflow thread', 7, /tx\.outputs\[outflowOutput\]\.tokenAmount == 0/],
            ['a minted fund data chunk', 10, /tx\.outputs\[broadcastOutputEnd\]\.tokenAmount == 0/],
            ['the returned inflow minting NFT', 2, /tokenAmount == tx\.outputs\[this\.activeInputIndex\]\.tokenAmount/],
            ['the returned outflow minting NFT', 3, /tokenAmount == tx\.outputs\[this\.activeInputIndex\]\.tokenAmount/],
            ['the returned PublicFund minting NFT', 9, /tokenAmount == tx\.outputs\[thisOutput\]\.tokenAmount/],
        ])('rejects fungible tokens minted onto %s', async (_, output, reason) => {
            const tx = await creation();
            tx.outputs[output] = withTokens(tx.outputs[output]!, 1000n);
            await expect(tx).toBeRejected(reason);
        });
    });

    describe('TransactionManager thread', () => {
        /** An inflow spending a thread that carries `carried` inflow tokens, returning `returned` of them to it and the rest to `holder`. */
        async function inflow(carried: bigint, returned: bigint) {
            const { provider, system } = instance;
            const fund = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 1000n, assets: [] }));
            const holder = generateWallet();
            const tx = new FundTokenTransactionBuilder({ provider, system, fund });
            const { managerContract } = tx.getContracts();
            const thread = (await managerContract.getUtxos()).find(u => u.token?.category === system.inflow)!;
            const carrying = provider.addUtxo(managerContract.tokenAddress, randomUtxo({ satoshis: thread.satoshis, token: { ...thread.token!, amount: carried } }));
            const funding = provider.addUtxo(holder.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));

            await tx.addInflow({ units: 1n });
            tx.inputs[0] = { ...carrying, unlocker: tx.inputs[0]!.unlocker };
            tx.outputs[0] = withTokens(tx.outputs[0]!, returned);
            tx.addInput(funding, holder.signatureTemplate.unlockP2PKH())
                .addOutput({ to: holder.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: fund.amount } });
            if (returned < carried) {
                tx.addOutput({ to: holder.tokenAddress, amount: DustAmount, token: { category: system.inflow, amount: carried - returned } });
            }
            return tx.addOutput({ to: holder.tokenAddress, amount: 100_000n });
        }

        it('accepts an inflow keeping the thread\'s fungible tokens (control)', async () => {
            await expect(await inflow(5n, 5n)).toBeAccepted();
        });

        it('rejects an inflow taking fungible tokens off the thread', async () => {
            await expect(await inflow(5n, 0n)).toBeRejected(/tokenAmount == tx\.outputs\[this\.activeInputIndex\]\.tokenAmount/);
        });
    });

    describe('PublicFundVault proof()', () => {
        /** A proof() over a fund's data chunks, each carrying `carried` publicFund tokens, returning `returned` on the last. */
        function proof(carried: bigint, returned: bigint) {
            const { provider, system } = instance;
            const { publicFundVaultContract: vault } = new PublicFundTransactionBuilder({ provider, system }).getContracts();
            const fund = normalizeFund({ category: randomCategory(), amount: 1n, satoshis: 1000n, assets: Array.from({ length: 4 }, () => ({ category: randomCategory(), amount: 1n })) });
            const commitment = getFundCommitment(fund);
            const txid = randomCategory();
            const chunks = Array.from({ length: Math.ceil(commitment.length / 256) }, (_, vout) => provider.addUtxo(vault.tokenAddress, randomUtxo({
                txid, vout, satoshis: DustAmount,
                token: { category: system.publicFund, amount: carried, nft: { capability: 'none', commitment: commitment.slice(vout * 256, vout * 256 + 256) } },
            })));
            const user = generateWallet();
            const funding = provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 100_000n }));

            const tx = new TransactionBuilder({ provider })
                .addInput(chunks[0]!, vault.unlock.proof())
                .addInputs(chunks.slice(1), vault.unlock.data())
                .addInput(funding, user.signatureTemplate.unlockP2PKH())
                .addOutputs(chunks.map((u, i) => withDust({ to: vault.tokenAddress, token: { ...u.token!, amount: i === chunks.length - 1 ? returned : carried } })));
            if (returned < carried) {
                tx.addOutput({ to: user.tokenAddress, amount: DustAmount, token: { category: system.publicFund, amount: carried - returned } });
            }
            return tx.addOutput({ to: user.tokenAddress, amount: 90_000n });
        }

        it('accepts a proof keeping each chunk\'s fungible tokens (control)', async () => {
            await expect(proof(3n, 3n)).toBeAccepted();
        });

        it('rejects a proof taking fungible tokens off a chunk', async () => {
            await expect(proof(3n, 0n)).toBeRejected(/tx\.inputs\[fundIndex\]\.tokenAmount == tx\.outputs\[fundIndex\]\.tokenAmount/);
        });
    });
});
