/**
 * Audit PoCs (v0.1.0-rc2):
 *
 *  1. TransactionManager.inflow() counts the token amount of every output at the FundManager
 *     address without checking its category, so a foreign token can stand in for fund tokens
 *     and more fund tokens leave than the deposit backs.
 *  1b. TransactionManager.inflow() does not require a positive release, so an inflow can release
 *     and deposit nothing: its asset outputs only need to carry each asset's category, which an
 *     immutable NFT of that category (amount 0) does. The recreated outputs are not value-pinned.
 *  2. FundStartup.start() does not constrain the token on its own return output, and
 *     PublicFund.broadcast()'s anti-minting scan skips it, so a broadcast can leave a freshly
 *     minted publicFund minting NFT on the startup contract.
 *  3. A later start() can move such an NFT out of the startup contract, e.g. to the publicFund vault.
 *
 * The contracts must reject each of these transactions.
 */
import { swapEndianness } from '@bitauth/libauth';
import { TransactionBuilder, randomUtxo } from 'cashscript';

import { randomCategory } from '@test-utils/random.js';
import { generateWallet } from '@test-utils/wallet.js';

import { withDust } from '../../../../core/outputs.js';
import {
    FundTokenTransactionBuilder,
    PublicFundTransactionBuilder,
    getFundBin,
    hashFund,
    normalizeFund,
    type Fund,
} from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;

const assets = [
    { category: '12'.repeat(32), amount: 4n },
    { category: '88'.repeat(32), amount: 2n },
    { category: '99'.repeat(32), amount: 3n },
];

