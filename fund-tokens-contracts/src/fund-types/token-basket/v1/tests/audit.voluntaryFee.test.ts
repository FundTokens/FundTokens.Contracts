/**
 * Audit finding (v0.1.0-rc2): a voluntary (type 0x02) fee NFT leaves FeeManager.pay()'s payment
 * output (active + 1) fully unconstrained: destination, value and token. In a fund creation that
 * output sits inside both anti-minting skip windows (FundStartup.start() and
 * PublicFund.broadcast()) while the transaction holds the system minting NFTs, so a rogue
 * system-token minting NFT can be paid to any address. Distinct from the startup-return slot.
 *
 * The contracts must reject this transaction.
 */
import { randomUtxo, type Utxo } from 'cashscript';

import { generateWallet } from '@test-utils/wallet.js';

import { withDust } from '../../../../core/outputs.js';
import { buildManualBroadcast } from './support/broadcast.js';
import { bootstrapInstance, type TestInstance } from './support/bootstrap.js';
import { SystemFixture } from './support/system.js';

const DustAmount = 1000n;
const VoluntaryFee = '02';

describe('audit: voluntary create fee in a fund creation', () => {
    let instance: TestInstance;
    let fixture: SystemFixture;

    /** The voluntary create-fee thread, minted once by the steward (auth bit 0x0010). */
    const voluntaryFeeUtxo = async (): Promise<Utxo> =>
        (await fixture.contracts.createFundFeeContract.getUtxos()).find(u => u.token?.nft?.commitment === VoluntaryFee)!;

    beforeAll(async () => {
        instance = await bootstrapInstance();
        const { provider, system, owner } = instance;
        fixture = new SystemFixture({ provider, system });
        const { mintCreateFundFeeContract, createFundFeeContract } = fixture.contracts;

        const minter = (await mintCreateFundFeeContract.getUtxos()).find(u => u.token?.category === system.fees.create.nft)!;
        const auth = (await provider.getUtxos(owner.tokenAddress)).find(u => u.token?.category === system.authorization)!;
        const funding = randomUtxo({ satoshis: 20_000n });
        provider.addUtxo(owner.tokenAddress, funding);

        await new SystemFixture({ provider, system })
            .addInput(minter, mintCreateFundFeeContract.unlock.mint())
            .addInput(auth, owner.signatureTemplate.unlockP2PKH())
            .addInput(funding, owner.signatureTemplate.unlockP2PKH())
            .addOutputs([
                withDust({ to: mintCreateFundFeeContract.tokenAddress, token: minter.token }),
                withDust({ to: createFundFeeContract.tokenAddress, token: { category: system.fees.create.nft, amount: 0n, nft: { capability: 'none', commitment: VoluntaryFee } } }),
                { to: owner.tokenAddress, amount: DustAmount, token: auth.token! },
            ])
            .send();
    });

    it('accepts a fund creation paying through the voluntary fee (control)', async () => {
        const { createFundFeeContract, feeVaultContract } = fixture.contracts;
        const feeUtxo = await voluntaryFeeUtxo();
        const { tx, creator } = await buildManualBroadcast(instance, {
            fee: { utxo: feeUtxo, unlocker: createFundFeeContract.unlock.pay() },
            feeOutputs: [
                withDust({ to: createFundFeeContract.tokenAddress, token: feeUtxo.token }),
                { to: feeVaultContract.tokenAddress, amount: instance.system.fees.create.value },
            ],
        });
        tx.addOutput({ to: creator.tokenAddress, amount: 500_000n });

        await expect(tx).toBeAccepted();
    });

    it('rejects a fund creation whose voluntary fee slot pays a rogue outflow minting NFT', async () => {
        const { provider, system } = instance;
        const attacker = generateWallet();
        const { createFundFeeContract } = fixture.contracts;
        const feeUtxo = await voluntaryFeeUtxo();
        const { tx, creator } = await buildManualBroadcast(instance, {
            fee: { utxo: feeUtxo, unlocker: createFundFeeContract.unlock.pay() },
            feeOutputs: [
                withDust({ to: createFundFeeContract.tokenAddress, token: feeUtxo.token }),
                withDust({ to: attacker.tokenAddress, token: { category: system.outflow, amount: 0n, nft: { capability: 'minting', commitment: '01' } } }),
            ],
        });
        tx.addOutput({ to: creator.tokenAddress, amount: 500_000n });

        await expect(tx).toBeRejected();
        expect(await provider.getUtxos(attacker.tokenAddress)).toHaveLength(0);
    });
});
