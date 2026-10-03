/** Hand-built fund creations, for tests that need to place or replace the fee inputs and outputs. */
import { swapEndianness } from '@bitauth/libauth';
import { randomUtxo, type Output, type Unlocker, type SpendableUtxo } from 'cashscript';
import { generateWallet } from '@test-utils/wallet.js';
import { MaxTokenAmount } from '../../../../../core/constants.js';
import { withDust } from '../../../../../core/outputs.js';
import { deriveFundContracts } from '../../contracts.js';
import { getFundCommitment, getFundHex, hashFund } from '../../encoding.js';
import { normalizeFund } from '../../fund.js';
import { PublicFundTransactionBuilder } from '../../PublicFundTransactionBuilder.js';
import type { TestInstance } from './bootstrap.js';

const DustAmount = 1000n;

export interface ManualBroadcastOptions {
    /** The create-fee input, with its unlocker. */
    fee: { utxo: SpendableUtxo; unlocker: Unlocker };
    /** The fee outputs that follow the mint returns: the fee return, then what the fee slot pays. */
    feeOutputs: Output[];
}

/**
 * Builds a fund creation with the genesis at input 0, startup at 1 (s = 1), the mint threads, the
 * given fee input and outputs, the public fund thread, then the manager, fund and vault outputs.
 * The caller adds any further inputs and outputs (and must add BCH for the fee).
 */
export async function buildManualBroadcast({ provider, system }: TestInstance, { fee, feeOutputs }: ManualBroadcastOptions) {
    const creator = generateWallet();
    const genesis = provider.addUtxo(creator.tokenAddress, randomUtxo({ vout: 0, satoshis: DustAmount }));
    const funding = provider.addUtxo(creator.tokenAddress, randomUtxo({ satoshis: 1_000_000n }));
    const fund = normalizeFund({ category: genesis.txid, amount: 1n, satoshis: 1000n, assets: [] });

    const tx = new PublicFundTransactionBuilder({ provider, system });
    const { startupContract, mintInflowContract, mintOutflowContract, publicFundContract, publicFundVaultContract } = tx.getContracts();
    const { managerContract, fundContract } = deriveFundContracts(provider, tx.system, fund);

    const startupUtxo = (await startupContract.getUtxos()).find(u => !u.token)!;
    const inflowMint = (await mintInflowContract.getUtxos()).find(u => u.token?.category === system.inflow)!;
    const outflowMint = (await mintOutflowContract.getUtxos()).find(u => u.token?.category === system.outflow)!;
    const publicFundUtxo = (await publicFundContract.getUtxos()).find(u => u.token?.category === system.publicFund)!;
    const threadCommitment = '02' + swapEndianness(fund.category) + hashFund(fund);

    tx
        .addInput(genesis, creator.signatureTemplate.unlockP2PKH())                   // 0 genesis
        .addInput(startupUtxo, startupContract.unlock.start(getFundHex(fund), new Uint8Array()))        // 1 startup (s)
        .addInput(inflowMint, mintInflowContract.unlock.mint())                       // 2
        .addInput(outflowMint, mintOutflowContract.unlock.mint())                     // 3
        .addInput(fee.utxo, fee.unlocker)                                             // 4 create fee
        .addInput(publicFundUtxo, publicFundContract.unlock.broadcast(new Uint8Array()))              // 5 public fund
        .addOutputs([
            tx.getAuthHeadOutput(),                                                                              // 0 authhead
            { to: startupContract.tokenAddress, amount: startupUtxo.satoshis },                                   // 1 startup return
            withDust({ to: mintInflowContract.tokenAddress, token: inflowMint.token }),                          // 2
            withDust({ to: mintOutflowContract.tokenAddress, token: outflowMint.token }),                        // 3
            ...feeOutputs,                                                                                        // 4, 5
            withDust({ to: managerContract.tokenAddress, token: { category: system.inflow, amount: 0n, nft: { capability: 'none', commitment: threadCommitment } } }),
            withDust({ to: managerContract.tokenAddress, token: { category: system.outflow, amount: 0n, nft: { capability: 'none', commitment: threadCommitment } } }),
            withDust({ to: fundContract.tokenAddress, token: { category: fund.category, amount: MaxTokenAmount } }),
            withDust({ to: publicFundContract.tokenAddress, token: publicFundUtxo.token }),
        ]);
    const commitment = getFundCommitment(fund);
    for (let offset = 0; offset < commitment.length; offset += 256) {
        tx.addOutput(withDust({
            to: publicFundVaultContract.tokenAddress,
            token: { category: system.publicFund, amount: 0n, nft: { capability: 'none', commitment: commitment.slice(offset, offset + 256) } },
        }));
    }
    tx.addInput(funding, creator.signatureTemplate.unlockP2PKH());
    return { tx, creator, fund };
}