describe('audit PoCs (v0.1.0-rc2)', () => {
    let instance: TestInstance;
    let fund: Fund;

    beforeAll(async () => {
        instance = await bootstrapInstance();
        fund = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 1000n, assets }));
    });

    it('rejects an inflow that parks a foreign token at the fund contract to mint unbacked fund tokens (PoC 1)', async () => {
        const { provider, system } = instance;
        const attacker = generateWallet();
        const tx = new FundTokenTransactionBuilder({ provider, system, fund });
        const { managerContract, fundContract, satoshiAssetContract, assetContracts, feeContract, feeVaultContract } = tx.getContracts();

        const inflowUtxo = (await managerContract.getUtxos()).find(u => u.token?.category === system.inflow)!;
        const fundUtxo = (await fundContract.getUtxos()).find(u => u.token?.category === fund.category)!;
        const feeUtxo = (await feeContract.getUtxos()).find(u => !u.token)!;

        const foreign = randomCategory();
        const foreignUtxo = provider.addUtxo(attacker.tokenAddress, randomUtxo({ token: { category: foreign, amount: 90n } }));
        const funding = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));
        const assetUtxos = fund.assets.map(a => provider.addUtxo(attacker.tokenAddress, randomUtxo({ token: { category: a.category, amount: a.amount } })));

        // The manager computes (supply in - supply out) = 100 - 90 = 10 tokens, one unit of deposits,
        // but 100 real fund tokens leave the fund contract.
        tx
            .addInput(inflowUtxo, managerContract.unlock.inflow(getFundBin(fund), new Uint8Array()))
            .addInput(feeUtxo, feeContract.unlock.pay())
            .addInput(fundUtxo, fundContract.unlock.mint())
            .addInputs([funding, foreignUtxo, ...assetUtxos], attacker.signatureTemplate.unlockP2PKH())
            .addOutputs([
                withDust({ to: managerContract.tokenAddress, token: inflowUtxo.token }),
                withDust({ to: feeContract.tokenAddress }),
                { to: feeVaultContract.tokenAddress, amount: system.fees.execute.value },
                withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: fundUtxo.token!.amount - 100n } }),
                withDust({ to: fundContract.tokenAddress, token: { category: foreign, amount: 90n } }),
                { to: satoshiAssetContract!.tokenAddress, amount: fund.satoshis },
                ...fund.assets.map((a, i) => withDust({ to: assetContracts[i]!.tokenAddress, token: { category: a.category, amount: a.amount } })),
                { to: attacker.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: 100n } },
                { to: attacker.tokenAddress, amount: 800_000n },
            ]);

        await expect(tx).toBeRejected();
        expect((await provider.getUtxos(attacker.tokenAddress)).filter(u => u.token?.category === fund.category)).toHaveLength(0);
    });

    it('rejects a zero-release inflow on a fund with no BCH backing (PoC 1b)', async () => {
        const { provider, system } = instance;
        const noSats = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 0n, assets: assets.slice(0, 2) }));
        const attacker = generateWallet();
        const tx = new FundTokenTransactionBuilder({ provider, system, fund: noSats });
        const { managerContract, fundContract, assetContracts, feeContract, feeVaultContract } = tx.getContracts();

        const inflowUtxo = (await managerContract.getUtxos()).find(u => u.token?.category === system.inflow)!;
        const fundUtxo = (await fundContract.getUtxos()).find(u => u.token?.category === noSats.category)!;
        const feeUtxo = (await feeContract.getUtxos()).find(u => !u.token)!;
        const funding = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));
        // Each asset output must carry the asset's category. With nothing released, the only valid
        // encoding is an immutable NFT of that category (amount 0), which many token categories have.
        const assetNft = (category: string) => ({ category, amount: 0n, nft: { capability: 'none' as const, commitment: '' } });
        const nfts = noSats.assets.map(a => provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: DustAmount, token: assetNft(a.category) })));

        tx
            .addInput(inflowUtxo, managerContract.unlock.inflow(getFundBin(noSats), new Uint8Array()))
            .addInput(feeUtxo, feeContract.unlock.pay())
            .addInput(fundUtxo, fundContract.unlock.mint())
            .addInputs([funding, ...nfts], attacker.signatureTemplate.unlockP2PKH())
            .addOutputs([
                withDust({ to: managerContract.tokenAddress, token: inflowUtxo.token }),
                withDust({ to: feeContract.tokenAddress }),
                { to: feeVaultContract.tokenAddress, amount: system.fees.execute.value },
                withDust({ to: fundContract.tokenAddress, token: { category: noSats.category, amount: fundUtxo.token!.amount } }),
                ...noSats.assets.map((a, i) => withDust({ to: assetContracts[i]!.tokenAddress, token: assetNft(a.category) })),
                { to: attacker.tokenAddress, amount: 800_000n },
            ]);

        await expect(tx).toBeRejected();
    });

    it('rejects a broadcast that leaves a publicFund minting NFT on the startup return (PoC 2)', async () => {
        const { provider, system } = instance;
        const creator = generateWallet();
        const genesis = provider.addUtxo(creator.tokenAddress, randomUtxo({ vout: 0, satoshis: DustAmount }));
        const funding = provider.addUtxo(creator.tokenAddress, randomUtxo({ satoshis: 100_000n }));
        const newFund = normalizeFund({ category: genesis.txid, amount: 1n, satoshis: 1_000_000n, assets: [] });

        const tx = new PublicFundTransactionBuilder({ provider, system });
        const { startupContract } = tx.getContracts();
        tx.addInput(genesis, creator.signatureTemplate.unlockP2PKH());
        await tx.addBroadcast({ fund: newFund });
        tx
            .addInput(funding, creator.signatureTemplate.unlockP2PKH())
            .addOutput({ to: creator.tokenAddress, amount: DustAmount });

        expect(tx.outputs[1]!.to).toBe(startupContract.tokenAddress);
        tx.outputs[1] = {
            ...tx.outputs[1]!,
            amount: 10_000n,
            token: { category: system.publicFund, amount: 0n, nft: { capability: 'minting', commitment: '02' + hashFund(newFund) } },
        };

        await expect(tx).toBeRejected();
        expect((await startupContract.getUtxos()).filter(u => u.token?.category === system.publicFund)).toHaveLength(0);
    });

    it('rejects a start() that moves a publicFund NFT out of the startup contract (PoC 3)', async () => {
        const { provider, system } = instance;
        const user = generateWallet();
        const { startupContract, mintInflowContract, mintOutflowContract, createFundFeeContract, publicFundVaultContract, feeVaultContract } =
            new PublicFundTransactionBuilder({ provider, system }).getContracts();

        // However it got there (PoC 2, or anyone paying to the startup address), a publicFund NFT sits at startup.
        const parked = provider.addUtxo(startupContract.tokenAddress, randomUtxo({ satoshis: 10_000n, token: { category: system.publicFund, amount: 0n, nft: { capability: 'minting', commitment: '02' } } }));

        const mintInflowUtxo = (await mintInflowContract.getUtxos()).find(u => u.token?.category === system.inflow)!;
        const mintOutflowUtxo = (await mintOutflowContract.getUtxos()).find(u => u.token?.category === system.outflow)!;
        const feeUtxo = (await createFundFeeContract.getUtxos()).find(u => !u.token)!;
        const funding = provider.addUtxo(user.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));

        const newFund = normalizeFund({ category: randomCategory(), amount: 1n, satoshis: 5000n, assets: [] });
        const commitment = '02' + swapEndianness(newFund.category) + hashFund(newFund);
        const { managerContract } = new FundTokenTransactionBuilder({ provider, system, fund: newFund }).getContracts();

        const tx = new TransactionBuilder({ provider })
            .addInput(parked, startupContract.unlock.start(getFundBin(newFund)))
            .addInput(mintInflowUtxo, mintInflowContract.unlock.mint())
            .addInput(mintOutflowUtxo, mintOutflowContract.unlock.mint())
            .addInput(feeUtxo, createFundFeeContract.unlock.pay())
            .addInput(funding, user.signatureTemplate.unlockP2PKH())
            .addOutputs([
                withDust({ to: startupContract.tokenAddress }),
                withDust({ to: mintInflowContract.tokenAddress, token: mintInflowUtxo.token }),
                withDust({ to: mintOutflowContract.tokenAddress, token: mintOutflowUtxo.token }),
                withDust({ to: createFundFeeContract.tokenAddress }),
                { to: feeVaultContract.tokenAddress, amount: system.fees.create.value },
                withDust({ to: managerContract.tokenAddress, token: { category: system.inflow, amount: 0n, nft: { capability: 'none', commitment } } }),
                withDust({ to: managerContract.tokenAddress, token: { category: system.outflow, amount: 0n, nft: { capability: 'none', commitment } } }),
                withDust({ to: publicFundVaultContract.tokenAddress, token: parked.token }),
            ]);

        await expect(tx).toBeRejected();
        expect(await startupContract.getUtxos()).toContainEqual(parked);
    });
});
