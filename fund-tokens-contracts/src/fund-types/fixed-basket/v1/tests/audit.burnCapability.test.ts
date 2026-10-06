/**
 * Audit finding AUD-025: FeeManager.close() and PublicFundVault.burn() promise that no token of
 * their category survives the transaction, but compared each output's category with the bare
 * 32-byte category. A mutable or minting NFT appends a capability byte to the category, so those
 * variants passed. Reaching them needs a mutable or minting NFT of a system category outside its
 * contract (escaped issuance authority); held here by a plain wallet.
 *
 * Both functions must reject any output carrying their category, whatever its capability.
 */
import { type SpendableUtxo } from 'cashscript';

import { generateWallet } from '@test-utils/wallet.js';

import { PublicFundTransactionBuilder } from '../index.js';
import { bootstrapInstance, createFund, type TestInstance } from './support/bootstrap.js';
import { SystemFixture } from './support/system.js';
import { randomCategory, randomUtxo } from '@test-utils/random.js';

const DustAmount = 1000n;
const Capabilities = ['mutable', 'minting'] as const;

describe('audit: complete burns cover every capability of the category (AUD-025)', () => {
    let instance: TestInstance;

    beforeEach(async () => {
        instance = await bootstrapInstance();
    });

    /**
     * Adds the steward's authorization and a wallet holding a `capability` NFT of `category`, which
     * the transaction carries forward to the wallet or (`burned`) destroys.
     */
    async function addVariant(tx: SystemFixture, category: string, capability: typeof Capabilities[number], burned: boolean) {
        const { provider, system, owner } = instance;
        const holder = generateWallet();
        const auth = (await provider.getUtxos(owner.tokenAddress)).find(u => u.token?.category === system.authorization)!;
        const variant = provider.addUtxo(holder.tokenAddress, randomUtxo({
            satoshis: 10_000n,
            token: { category, amount: 0n, nft: { capability, commitment: '00' } },
        }));
        tx
            .addInput(auth, owner.signatureTemplate.unlockP2PKH())
            .addInput(variant, holder.signatureTemplate.unlockP2PKH())
            .addOutput({ to: owner.tokenAddress, amount: DustAmount, token: auth.token! })
            .addOutput(burned ? { to: holder.tokenAddress, amount: 8_000n } : { to: holder.tokenAddress, amount: 8_000n, token: variant.token! });
        return tx;
    }

    describe('FeeManager.close()', () => {
        async function close(capability: typeof Capabilities[number], burned: boolean) {
            const { provider, system } = instance;
            const { executeFundFeeContract } = new PublicFundTransactionBuilder({ provider, system }).getContracts();
            const fee: SpendableUtxo = (await executeFundFeeContract.getUtxos()).find(u => !u.token)!;
            const tx = new SystemFixture({ provider, system, allowImplicitFungibleTokenBurn: true })
                .addInput(fee, executeFundFeeContract.unlock.close());
            return addVariant(tx, system.fees.execute.nft, capability, burned);
        }

        it.each(Capabilities)('accepts a close that burns a %s fee NFT (control)', async capability => {
            await expect(await close(capability, true)).toBeAccepted();
        });

        it.each(Capabilities)('rejects a close that carries a %s fee NFT forward', async capability => {
            await expect(await close(capability, false)).toBeRejected(/split\(32\)\[0\] != feeToken/);
        });
    });

    describe('PublicFundVault.burn()', () => {
        async function delist(capability: typeof Capabilities[number], burned: boolean) {
            const { provider, system } = instance;
            await createFund(instance, { amount: 10n, satoshis: 1000n, assets: [{ category: randomCategory(), amount: 1n }] });
            const { publicFundVaultContract: vault } = new PublicFundTransactionBuilder({ provider, system }).getContracts();
            const [head, ...rest] = await vault.getUtxos();
            const tx = new SystemFixture({ provider, system, allowImplicitFungibleTokenBurn: true })
                .addInput(head!, vault.unlock.burn())
                .addInputs(rest, vault.unlock.data());
            return addVariant(tx, system.publicFund, capability, burned);
        }

        it.each(Capabilities)('accepts a delist that burns a %s publicFund NFT (control)', async capability => {
            await expect(await delist(capability, true)).toBeAccepted();
        });

        it.each(Capabilities)('rejects a delist that carries a %s publicFund NFT forward', async capability => {
            await expect(await delist(capability, false)).toBeRejected(/split\(32\)\[0\] != publicFund/);
        });
    });
});
