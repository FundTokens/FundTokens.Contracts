/**
 * Audit finding AUD-027: SimpleVault.release() scans every input for the authorization token,
 * and SimpleVault.verify() accepts any preceding input with the same locking bytecode. Excluding
 * the active input from release()'s scan does not make a misplaced authorization token safe:
 *
 *   input 0  an ordinary (tokenless) vault UTXO, spent with release()
 *   input 1  the authorization NFT parked at the same vault, spent with verify()
 *
 * release() finds the authorization token at input 1, and verify() is satisfied by the vault
 * input in front of it. Neither establishes independent steward control and no output is
 * constrained, so the pair can be spent anywhere.
 *
 * The contracts must reject this transaction.
 */
import { swapEndianness } from '@bitauth/libauth';
import { Contract, MockNetworkProvider, TransactionBuilder, randomUtxo, type Utxo } from 'cashscript';

import { randomCategory } from '@test-utils/random.js';
import { generateWallet } from '@test-utils/wallet.js';

import simpleVaultArtifact from '../artifacts/simple_vault.js';

const DustAmount = 1000n;

describe('audit: linked-input authorization at SimpleVault (AUD-027)', () => {
    const provider = new MockNetworkProvider({ updateUtxoSet: true });
    const owner = generateWallet();
    const attacker = generateWallet();
    const authorization = randomCategory();
    const vault = new Contract(simpleVaultArtifact, [swapEndianness(authorization)], { provider });

    let ordinary: Utxo;
    let parked: Utxo;

    beforeAll(async () => {
        // The steward parks an authorization NFT (all permissions, including bit 0x0080) and an ordinary UTXO at the vault.
        const genesis = randomUtxo({ vout: 0, satoshis: DustAmount, txid: authorization });
        const funding = randomUtxo({ satoshis: 100_000n });
        [genesis, funding].forEach(u => provider.addUtxo(owner.tokenAddress, u));

        await new TransactionBuilder({ provider })
            .addInput(genesis, owner.signatureTemplate.unlockP2PKH())
            .addInput(funding, owner.signatureTemplate.unlockP2PKH())
            .addOutput({ to: vault.tokenAddress, amount: DustAmount, token: { category: authorization, amount: 0n, nft: { capability: 'none', commitment: '01FFFF01' } } })
            .addOutput({ to: vault.tokenAddress, amount: 50_000n })
            .addOutput({ to: owner.tokenAddress, amount: 40_000n })
            .send();

        const utxos = await vault.getUtxos();
        ordinary = utxos.find(u => !u.token)!;
        parked = utxos.find(u => u.token?.category === authorization)!;
    });

    it('rejects release() + verify() spending a parked authorization NFT without independent authority', async () => {
        const steal = new TransactionBuilder({ provider })
            .addInput(ordinary, vault.unlock.release()) // 0: its scan finds the authorization token at input 1
            .addInput(parked, vault.unlock.verify())    // 1: linked to the vault input in front of it
            .addOutput({ to: attacker.tokenAddress, amount: DustAmount, token: parked.token! })
            .addOutput({ to: attacker.tokenAddress, amount: 47_000n });

        await expect(steal).toBeRejected();
        expect(await provider.getUtxos(attacker.tokenAddress)).toHaveLength(0);
        expect(await vault.getUtxos()).toHaveLength(2);
    });
});
