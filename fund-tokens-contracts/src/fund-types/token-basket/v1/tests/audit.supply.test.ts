/**
 * Audit finding (Phase 1): during a broadcast, the public fund contract skips the startup
 * return (output 1) when checking that no other output carries the new fund's category. Unless
 * the startup contract constrains that output, the genesis input can leave a minting NFT of the
 * fund category on the startup contract.
 *
 * The audit concluded the fixed fund-token supply still holds: a minting NFT mints only NFTs,
 * and new fungible supply needs a consumed genesis (vout 0) outpoint.
 */
import { swapEndianness } from '@bitauth/libauth';
import { randomUtxo, TransactionBuilder, type Utxo } from 'cashscript';

import { generateWallet } from '@test-utils/wallet.js';

import { withDust } from '../../../../core/outputs.js';
import { FundTokenTransactionBuilder, PublicFundTransactionBuilder, getFundBin, hashFund, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, createFund } from './support/bootstrap.js';

const DustAmount = 1000n;

const sameFund = { amount: 1n, satoshis: 5000n, assets: [] };
const mintingNft = (category: string) => ({ category, amount: 0n, nft: { capability: 'minting' as const, commitment: '' } });
const isMinterOf = (fund: Fund) => (u: Utxo) => u.token?.category === fund.category && u.token.nft?.capability === 'minting';

/** A broadcast whose startup return (output 1) also carries a minting NFT of the new fund's category. */
async function buildSmuggledBroadcast({ provider, system }: Awaited<ReturnType<typeof bootstrapInstance>>) {
    const creator = generateWallet();
    const genesis = randomUtxo({ vout: 0, satoshis: DustAmount });
    const funding = randomUtxo({ satoshis: 100_000n });
    [genesis, funding].forEach(u => provider.addUtxo(creator.tokenAddress, u));
    const fund = normalizeFund({ ...sameFund, category: genesis.txid });

    const tx = new PublicFundTransactionBuilder({ provider, system });
    const { startupContract } = tx.getContracts();
    tx.addInput(genesis, creator.signatureTemplate.unlockP2PKH());
    await tx.addBroadcast({ fund });
    tx
        .addInput(funding, creator.signatureTemplate.unlockP2PKH())
        .addOutput({ to: creator.tokenAddress, amount: DustAmount });

    expect(tx.outputs[1]!.to).toBe(startupContract.tokenAddress);
    tx.outputs[1] = { ...tx.outputs[1]!, amount: 10_000n, token: mintingNft(fund.category) };
    return { tx, fund, startupContract };
}

describe('audit: fund-category minting NFT smuggled through a broadcast', () => {
    it('rejects a broadcast that leaves a fund-category minting NFT on the startup return', async () => {
        const { tx, fund, startupContract } = await buildSmuggledBroadcast(await bootstrapInstance());

        await expect(tx).toBeRejected();
        expect((await startupContract.getUtxos()).filter(isMinterOf(fund))).toHaveLength(0);
    });

    it('keeps the startup thread usable after a smuggling attempt', async () => {
        const instance = await bootstrapInstance();
        const { tx } = await buildSmuggledBroadcast(instance);
        await tx.send().catch(() => undefined);

        await expect(createFund(instance, sameFund)).toBeAccepted();
    });

    it('does not let start() move tokens out of the startup contract', async () => {
        const instance = await bootstrapInstance();
        const { provider, system } = instance;
        const fund = await createFund(instance, sameFund).then(normalizeFund);
        const { startupContract, mintInflowContract, mintOutflowContract, createFundFeeContract, feeVaultContract } =
            new PublicFundTransactionBuilder({ provider, system }).getContracts();
        const { managerContract } = new FundTokenTransactionBuilder({ provider, system, fund }).getContracts();

        // Anyone can send tokens to the startup contract's address.
        const parked = randomUtxo({ satoshis: 10_000n, token: mintingNft(fund.category) });
        provider.addUtxo(startupContract.tokenAddress, parked);

        const attacker = generateWallet();
        const mintInflowUtxo = (await mintInflowContract.getUtxos()).find(u => u.token?.category === system.inflow)!;
        const mintOutflowUtxo = (await mintOutflowContract.getUtxos()).find(u => u.token?.category === system.outflow)!;
        const feeUtxo = (await createFundFeeContract.getUtxos()).find(u => !u.token)!;
        const funding = randomUtxo({ satoshis: 1_000_000n });
        provider.addUtxo(attacker.tokenAddress, funding);
        const commitment = '02' + swapEndianness(fund.category) + hashFund(fund);

        const move = new TransactionBuilder({ provider })
            .addInput(parked, startupContract.unlock.start(getFundBin(fund)))
            .addInput(mintInflowUtxo, mintInflowContract.unlock.mint())
            .addInput(mintOutflowUtxo, mintOutflowContract.unlock.mint())
            .addInput(feeUtxo, createFundFeeContract.unlock.pay())
            .addInput(funding, attacker.signatureTemplate.unlockP2PKH())
            .addOutputs([
                withDust({ to: startupContract.tokenAddress }),
                withDust({ to: mintInflowContract.tokenAddress, token: mintInflowUtxo.token }),
                withDust({ to: mintOutflowContract.tokenAddress, token: mintOutflowUtxo.token }),
                withDust({ to: createFundFeeContract.tokenAddress }),
                { to: feeVaultContract.tokenAddress, amount: system.fees.create.value },
                withDust({ to: managerContract.tokenAddress, token: { category: system.inflow, amount: 0n, nft: { capability: 'none', commitment } } }),
                withDust({ to: managerContract.tokenAddress, token: { category: system.outflow, amount: 0n, nft: { capability: 'none', commitment } } }),
                withDust({ to: attacker.tokenAddress, token: parked.token }),
            ]);
        expect(move).toFailRequireWith(/FundStartup\.cash:\d+ Require statement failed at input 0/);
    });

    it('a fund-category minting NFT cannot mint new fungible supply', async () => {
        const instance = await bootstrapInstance();
        const { provider } = instance;
        const fund = await createFund(instance, sameFund).then(normalizeFund);

        // However one is obtained, minting NFTs mint NFTs only; fungible supply must fail consensus.
        const attacker = generateWallet();
        const minter = randomUtxo({ satoshis: DustAmount, token: mintingNft(fund.category) });
        const gas = randomUtxo({ satoshis: 50_000n });
        [minter, gas].forEach(u => provider.addUtxo(attacker.tokenAddress, u));

        const mint = new TransactionBuilder({ provider })
            .addInput(minter, attacker.signatureTemplate.unlockP2PKH())
            .addInput(gas, attacker.signatureTemplate.unlockP2PKH())
            .addOutputs([
                withDust({ to: attacker.tokenAddress, token: minter.token }),
                { to: attacker.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: 123_456_789n } },
            ]);

        await expect(mint).toBeRejected(/fungible tokens in the transaction outputs exceed that of the transaction inputs/);
    });
});
