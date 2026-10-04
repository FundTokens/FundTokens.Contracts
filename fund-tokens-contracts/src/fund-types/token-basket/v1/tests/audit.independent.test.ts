/**
 * Independent audit findings (v0.1.0-rc2):
 *
 *  F1: AssetManager.release() accepts a forged "previous AssetManager" input, releasing custody
 *      with no outflow thread in the transaction.
 *  F2: TransactionManager.inflow() counts foreign tokens paid to the FundManager address as fund
 *      tokens, so a one-unit deposit can take the whole unminted supply, which then redeems
 *      honest holders' backing.
 *  F3: the satoshi custody output of an inflow accepts a token, and release() only spends
 *      tokenless satoshi UTXOs, so the deposit is locked in custody for good.
 *
 * The contracts must reject each of these transactions.
 */
import { randomUtxo, Network, MockNetworkProvider, randomToken, Contract, TransactionBuilder } from 'cashscript';
import { swapEndianness, binToHex, hash256, hexToBin } from '@bitauth/libauth';

import { randomCategory } from '@test-utils/random.js';
import { generateWallet } from '@test-utils/wallet.js';

import { BitcoinCategory, MaxTokenAmount } from '../../../../core/constants.js';
import { withDust } from '../../../../core/outputs.js';
import { FundTokenTransactionBuilder, getFundBin, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';
import { verifyTransaction } from '@test-utils/consensus.js';

import assetJson from '../artifacts/asset.js';

const DustAmount = 1000n;

describe('audit: AssetManager.release() decoy prev-input bypass (F1)', () => {
    const network = Network.MOCKNET;
    const provider = new MockNetworkProvider({ updateUtxoSet: true });
    const attacker = generateWallet(network);

    const outflowSwapped = swapEndianness(randomCategory());
    const fundHash = 'ee'.repeat(32);

    const assetCatDisplay = randomCategory();
    const assetCatSwapped = swapEndianness(assetCatDisplay);

    // AssetManager is bound to a TransactionManager (any P2SH32 here) and links to nothing, like a fund's first reserve.
    const transactionManager = 'aa20' + randomCategory() + '87';
    const tokenVault = new Contract(assetJson, [outflowSwapped, fundHash, assetCatSwapped, transactionManager, ''], { provider });
    const btcVault = new Contract(assetJson, [outflowSwapped, fundHash, BitcoinCategory, transactionManager, ''], { provider });

    // Build the decoy redeemScript that forges the "previous AssetManager" parse:
    //   release() computes: prev.unlockingBytecode.split(4)[1].split(32) -> [prevCategory, prevRest]
    //   and this.unlockingBytecode.slice(36, len-1) == prevRest
    // this.unlockingBytecode (250 bytes) = [4c f8][20 assetCat][20 fundHash][20 outflow][bytecode(149)]
    //   -> slice(36, 249) = fundHash + 20 + outflow + bytecode[0..147]  (213 bytes)
    // decoy unlocking (249 bytes) = [4c f7][rs(247)] ; rs = [4c f5][prevCategory(32)][tail(213)]
    //   -> split(4)[1] = rs[2..] = prevCategory + tail ; split(32) -> prevRest = tail (MATCH)
    //   -> rs executes as: PUSHDATA1(245) <blob> -> truthy stack -> valid P2SH spend
    const redeemScriptHex = tokenVault.bytecode; // 248 bytes: args + bytecode (same bytecode for all instances)
    const artifactBytecodeHex = redeemScriptHex.slice(99 * 2); // strip 3x33-byte arg pushes
    const tail = fundHash + '20' + outflowSwapped + artifactBytecodeHex.slice(0, 148 * 2);
    const rs = '4cf5' + '00'.repeat(32) + tail; // 247 bytes
    const decoyLocking = 'aa20' + binToHex(hash256(hexToBin(rs))) + '87'; // P2SH32
    const decoyUnlocking = '4cf7' + rs; // 249 bytes

    const decoyUnlocker = {
        generateUnlockingBytecode: () => hexToBin(decoyUnlocking),
        generateLockingBytecode: () => hexToBin(decoyLocking),
    };
    const addDecoy = () => {
        const u = provider.addUtxo(decoyLocking, randomUtxo({ satoshis: DustAmount }));
        return u;
    };

    it('control: release() fails without outflow token (plain prev input)', async ({ expect }) => {
        const vaultUtxo = provider.addUtxo(tokenVault.tokenAddress, randomUtxo({ satoshis: 5000n, token: randomToken({ category: assetCatDisplay, amount: 12345n }) }));
        const sats = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 10000n }));

        const tx = new TransactionBuilder({ provider });
        tx.addInput(sats, attacker.signatureTemplate.unlockP2PKH())
            .addInput(vaultUtxo, tokenVault.unlock.release())
            .addOutput({ to: attacker.tokenAddress, amount: 5000n, token: { category: assetCatDisplay, amount: 12345n } });
        const p2pkhLocking = '76a914' + attacker.pubKeyHashHex + '88ac';
        expect(verifyTransaction(tx, [p2pkhLocking, tokenVault.lockingBytecode])).not.to.equal(true);
    });

    it('prevent vault draining decoy prev input (no outflow token anywhere)', async ({ expect }) => {
        const vaultUtxo = provider.addUtxo(tokenVault.tokenAddress, randomUtxo({ satoshis: 5000n, token: randomToken({ category: assetCatDisplay, amount: 54321n }) }));
        const decoyUtxo = addDecoy();

        const tx = new TransactionBuilder({ provider });
        tx.addInput(decoyUtxo, decoyUnlocker)
            .addInput(vaultUtxo, tokenVault.unlock.release())
            .addOutput({ to: attacker.tokenAddress, amount: 5000n, token: { category: assetCatDisplay, amount: 54321n } });
        expect(verifyTransaction(tx, [decoyLocking, tokenVault.lockingBytecode])).not.to.equal(true);
    });

    it('prevent Bitcoin (satoshi) vault draining', async ({ expect }) => {
        const vaultUtxo = provider.addUtxo(btcVault.tokenAddress, randomUtxo({ satoshis: 777777n }));
        const decoyUtxo = addDecoy();

        const tx = new TransactionBuilder({ provider });
        tx.addInput(decoyUtxo, decoyUnlocker)
            .addInput(vaultUtxo, btcVault.unlock.release())
            .addOutput({ to: attacker.tokenAddress, amount: 776777n });
        expect(verifyTransaction(tx, [decoyLocking, btcVault.lockingBytecode])).not.to.equal(true);
    });
});

