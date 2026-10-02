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

        await expect(tx).toBeRejected();
        expect((await cA.managerContract.getUtxos()).find(u => u.token?.category === system.inflow)!.token!.nft!.commitment).toBe(commitA);
        expect((await cB.managerContract.getUtxos()).find(u => u.token?.category === system.inflow)!.token!.nft!.commitment).toBe(commitB);
    });

    describe('two one-unit redemptions in one transaction', () => {
        const holder = generateWallet();

        /** Deposits one unit into `fund`, so its reserve holds exactly one unit and the holder one unit of fund tokens. */
        async function depositOneUnit(fund: Fund) {
            const { provider, system } = instance;
            const funding = randomUtxo({ satoshis: 400_000n });
            const asset = randomUtxo({ token: { category: fund.assets[0]!.category, amount: fund.assets[0]!.amount } });
            [funding, asset].forEach(u => provider.addUtxo(holder.tokenAddress, u));
            const inflow = new FundTokenTransactionBuilder({ provider, system, fund });
            await inflow.addInflow({ units: 1n });
            await inflow
                .addInputs([funding, asset], holder.signatureTemplate.unlockP2PKH())
                .addOutput({ to: holder.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: fund.amount } })
                .send();
        }

        /**
         * Redeems one unit of each fund, each operation laid out as the builder would (manager, fee, fund
         * supply, the whole reserve), with each outflow thread returned with its own or the other's commitment.
         */
        async function buildRedemptions(threads: 'own' | 'swapped') {
            const { provider, system } = instance;
            await depositOneUnit(fundA);
            await depositOneUnit(fundB);

            const feeUtxos = (await contractsOf(fundA).feeContract.getUtxos()).filter(u => !u.token);
            const holderTokens = await provider.getUtxos(holder.tokenAddress);
            const funding = randomUtxo({ satoshis: 1_000_000n });
            provider.addUtxo(holder.tokenAddress, funding);

            const tx = new TransactionBuilder({ provider });
            const operations = await Promise.all([fundA, fundB].map(async (fund, i) => {
                const contracts = contractsOf(fund);
                return {
                    fund,
                    contracts,
                    thread: (await contracts.managerContract.getUtxos()).find(u => u.token?.category === system.outflow)!,
                    supply: (await contracts.fundContract.getUtxos()).find(u => u.token?.category === fund.category)!,
                    reserve: (await contracts.assetContracts[0]!.getUtxos()).find(u => u.token?.category === fund.assets[0]!.category)!,
                    fee: feeUtxos[i]!,
                };
            }));
            const commitments = operations.map(op => op.thread.token!.nft!.commitment);
            const returned = threads === 'own' ? commitments : [...commitments].reverse();

            operations.forEach(({ fund, contracts, thread, supply, reserve, fee }, i) => {
                tx
                    .addInput(thread, contracts.managerContract.unlock.outflow(getFundBin(fund))) // a
                    .addInput(fee, contracts.feeContract.unlock.pay())                            // a+1
                    .addInput(supply, contracts.fundContract.unlock.redeem())                     // a+2
                    .addInput(reserve, contracts.assetContracts[0]!.unlock.release())             // a+3
                    .addOutputs([
                        withDust({ to: contracts.managerContract.tokenAddress, token: { category: system.outflow, amount: 0n, nft: { capability: 'none', commitment: returned[i]! } } }),
                        withDust({ to: contracts.feeContract.tokenAddress }),
                        { to: contracts.feeVaultContract.tokenAddress, amount: system.fees.execute.value },
                        withDust({ to: contracts.fundContract.tokenAddress, token: { category: fund.category, amount: supply.token!.amount + fund.amount } }),
                    ]);
            });
            tx
                .addInputs([...holderTokens.filter(u => u.token), funding], holder.signatureTemplate.unlockP2PKH())
                .addOutputs(operations.map(({ reserve }) => withDust({ to: holder.tokenAddress, token: reserve.token! })))
                .addOutput({ to: holder.tokenAddress, amount: 700_000n });

            const threadsAfter = () => Promise.all(operations.map(async ({ contracts }) =>
                (await contracts.managerContract.getUtxos()).find(u => u.token?.category === system.outflow)!.token!.nft!.commitment));
            return { tx, commitments, threadsAfter };
        }

        it('accepts them when each outflow thread returns unchanged (control)', async () => {
            const { tx, commitments, threadsAfter } = await buildRedemptions('own');
            await expect(tx).toBeAccepted();
            expect(await threadsAfter()).toEqual(commitments);
        });

        it('rejects them when each fund\'s outflow thread returns with the other\'s commitment', async () => {
            const { tx, commitments, threadsAfter } = await buildRedemptions('swapped');

            // No minting or mutable NFT anywhere in the transaction.
            const capabilities = [...tx.inputs, ...tx.outputs].flatMap(x => (x.token?.nft ? [x.token.nft.capability] : []));
            expect(capabilities.every(c => c === 'none')).toBe(true);

            await expect(tx).toBeRejected();
            expect(await threadsAfter()).toEqual(commitments);
        });
    });
});
