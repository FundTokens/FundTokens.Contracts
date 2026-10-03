/**
 * Audit probe: can InstanceVault.proof() run with the instance NFTs held at a different
 * (attacker) address? data()'s adjacency checks only compare locking bytecode, category and
 * outpoint transaction with the previous input, never the vault's own address.
 *
 * Consensus binds a UTXO to the script it is locked with, so the vault's unlockers cannot spend
 * NFTs held anywhere else. cashscript refuses to even build such a spend, so the vault's unlocking
 * bytecode is passed as a custom unlocker and the transaction is verified against an assumed source.
 */
import { binToHex, hash256, hexToBin, swapEndianness } from '@bitauth/libauth';
import { Contract, MockNetworkProvider, TransactionBuilder, randomUtxo, type Unlocker } from 'cashscript';

import { randomCategory } from '@test-utils/random.js';
import { generateWallet } from '@test-utils/wallet.js';

import { lockingBytecodeHexOf } from '../../../../core/outputs.js';
import instanceVaultArtifact from '../artifacts/instance_vault.js';
import { verifyTransaction } from '@test-utils/consensus.js';

describe('audit: instance vault address substitution', () => {
    it('rejects proof() over instance NFTs held at an attacker address', async () => {
        const provider = new MockNetworkProvider({ updateUtxoSet: true });
        const attacker = generateWallet();
        const instance = randomCategory();
        const instanceVault = new Contract(instanceVaultArtifact, [swapEndianness(instance), swapEndianness(randomCategory())], { provider });

        const data1 = hexToBin('aaaa');
        const data2 = hexToBin('bbbb');
        const mainCommitment = binToHex(new Uint8Array([0x00, 0x02, 0x00, 0x01, ...hash256(new Uint8Array([...data1, ...data2])), ...data1]));
        const mainToken = { category: instance, amount: 0n, nft: { capability: 'mutable' as const, commitment: mainCommitment } };
        const dataToken = { category: instance, amount: 0n, nft: { capability: 'none' as const, commitment: binToHex(data2) } };

        // Both instance NFTs are minted straight to the attacker, in one transaction as data() expects.
        const genesis = provider.addUtxo(attacker.tokenAddress, randomUtxo({ vout: 0, satoshis: 100_000n, txid: instance }));
        await new TransactionBuilder({ provider })
            .addInput(genesis, attacker.signatureTemplate.unlockP2PKH())
            .addOutputs([
                { to: attacker.tokenAddress, amount: 1000n, token: mainToken },
                { to: attacker.tokenAddress, amount: 1000n, token: dataToken },
                { to: attacker.tokenAddress, amount: 90_000n },
            ])
            .send();

        const utxos = await provider.getUtxos(attacker.tokenAddress);
        const mainUtxo = utxos.find(u => u.token?.nft?.capability === 'mutable')!;
        const dataUtxo = utxos.find(u => u.token?.nft?.capability === 'none')!;
        // The fee comes from an anyone-can-spend (OP_TRUE) input: nothing is signed, so the spend means
        // the same whichever address the NFTs are taken to be spent from.
        const anyoneCanSpend = '51';
        const funding = provider.addUtxo(anyoneCanSpend, randomUtxo({ satoshis: 10_000n }));

        // proof() returns both NFTs to the address they were spent from. The unlockers carry no contract,
        // so cashscript does not check them against where the UTXOs are.
        const custom = ({ generateUnlockingBytecode }: Unlocker): Unlocker => ({ generateUnlockingBytecode });
        const proofAt = (address: string) => new TransactionBuilder({ provider })
            .addInput(mainUtxo, custom(instanceVault.unlock.proof()))
            .addInput(dataUtxo, custom(instanceVault.unlock.data()))
            .addInput(funding, { generateUnlockingBytecode: () => new Uint8Array() })
            .addOutputs([
                { to: address, amount: 1000n, token: mainToken },
                { to: address, amount: 1000n, token: dataToken },
                { to: attacker.tokenAddress, amount: 8_000n },
            ]);

        // Control: the same spend is valid for NFTs held at the vault, so only the address differs.
        const vaultLockingBytecode = lockingBytecodeHexOf(instanceVault.tokenAddress);
        expect(verifyTransaction(proofAt(instanceVault.tokenAddress), [vaultLockingBytecode, vaultLockingBytecode, anyoneCanSpend])).toBe(true);

        // Spent from where they really are, the attacker's address.
        expect(verifyTransaction(proofAt(attacker.tokenAddress))).not.toBe(true);
    });
});
