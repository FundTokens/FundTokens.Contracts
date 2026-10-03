/**
 * Audit findings (fresh pass):
 *
 * R-1 (regression): commit 85df3cf added to FeeManager.close() a check that no output returns to
 *   the fee contract, which kept the manager's "fee must not close" guard honest; 1e1fafd removed
 *   it. A fee UTXO can then be spent with close() inside a fund creation: startup's "sends back
 *   to self" check is met by a tokenless FeeManager output, no fee is paid, and the fee-payment
 *   slot (inside both anti-minting skip windows) is unconstrained. Only auth bit 0x0020 ("close
 *   fees") is needed, not the fee-minting permission.
 *
 * R-2 (self-authorization): the authorization loops scan inputs from index 0, counting the
 *   contract's own input. An authorization NFT parked at an auth-gated contract therefore
 *   authorizes its own spend, and release() constrains no outputs.
 *
 * The contracts must reject both transactions.
 */
import { randomUtxo } from 'cashscript';

import { generateWallet } from '@test-utils/wallet.js';

import { withDust } from '../../../../core/outputs.js';
import { PublicFundTransactionBuilder } from '../index.js';
import { buildManualBroadcast } from './support/broadcast.js';
import { bootstrapInstance, type TestInstance } from './support/bootstrap.js';
import { SystemFixture } from './support/system.js';

const DustAmount = 1000n;

describe('audit: close() regression (R-1) and self-authorization (R-2)', () => {
    let instance: TestInstance;

    beforeEach(async () => {
        instance = await bootstrapInstance();
    });

    it('rejects a fund creation that spends the create fee with close() and pays a rogue minting NFT (R-1)', async () => {
        const { provider, system, owner } = instance;
        const attacker = generateWallet();
        const { createFundFeeContract } = new PublicFundTransactionBuilder({ provider, system }).getContracts();
        const feeUtxo = (await createFundFeeContract.getUtxos()).find(u => !u.token)!;
        const auth = (await provider.getUtxos(owner.tokenAddress)).find(u => u.token?.category === system.authorization)!;

        const { tx, creator } = await buildManualBroadcast(instance, {
            fee: { utxo: feeUtxo, unlocker: createFundFeeContract.unlock.close() },
            feeOutputs: [
                withDust({ to: createFundFeeContract.tokenAddress }), // satisfies startup; no fee is paid
                withDust({ to: attacker.tokenAddress, token: { category: system.outflow, amount: 0n, nft: { capability: 'minting', commitment: '01' } } }),
            ],
        });
        tx
            .addInput(auth, owner.signatureTemplate.unlockP2PKH())
            .addOutput({ to: owner.tokenAddress, amount: DustAmount, token: auth.token! })
            .addOutput({ to: creator.tokenAddress, amount: 500_000n });

        await expect(tx).toBeRejected();
        expect(await provider.getUtxos(attacker.tokenAddress)).toHaveLength(0);
    });

    it('rejects spending an authorization NFT parked at the fee vault with nothing but itself as authority (R-2)', async () => {
        const { provider, system, owner } = instance;
        const attacker = generateWallet();
        const { feeVaultContract } = new PublicFundTransactionBuilder({ provider, system }).getContracts();
        const auth = (await provider.getUtxos(owner.tokenAddress)).find(u => u.token?.category === system.authorization)!;

        // The steward mistakenly parks the authorization NFT at the fee vault.
        const parkFunding = randomUtxo({ satoshis: 10_000n });
        provider.addUtxo(owner.tokenAddress, parkFunding);
        await new SystemFixture({ provider, system })
            .addInput(auth, owner.signatureTemplate.unlockP2PKH())
            .addInput(parkFunding, owner.signatureTemplate.unlockP2PKH())
            .addOutput({ to: feeVaultContract.tokenAddress, amount: DustAmount, token: auth.token! })
            .addOutput({ to: owner.tokenAddress, amount: 8000n })
            .send();
        const parked = (await feeVaultContract.getUtxos()).find(u => u.token?.category === system.authorization)!;

        const funding = randomUtxo({ satoshis: 10_000n });
        provider.addUtxo(attacker.tokenAddress, funding);
        const steal = new SystemFixture({ provider, system })
            .addInput(parked, feeVaultContract.unlock.release())
            .addInput(funding, attacker.signatureTemplate.unlockP2PKH())
            .addOutput({ to: attacker.tokenAddress, amount: DustAmount, token: parked.token! })
            .addOutput({ to: attacker.tokenAddress, amount: 8000n });

        await expect(steal).toBeRejected();
        expect(await feeVaultContract.getUtxos()).toContainEqual(parked);
    });
});
