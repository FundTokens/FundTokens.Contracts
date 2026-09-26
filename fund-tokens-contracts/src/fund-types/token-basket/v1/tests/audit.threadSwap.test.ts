/**
 * Audit finding (fresh pass): thread commitments can be swapped between funds with no minting
 * or mutable token anywhere in the transaction.
 *
 * TransactionManager.inflow() / outflow() recreate the thread checking only locking bytecode and
 * category, assuming consensus binds an immutable NFT's commitment to the UTXO that carried it.
 * It does not: CashTokens matches immutable NFTs as a multiset per category across the whole
 * transaction. The inflow and outflow categories are shared by every fund, so two funds' threads
 * can trade commitments in one transaction of two ordinary, fully-paid operations. Each lands back
 * at its own manager carrying the other fund's commitment, and neither can be used again.
 *
 * The contracts must reject these transactions.
 */
import { TransactionBuilder, randomUtxo } from 'cashscript';

import { randomCategory } from '@test-utils/random.js';
import { generateWallet } from '@test-utils/wallet.js';

import { withDust } from '../../../../core/outputs.js';
import { FundTokenTransactionBuilder, getFundBin, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;

describe('audit: thread commitments swapped between funds', () => {
    let instance: TestInstance;
    let fundA: Fund;
    let fundB: Fund;

    const contractsOf = (fund: Fund) => new FundTokenTransactionBuilder({ provider: instance.provider, system: instance.system, fund }).getContracts();

    beforeEach(async () => {
        instance = await bootstrapInstance();
        fundA = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 0n, assets: [{ category: randomCategory(), amount: 4n }] }));
        fundB = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 0n, assets: [{ category: randomCategory(), amount: 4n }] }));
        // The fee contract is shared and anyone can pay to it: a second default-fee UTXO serves the second operation.
        instance.provider.addUtxo(contractsOf(fundA).feeContract.tokenAddress, randomUtxo({ satoshis: DustAmount }));
    });

    it('rejects two one-unit deposits that return each fund\'s inflow thread with the other\'s commitment', async () => {
        const { provider, system } = instance;
        const cA = contractsOf(fundA);
        const cB = contractsOf(fundB);
        const threadA = (await cA.managerContract.getUtxos()).find(u => u.token?.category === system.inflow)!;
        const threadB = (await cB.managerContract.getUtxos()).find(u => u.token?.category === system.inflow)!;
        const supplyA = (await cA.fundContract.getUtxos()).find(u => u.token?.category === fundA.category)!;
        const supplyB = (await cB.fundContract.getUtxos()).find(u => u.token?.category === fundB.category)!;
        const feeUtxos = (await cA.feeContract.getUtxos()).filter(u => !u.token);
        const commitA = threadA.token!.nft!.commitment;
        const commitB = threadB.token!.nft!.commitment;

        const attacker = generateWallet();
        const pads = [randomUtxo({ satoshis: 50_000n }), randomUtxo({ satoshis: 50_000n })];
        const assetA = randomUtxo({ token: { category: fundA.assets[0]!.category, amount: 4n } });
        const assetB = randomUtxo({ token: { category: fundB.assets[0]!.category, amount: 4n } });
        const gas = randomUtxo({ satoshis: 1_000_000n });
        [...pads, assetA, assetB, gas].forEach(u => provider.addUtxo(attacker.tokenAddress, u));

        const tx = new TransactionBuilder({ provider })
            .addInput(threadA, cA.managerContract.unlock.inflow(getFundBin(fundA)))  // 0 deposit into fund A
            .addInput(feeUtxos[0]!, cA.feeContract.unlock.pay())                     // 1
            .addInput(supplyA, cA.fundContract.unlock.mint())                        // 2
            .addInputs(pads, attacker.signatureTemplate.unlockP2PKH())               // 3, 4
            .addInput(threadB, cB.managerContract.unlock.inflow(getFundBin(fundB)))  // 5 deposit into fund B
            .addInput(feeUtxos[1]!, cB.feeContract.unlock.pay())                     // 6
            .addInput(supplyB, cB.fundContract.unlock.mint())                        // 7
            .addInputs([assetA, assetB, gas], attacker.signatureTemplate.unlockP2PKH()) // 8, 9, 10
            .addOutputs([
                withDust({ to: cA.managerContract.tokenAddress, token: { category: system.inflow, amount: 0n, nft: { capability: 'none', commitment: commitB } } }),
                withDust({ to: cA.feeContract.tokenAddress }),
                { to: cA.feeVaultContract.tokenAddress, amount: system.fees.execute.value },
                withDust({ to: cA.fundContract.tokenAddress, token: { category: fundA.category, amount: supplyA.token!.amount - fundA.amount } }),
                withDust({ to: cA.assetContracts[0]!.tokenAddress, token: { category: fundA.assets[0]!.category, amount: 4n } }),
                withDust({ to: cB.managerContract.tokenAddress, token: { category: system.inflow, amount: 0n, nft: { capability: 'none', commitment: commitA } } }),
                withDust({ to: cB.feeContract.tokenAddress }),
                { to: cB.feeVaultContract.tokenAddress, amount: system.fees.execute.value },
                withDust({ to: cB.fundContract.tokenAddress, token: { category: fundB.category, amount: supplyB.token!.amount - fundB.amount } }),
                withDust({ to: cB.assetContracts[0]!.tokenAddress, token: { category: fundB.assets[0]!.category, amount: 4n } }),
                withDust({ to: attacker.tokenAddress, token: { category: fundA.category, amount: fundA.amount } }),
                withDust({ to: attacker.tokenAddress, token: { category: fundB.category, amount: fundB.amount } }),
                { to: attacker.tokenAddress, amount: 700_000n },
            ]);

        // No minting or mutable NFT anywhere in the transaction.
        const capabilities = [...tx.inputs, ...tx.outputs].flatMap(x => (x.token?.nft ? [x.token.nft.capability] : []));
        expect(capabilities.every(c => c === 'none')).toBe(true);

        await expect(tx.send()).rejects.toThrow();
        expect((await cA.managerContract.getUtxos()).find(u => u.token?.category === system.inflow)!.token!.nft!.commitment).toBe(commitA);
        expect((await cB.managerContract.getUtxos()).find(u => u.token?.category === system.inflow)!.token!.nft!.commitment).toBe(commitB);
    });

    it('rejects two zero-unit outflows that swap the funds\' outflow thread commitments', async () => {
        const { provider, system } = instance;
        const cA = contractsOf(fundA);
        const cB = contractsOf(fundB);
        const outA = (await cA.managerContract.getUtxos()).find(u => u.token?.category === system.outflow)!;
        const outB = (await cB.managerContract.getUtxos()).find(u => u.token?.category === system.outflow)!;
        const feeUtxos = (await cA.feeContract.getUtxos()).filter(u => !u.token);
        const commitA = outA.token!.nft!.commitment;
        const commitB = outB.token!.nft!.commitment;

        const attacker = generateWallet();
        const pads = [1, 2, 3].map(() => randomUtxo({ satoshis: 60_000n }));
        const gas = [1, 2].map(() => randomUtxo({ satoshis: 400_000n }));
        [...pads, ...gas].forEach(u => provider.addUtxo(attacker.tokenAddress, u));

        const tx = new TransactionBuilder({ provider })
            .addInput(outA, cA.managerContract.unlock.outflow(getFundBin(fundA)))  // 0
            .addInput(feeUtxos[0]!, cA.feeContract.unlock.pay())                   // 1
            .addInputs(pads, attacker.signatureTemplate.unlockP2PKH())             // 2, 3, 4
            .addInput(outB, cB.managerContract.unlock.outflow(getFundBin(fundB)))  // 5
            .addInput(feeUtxos[1]!, cB.feeContract.unlock.pay())                   // 6
            .addInputs(gas, attacker.signatureTemplate.unlockP2PKH())              // 7, 8
            .addOutputs([
                withDust({ to: cA.managerContract.tokenAddress, token: { category: system.outflow, amount: 0n, nft: { capability: 'none', commitment: commitB } } }),
                withDust({ to: cA.feeContract.tokenAddress }),
                { to: cA.feeVaultContract.tokenAddress, amount: system.fees.execute.value },
                { to: attacker.tokenAddress, amount: 20_000n },
                { to: attacker.tokenAddress, amount: 20_000n },
                withDust({ to: cB.managerContract.tokenAddress, token: { category: system.outflow, amount: 0n, nft: { capability: 'none', commitment: commitA } } }),
                withDust({ to: cB.feeContract.tokenAddress }),
                { to: cB.feeVaultContract.tokenAddress, amount: system.fees.execute.value },
                { to: attacker.tokenAddress, amount: 20_000n },
                { to: attacker.tokenAddress, amount: 600_000n },
            ]);

        await expect(tx.send()).rejects.toThrow();
        expect((await cA.managerContract.getUtxos()).find(u => u.token?.category === system.outflow)!.token!.nft!.commitment).toBe(commitA);
        expect((await cB.managerContract.getUtxos()).find(u => u.token?.category === system.outflow)!.token!.nft!.commitment).toBe(commitB);
    });
});
