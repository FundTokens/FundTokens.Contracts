/**
 * Audit finding: InstanceVault.update() has no authorization check. Anyone can change the
 * instance state byte, e.g. mark the main instance "vulnerable" or clear that mark, defeating
 * the vulnerability signal (docs/fund-types/fixed-basket/v1/TOKENS.md).
 *
 * The contracts must reject a state change made without the authorization token.
 */
import { binToHex, hash256, hexToBin, swapEndianness } from '@bitauth/libauth';
import { Contract, MockNetworkProvider, TransactionBuilder, randomUtxo } from 'cashscript';

import { randomCategory } from '@test-utils/random.js';
import { generateWallet } from '@test-utils/wallet.js';

import instanceVaultArtifact from '../artifacts/instance_vault.js';

const StateMain = 0x02;
const StateVulnerable = 0x08;

describe('audit: InstanceVault.update() state change without authorization', () => {
    it('rejects an instance state change with no authorization token in the transaction', async () => {
        const provider = new MockNetworkProvider({ updateUtxoSet: true });
        const owner = generateWallet();
        const instance = randomCategory();
        const instanceVault = new Contract(instanceVaultArtifact, [swapEndianness(instance), swapEndianness(randomCategory())], { provider });

        // Instance commitment: type (1) | state (1) | version (2) | hash (32) | data...
        const data1 = hexToBin('aaaa');
        const data2 = hexToBin('bbbb');
        const mainCommitment = new Uint8Array([0x00, StateMain, 0x01, 0x00, ...hash256(new Uint8Array([...data1, ...data2])), ...data1]);
        const mainToken = (commitment: Uint8Array) =>
            ({ category: instance, amount: 0n, nft: { capability: 'mutable' as const, commitment: binToHex(commitment) } });
        const dataToken = { category: instance, amount: 0n, nft: { capability: 'none' as const, commitment: binToHex(data2) } };

        // Both instance UTXOs come from one transaction, as data() requires.
        const genesis = provider.addUtxo(owner.tokenAddress, randomUtxo({ vout: 0, satoshis: 100_000n, txid: instance }));
        await new TransactionBuilder({ provider })
            .addInput(genesis, owner.signatureTemplate.unlockP2PKH())
            .addOutputs([
                { to: instanceVault.tokenAddress, amount: 1000n, token: mainToken(mainCommitment) },
                { to: instanceVault.tokenAddress, amount: 1000n, token: dataToken },
                { to: owner.tokenAddress, amount: 90_000n },
            ])
            .send();

        const utxos = await instanceVault.getUtxos();
        const mainUtxo = utxos.find(u => u.token?.nft?.capability === 'mutable')!;
        const dataUtxo = utxos.find(u => u.token?.nft?.capability === 'none')!;

        const flagged = mainCommitment.slice();
        flagged[1] = StateVulnerable;

        const update = new TransactionBuilder({ provider })
            .addInput(mainUtxo, instanceVault.unlock.update())
            .addInput(dataUtxo, instanceVault.unlock.data())
            .addOutputs([
                { to: instanceVault.tokenAddress, amount: 1000n, token: mainToken(flagged) },
                { to: instanceVault.tokenAddress, amount: 1000n, token: dataToken },
            ]);

        await expect(update).toBeRejected();
        const main = (await instanceVault.getUtxos()).find(u => u.token?.nft?.capability === 'mutable')!;
        expect(main.token!.nft!.commitment).toBe(binToHex(mainCommitment));
    });
});