describe('audit: TransactionManager.inflow() accounting (F2, F3)', () => {
    let instance: TestInstance;
    let fund: Fund;

    // A fresh instance per test: while F2 is open it empties the unminted supply.
    beforeEach(async () => {
        instance = await bootstrapInstance();
        const { provider, system } = instance;
        fund = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 5000n, assets: [] }));

        // An honest holder deposits 10 units (50,000 sats of backing).
        const holder = generateWallet();
        const funding = provider.addUtxo(holder.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));
        const inflow = new FundTokenTransactionBuilder({ provider, system, fund });
        await inflow.addInflow({ units: 10n });
        await inflow
            .addInput(funding, holder.signatureTemplate.unlockP2PKH())
            .addOutput({ to: holder.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: 10n * fund.amount } })
            .send();
    });

    /** An inflow of the fund's contract side, with the attacker's inputs and the given outputs after the fee payment. */
    async function buildInflow(attackerToken: { category: string; amount: bigint }, outputs: (contracts: ReturnType<FundTokenTransactionBuilder['getContracts']>, supplyIn: bigint, attacker: string) => Parameters<FundTokenTransactionBuilder['addOutputs']>[0]) {
        const { provider, system } = instance;
        const attacker = generateWallet();
        const tx = new FundTokenTransactionBuilder({ provider, system, fund });
        const contracts = tx.getContracts();
        const { managerContract, fundContract, feeContract, feeVaultContract } = contracts;
        const inflowThread = (await managerContract.getUtxos()).find(u => u.token?.category === system.inflow)!;
        const supply = (await fundContract.getUtxos()).find(u => u.token?.category === fund.category)!;
        const feeUtxo = (await feeContract.getUtxos()).find(u => !u.token)!;
        const funding = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 400_000n }));
        const tokenUtxo = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: DustAmount, token: attackerToken }));

        tx
            .addInput(inflowThread, managerContract.unlock.inflow(getFundBin(fund), new Uint8Array()))
            .addInput(feeUtxo, feeContract.unlock.pay())
            .addInput(supply, fundContract.unlock.mint())
            .addInputs([funding, tokenUtxo], attacker.signatureTemplate.unlockP2PKH())
            .addOutputs([
                withDust({ to: managerContract.tokenAddress, token: inflowThread.token }),
                withDust({ to: feeContract.tokenAddress }),
                { to: feeVaultContract.tokenAddress, amount: system.fees.execute.value },
                ...outputs(contracts, supply.token!.amount, attacker.tokenAddress),
            ]);
        return { tx, contracts, attacker };
    }

    it('rejects a one-unit inflow that takes the whole supply by parking a foreign token at the fund contract (F2)', async () => {
        const foreign = randomCategory();
        const { tx, attacker } = await buildInflow({ category: foreign, amount: MaxTokenAmount }, ({ fundContract, satoshiAssetContract }, supplyIn, to) => {
            const foreignParked = supplyIn - fund.amount; // makes the manager see exactly one unit released
            return [
                withDust({ to: fundContract.tokenAddress }),
                withDust({ to: fundContract.tokenAddress, token: { category: foreign, amount: foreignParked } }),
                { to: satoshiAssetContract!.tokenAddress, amount: fund.satoshis },                     // one unit deposited
                withDust({ to, token: { category: fund.category, amount: supplyIn } }),                // the whole supply
                withDust({ to, token: { category: foreign, amount: MaxTokenAmount - foreignParked } }),
            ];
        });

        await expect(tx).toBeRejected();
        expect((await instance.provider.getUtxos(attacker.tokenAddress)).filter(u => u.token?.category === fund.category)).toHaveLength(0);
    });

    it('rejects an inflow whose satoshi custody output carries a token (F3)', async () => {
        const taint = randomCategory();
        const { tx, contracts } = await buildInflow({ category: taint, amount: 1n }, ({ fundContract, satoshiAssetContract }, supplyIn, to) => [
            withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: supplyIn - fund.amount } }),
            { to: satoshiAssetContract!.tokenAddress, amount: fund.satoshis, token: { category: taint, amount: 1n } },
            withDust({ to, token: { category: fund.category, amount: fund.amount } }),
        ]);

        await expect(tx).toBeRejected();
        expect((await contracts.satoshiAssetContract!.getUtxos()).filter(u => u.token)).toHaveLength(0);
    });
});
