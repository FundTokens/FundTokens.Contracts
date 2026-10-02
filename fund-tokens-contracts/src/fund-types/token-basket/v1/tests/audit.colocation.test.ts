/**
 * Audit finding (fresh pass): a thread-creation transaction can carry a live outflow.
 *
 * The audit record closed this as a negative result (FN-3): every placement of an inflow or
 * outflow inside a fund creation was thought to collide with a slot startup, mint_inflow,
 * mint_outflow or fee.pay() had already pinned. That result justified the missing commitment
 * check on the manager's thread recreation.
 *
 * The manager at a = s+6 does not collide: startup and mint_outflow pin that slot to the minted
 * outflow thread at the fund's TransactionManager, and the manager's own return is the same
 * address and category. So start() and manager.outflow() co-execute, with the create fee at s+3
 * and the execute fee at s+7.
 *
 * The contracts must reject this transaction.
 */
import { swapEndianness } from '@bitauth/libauth';
import { TransactionBuilder, randomUtxo } from 'cashscript';

import { randomCategory } from '@test-utils/random.js';
import { generateWallet } from '@test-utils/wallet.js';

import { withDust } from '../../../../core/outputs.js';
import { FundTokenTransactionBuilder, PublicFundTransactionBuilder, getFundBin, getFundHex, hashFund, normalizeFund, type Fund } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';

const DustAmount = 1000n;

describe('audit: thread creation co-located with a live outflow', () => {
    let instance: TestInstance;
    let fund: Fund;
    let holder: ReturnType<typeof generateWallet>;

    beforeAll(async () => {
        instance = await bootstrapInstance();
        const { provider, system } = instance;
        fund = normalizeFund(await createFund(instance, { amount: 10n, satoshis: 0n, assets: [{ category: randomCategory(), amount: 4n }] }));

        // One honest deposit of 5 units: the reserve holds 20 asset tokens.
        holder = generateWallet();
        const funding = randomUtxo({ satoshis: 400_000n });
        const asset = randomUtxo({ token: { category: fund.assets[0]!.category, amount: 20n } });
        [funding, asset].forEach(u => provider.addUtxo(holder.tokenAddress, u));
        const inflow = new FundTokenTransactionBuilder({ provider, system, fund });
        await inflow.addInflow({ units: 5n });
        await inflow
            .addInputs([funding, asset], holder.signatureTemplate.unlockP2PKH())
            .addOutput({ to: holder.tokenAddress, amount: DustAmount, token: { category: fund.category, amount: 50n } })
            .send();
    });

    it('rejects start() and the mints co-executing with manager.outflow() in one transaction', async () => {
        const { provider, system } = instance;
        const { startupContract, mintInflowContract, mintOutflowContract, createFundFeeContract, executeFundFeeContract, feeVaultContract } =
            new PublicFundTransactionBuilder({ provider, system }).getContracts();
        const { managerContract, fundContract, assetContracts } = new FundTokenTransactionBuilder({ provider, system, fund }).getContracts();
        const assetContract = assetContracts[0]!;
        const threadCommitment = '02' + swapEndianness(fund.category) + hashFund(fund);

        const startupUtxo = (await startupContract.getUtxos()).find(u => !u.token)!;
        const inflowMint = (await mintInflowContract.getUtxos()).find(u => u.token?.category === system.inflow)!;
        const outflowMint = (await mintOutflowContract.getUtxos()).find(u => u.token?.category === system.outflow)!;
        const createFee = (await createFundFeeContract.getUtxos()).find(u => !u.token)!;
        const executeFee = (await executeFundFeeContract.getUtxos()).find(u => !u.token)!;
        const outflowThread = (await managerContract.getUtxos()).find(u => u.token?.category === system.outflow)!;
        const supply = (await fundContract.getUtxos()).find(u => u.token?.category === fund.category)!;
        const reserve = (await assetContract.getUtxos()).find(u => u.token?.category === fund.assets[0]!.category)!;
        const fundTokens = (await provider.getUtxos(holder.tokenAddress)).find(u => u.token?.category === fund.category)!;

        const redeemer = generateWallet();
        const funding = randomUtxo({ satoshis: 1_000_000n });
        provider.addUtxo(redeemer.tokenAddress, funding);
        const reserveBefore = reserve.token!.amount;

        const tx = new TransactionBuilder({ provider })
            .addInput(startupUtxo, startupContract.unlock.start(getFundHex(fund)))       // 0  s
            .addInput(inflowMint, mintInflowContract.unlock.mint())                      // 1  s+1
            .addInput(outflowMint, mintOutflowContract.unlock.mint())                    // 2  s+2
            .addInput(createFee, createFundFeeContract.unlock.pay())                     // 3  s+3
            .addInput(funding, redeemer.signatureTemplate.unlockP2PKH())                 // 4  s+4
            .addInput(fundTokens, holder.signatureTemplate.unlockP2PKH())                // 5  s+5
            .addInput(outflowThread, managerContract.unlock.outflow(getFundBin(fund)))   // 6  a = s+6
            .addInput(executeFee, executeFundFeeContract.unlock.pay())                   // 7  a+1
            .addInput(supply, fundContract.unlock.redeem())                              // 8  a+2
            .addInput(reserve, assetContract.unlock.release())                           // 9  a+3
            .addOutputs([
                { to: startupContract.tokenAddress, amount: startupUtxo.satoshis },                                        // 0
                { to: mintInflowContract.tokenAddress, amount: inflowMint.satoshis, token: inflowMint.token! },            // 1
                { to: mintOutflowContract.tokenAddress, amount: outflowMint.satoshis, token: outflowMint.token! },         // 2
                withDust({ to: createFundFeeContract.tokenAddress }),                                                      // 3
                { to: feeVaultContract.tokenAddress, amount: system.fees.create.value },                                   // 4
                withDust({ to: managerContract.tokenAddress,                                                               // 5 minted inflow thread
                    token: { category: system.inflow, amount: 0n, nft: { capability: 'none', commitment: threadCommitment } } }),
                withDust({ to: managerContract.tokenAddress,                                                               // 6 minted outflow thread == manager return
                    token: { category: system.outflow, amount: 0n, nft: { capability: 'none', commitment: threadCommitment } } }),
                withDust({ to: executeFundFeeContract.tokenAddress }),                                                     // 7
                { to: feeVaultContract.tokenAddress, amount: system.fees.execute.value },                                  // 8
                withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: supply.token!.amount + 50n } }), // 9
                withDust({ to: redeemer.tokenAddress, token: { category: fund.assets[0]!.category, amount: reserveBefore } }),       // 10
                { to: redeemer.tokenAddress, amount: 880_000n },                                                           // 11
            ]);

        await expect(tx).toBeRejected();
        const threads = (await managerContract.getUtxos()).filter(u => u.token?.category === system.inflow);
        expect(threads).toHaveLength(1);
    });
});
