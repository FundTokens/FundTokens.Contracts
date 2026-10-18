/**
 * Audit finding R-2 (from AUD-006): a voluntary create fee lets the fee payment (s + 4) carry any
 * immutable NFT, and FundStartup.start() and PublicFund.broadcast() skipped that output in their
 * scans. The transaction holds the inflow, outflow and public fund minting NFTs and the fund's
 * genesis, so it could mint onto the fee payment a forged thread, a fake publicFund chunk (which
 * PublicFundVault.proof() accepts) or a fund-category NFT.
 *
 * The contracts must reject each; a voluntary fee paid in an ordinary token stays accepted.
 */
import type { Output, SpendableUtxo } from 'cashscript';

import { randomCategory, randomUtxo } from '@test-utils/random.js';

import { withDust } from '../../../../core/outputs.js';
import { buildManualBroadcast } from './support/broadcast.js';
import { bootstrapInstance, type TestInstance } from './support/bootstrap.js';
import { SystemFixture } from './support/system.js';

const DustAmount = 1000n;
const VoluntaryFee = '02';

describe('audit: system-category NFTs in the voluntary create fee payment (R-2)', () => {
    let instance: TestInstance;
    let fixture: SystemFixture;

    const voluntaryFeeUtxo = async (): Promise<SpendableUtxo> =>
        (await fixture.contracts.createFundFeeContract.getUtxos()).find(u => u.token?.nft?.commitment === VoluntaryFee)!;

    beforeAll(async () => {
        instance = await bootstrapInstance();
        const { provider, system, owner } = instance;
        fixture = new SystemFixture({ provider, system });
        const { mintCreateFundFeeContract, createFundFeeContract } = fixture.contracts;

        // The steward mints one voluntary create fee (auth bit 0x0010) per test
        const minter = (await mintCreateFundFeeContract.getUtxos()).find(u => u.token?.category === system.fees.create.nft)!;
        const auth = (await provider.getUtxos(owner.tokenAddress)).find(u => u.token?.category === system.authorization)!;
        const funding = provider.addUtxo(owner.tokenAddress, randomUtxo({ satoshis: 50_000n }));
        const voluntary = withDust({ to: createFundFeeContract.tokenAddress, token: { category: system.fees.create.nft, amount: 0n, nft: { capability: 'none', commitment: VoluntaryFee } } });
        await new SystemFixture({ provider, system })
            .addInput(minter, mintCreateFundFeeContract.unlock.mint())
            .addInput(auth, owner.signatureTemplate.unlockP2PKH())
            .addInput(funding, owner.signatureTemplate.unlockP2PKH())
            .addOutputs([
                withDust({ to: mintCreateFundFeeContract.tokenAddress, token: minter.token }),
                ...Array.from({ length: 5 }, () => voluntary),
                { to: owner.tokenAddress, amount: DustAmount, token: auth.token! },
            ])
            .send();
    });

    /** A fund creation paying the voluntary fee to the fee vault with `payment`'s token. */
    async function creation(payment: (fundCategory: string) => Output['token']) {
        const { createFundFeeContract, feeVaultContract } = fixture.contracts;
        const feeUtxo = await voluntaryFeeUtxo();
        // The genesis category is only known once the creation is built: build it, then fill the payment
        const built = await buildManualBroadcast(instance, {
            fee: { utxo: feeUtxo, unlocker: createFundFeeContract.unlock.pay() },
            feeOutputs: [
                withDust({ to: createFundFeeContract.tokenAddress, token: feeUtxo.token }),
                { to: feeVaultContract.tokenAddress, amount: DustAmount },
            ],
        });
        built.tx.outputs[5] = withDust({ to: feeVaultContract.tokenAddress, token: payment(built.fund.category) }) as typeof built.tx.outputs[number];
        built.tx.addOutput({ to: built.creator.tokenAddress, amount: 500_000n });
        return built;
    }

    it('accepts a voluntary fee paid in an ordinary token (control)', async () => {
        const { provider } = instance;
        const category = randomCategory();
        const { tx, creator } = await creation(() => ({ category, amount: 100n }));
        tx.addInput(provider.addUtxo(creator.tokenAddress, randomUtxo({ satoshis: DustAmount, token: { category, amount: 100n } })), creator.signatureTemplate.unlockP2PKH());
        await expect(tx).toBeAccepted();
    });

    const immutable = (category: string, commitment: string) => ({ category, amount: 0n, nft: { capability: 'none' as const, commitment } });

    it('rejects a forged inflow thread on the fee payment', async () => {
        const { tx } = await creation(() => immutable(instance.system.inflow, '02' + '11'.repeat(64)));
        await expect(tx).toBeRejected(/outputCategory != inflowToken/);
    });

    it('rejects a forged outflow thread on the fee payment', async () => {
        const { tx } = await creation(() => immutable(instance.system.outflow, '02' + '11'.repeat(64)));
        await expect(tx).toBeRejected(/outputCategory != outflowToken/);
    });

    it('rejects a fake public fund chunk on the fee payment', async () => {
        const { tx } = await creation(() => immutable(instance.system.publicFund, '02' + '22'.repeat(64)));
        await expect(tx).toBeRejected(/category != token/);
    });

    it('rejects a fund-category NFT on the fee payment', async () => {
        const { tx } = await creation(fundCategory => immutable(fundCategory, ''));
        await expect(tx).toBeRejected(/category != tx.inputs\[0\].outpointTransactionHash/);
    });
});
