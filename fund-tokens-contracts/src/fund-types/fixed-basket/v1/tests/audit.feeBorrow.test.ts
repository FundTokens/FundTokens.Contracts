/**
 * Audit finding R-1 (from AUD-027): FeeManager.pay()'s default branch returned any token in place.
 * hasAuthority() counts an authorization NFT at a FeeManager (it is not locked by the caller), so
 * an authorization NFT sent there could be borrowed by anyone: here, to release the fee vault.
 *
 * The contracts must reject the borrow; the steward's own authorization still releases the vault.
 */
import { randomUtxo } from '@test-utils/random.js';
import { generateWallet } from '@test-utils/wallet.js';
import { TransactionBuilder } from 'cashscript';

import { bootstrapInstance, type TestInstance } from './support/bootstrap.js';
import { SystemFixture } from './support/system.js';

const VaultSatoshis = 1_000_000n;

describe('audit: borrowing an authorization NFT held at a FeeManager (R-1)', () => {
    let instance: TestInstance;
    let fixture: SystemFixture;

    beforeAll(async () => {
        instance = await bootstrapInstance();
        fixture = new SystemFixture({ provider: instance.provider, system: instance.system });
    });

    /** An authorization NFT allowed to release the fee vault (0x0002). */
    const releaseAuth = () => ({ category: instance.system.authorization, amount: 0n, nft: { capability: 'none' as const, commitment: '01000201' } });

    it('releases the fee vault with the steward\'s own authorization (control)', async () => {
        const { provider, owner } = instance;
        const { feeVaultContract } = fixture.contracts;
        const vault = provider.addUtxo(feeVaultContract.tokenAddress, randomUtxo({ satoshis: VaultSatoshis }));
        const auth = provider.addUtxo(owner.tokenAddress, randomUtxo({ satoshis: 1000n, token: releaseAuth() }));

        const tx = new TransactionBuilder({ provider })
            .addInput(auth, owner.signatureTemplate.unlockP2PKH())
            .addInput(vault, feeVaultContract.unlock.release())
            .addOutputs([
                { to: owner.tokenAddress, amount: 1000n, token: auth.token },
                { to: owner.tokenAddress, amount: VaultSatoshis - 2000n },
            ]);
        await expect(tx).toBeAccepted();
    });

    it('rejects borrowing an authorization NFT kept at a FeeManager to release the fee vault', async () => {
        const { provider, system } = instance;
        const { feeVaultContract, createFundFeeContract } = fixture.contracts;
        const attacker = generateWallet();
        const vault = provider.addUtxo(feeVaultContract.tokenAddress, randomUtxo({ satoshis: VaultSatoshis }));
        const parked = provider.addUtxo(createFundFeeContract.tokenAddress, randomUtxo({ satoshis: 1000n, token: releaseAuth() }));
        const funding = provider.addUtxo(attacker.tokenAddress, randomUtxo({ satoshis: 100_000n }));

        // pay() returns the authorization NFT in place and pays the default fee; release() counts it
        const tx = new TransactionBuilder({ provider })
            .addInput(parked, createFundFeeContract.unlock.pay())
            .addInput(vault, feeVaultContract.unlock.release())
            .addInput(funding, attacker.signatureTemplate.unlockP2PKH())
            .addOutputs([
                { to: createFundFeeContract.tokenAddress, amount: 1000n, token: parked.token },
                { to: feeVaultContract.tokenAddress, amount: system.fees.create.value },
                { to: attacker.tokenAddress, amount: VaultSatoshis + 100_000n - system.fees.create.value - 2000n },
            ]);
        await expect(tx).toBeRejected(/thisInputCategory == 0x/);
        expect(await provider.getUtxos(attacker.tokenAddress)).toHaveLength(1);
    });
});
