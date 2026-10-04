/**
 * Review finding H1: a fund creation's genesis input lets it mint any token of the new fund's
 * category, and the create fee's payment output (s + 4) sits inside both anti-minting skip windows
 * (FundStartup.start() and PublicFund.broadcast()). FeeManager.pay() checked that output's
 * destination and value but, for the default, BCH-encoded and voluntary fees, not its token, so a
 * minting NFT of the fund's category could be paid to the fee destination: its holder could mint
 * fund tokens without limit and redeem the fund's custody.
 *
 * The contracts must reject each such fund creation, and still accept the fees paid normally.
 */
import { bigIntToBinUint64LEClamped, binToHex } from '@bitauth/libauth';
import type { Output, SpendableUtxo } from 'cashscript';

import { randomCategory, randomUtxo } from '@test-utils/random.js';

import { withDust } from '../../../../core/outputs.js';
import { bootstrapInstance, type TestInstance } from './support/bootstrap.js';
import { buildManualBroadcast } from './support/broadcast.js';
import { SystemFixture } from './support/system.js';

const DustAmount = 1000n;
const BchFeeValue = 5000n;
const BchFee = '01' + '00'.repeat(32) + binToHex(bigIntToBinUint64LEClamped(BchFeeValue));
const VoluntaryFee = '02';
const FeePaymentOutput = 5; // s + 4, with the startup input at s = 1

describe('audit: create fee payment carrying a fund-category minting NFT (H1)', () => {
    let instance: TestInstance;
    let fixture: SystemFixture;

    beforeAll(async () => {
        instance = await bootstrapInstance();
        const { provider, system, owner } = instance;
        fixture = new SystemFixture({ provider, system });
        const { mintCreateFundFeeContract, createFundFeeContract } = fixture.contracts;

        // The steward mints a BCH-encoded and a voluntary create fee next to the default one (auth bit 0x0010)
        const minter = (await mintCreateFundFeeContract.getUtxos()).find(u => u.token?.category === system.fees.create.nft)!;
        const auth = (await provider.getUtxos(owner.tokenAddress)).find(u => u.token?.category === system.authorization)!;
        const funding = provider.addUtxo(owner.tokenAddress, randomUtxo({ satoshis: 20_000n }));
        const feeNft = (commitment: string) =>
            withDust({ to: createFundFeeContract.tokenAddress, token: { category: system.fees.create.nft, amount: 0n, nft: { capability: 'none', commitment } } });
        await new SystemFixture({ provider, system })
            .addInput(minter, mintCreateFundFeeContract.unlock.mint())
            .addInput(auth, owner.signatureTemplate.unlockP2PKH())
            .addInput(funding, owner.signatureTemplate.unlockP2PKH())
            .addOutputs([
                withDust({ to: mintCreateFundFeeContract.tokenAddress, token: minter.token }),
                feeNft(BchFee),
                feeNft(VoluntaryFee),
                { to: owner.tokenAddress, amount: DustAmount, token: auth.token! },
            ])
            .send();
    });

    /** The default (tokenless) create fee UTXO, or the fee NFT with `commitment`. */
    const feeUtxo = async (commitment?: string): Promise<SpendableUtxo> =>
        (await fixture.contracts.createFundFeeContract.getUtxos()).find(u => (commitment ? u.token?.nft?.commitment === commitment : !u.token))!;

    const vault = () => fixture.contracts.feeVaultContract.tokenAddress;
    const donation = randomCategory();
    const donated = (address: string) => instance.provider.addUtxo(address, randomUtxo({ satoshis: DustAmount, token: { category: donation, amount: 100n } }));

    /** A fund creation through the given fee, its payment replaced by `payment(fundCategory)`. */
    async function creation(commitment: string | undefined, payment: (fundCategory: string) => Output) {
        const { createFundFeeContract } = fixture.contracts;
        const fee = await feeUtxo(commitment);
        const { tx, creator, fund } = await buildManualBroadcast(instance, {
            fee: { utxo: fee, unlocker: createFundFeeContract.unlock.pay() },
            feeOutputs: [withDust({ to: createFundFeeContract.tokenAddress, ...(fee.token && { token: fee.token }) }), { to: vault(), amount: DustAmount }],
        });
        tx.outputs[FeePaymentOutput] = payment(fund.category);
        tx.addOutput({ to: creator.tokenAddress, amount: 500_000n });
        return { tx, creator };
    }

    const mintingNft = (category: string) => ({ category, amount: 0n, nft: { capability: 'minting' as const, commitment: '' } });

    describe.each([
        ['the default fee', undefined, () => instance.system.fees.create.value],
        ['a BCH-encoded fee', BchFee, () => BchFeeValue],
        ['a voluntary fee', VoluntaryFee, () => DustAmount],
    ])('paying %s', (_, commitment, value) => {
        it('accepts a payment of BCH alone (control)', async () => {
            const { tx } = await creation(commitment, () => ({ to: vault(), amount: value() }));
            await expect(tx).toBeAccepted();
        });

        it('rejects a payment carrying a minting NFT of the fund\'s category', async () => {
            const { tx } = await creation(commitment, category => ({ to: vault(), amount: value(), token: mintingNft(category) }));
            expect(tx.outputs[FeePaymentOutput]!.token?.nft?.capability).toBe('minting');
            await expect(tx).toBeRejected(/FeeManager\.cash/);
        });
    });

    it('accepts a voluntary fee paid in fungible tokens (control)', async () => {
        const { tx, creator } = await creation(VoluntaryFee, () => withDust({ to: vault(), token: { category: donation, amount: 100n } }));
        tx.addInput(donated(creator.tokenAddress), creator.signatureTemplate.unlockP2PKH());
        await expect(tx).toBeAccepted();
    });

});
