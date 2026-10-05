import { test } from 'vitest';

import {
    MockNetworkProvider,
    Network,
    randomToken,
    TransactionBuilder,
    Contract,
} from 'cashscript';
import {
    swapEndianness,
} from '@bitauth/libauth';

import { generateWallet } from '@test-utils/wallet.js';
import { randomUtxo } from '@test-utils/random.js';

import systemUnderTestJson from '../../artifacts/simple_vault.js';


const DustAmount = 1000n;

// release() is only the authority check, so it fails as the final statement, which cashscript names
// but cannot attach its "unauthorized user" message to when the check is a function call.
const Unauthorized = 'Failing statement: hasAuthority(authToken, 0x0002)';

describe(`System Under Test: ${systemUnderTestJson.contractName} Contract`, () => {
    const network = Network.MOCKNET;

    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });

    const ownerWallet = generateWallet();

    const authToken = randomToken({
        nft: {
            capability: 'none',
            commitment: '0100FF',
        }
    });

    const authUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ satoshis: DustAmount, token: authToken }));
    const bitcoinUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ satoshis: 10000n }));

    const systemUnderTest = new Contract(systemUnderTestJson, [swapEndianness(authToken.category)], { provider });

    const utxoUnderTest = provider.addUtxo(systemUnderTest.tokenAddress, randomUtxo({ satoshis: 10000n, token: randomToken() }));
    const additionalUtxosUnderTest = [provider.addUtxo(systemUnderTest.tokenAddress, randomUtxo({ satoshis: 1000n })), provider.addUtxo(systemUnderTest.tokenAddress, randomUtxo({ satoshis: 1000n }))];

    it('should allow authorized user to release', ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.release())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: authUtxo.token,
                },
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: utxoUnderTest.token,
                }
            ]);
        expect(transaction).not.toFailRequire();
    });

    it('should allow multiple UTXOs to be released', () => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.release())
            .addInputs(additionalUtxosUnderTest, systemUnderTest.unlock.verify())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: authUtxo.token,
                },
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: utxoUnderTest.token,
                }
            ]);
        expect(transaction).not.toFailRequire();
    });

    test.each(['000F', '0002'])('should allow authorized roles to release', role => {
        const wallet = generateWallet();
        const utxo = provider.addUtxo(wallet.tokenAddress, randomUtxo({
            satoshis: 10000n,
            token: {
                category: authToken.category,
                amount: 0n,
                nft: {
                    capability: 'none',
                    commitment: '01' + role
                }
            }
        }));
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.release())
            .addInput(utxo, wallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: wallet.tokenAddress,
                    amount: DustAmount,
                    token: utxo.token,
                },
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: utxoUnderTest.token,
                }
            ]);
        expect(transaction).not.toFailRequire();
    });

    test.each(['0001', '01FD'])('should ensure authorized roles', role => {
        const wallet = generateWallet();
        const utxo = provider.addUtxo(wallet.tokenAddress, randomUtxo({
            satoshis: 10000n,
            token: {
                category: authToken.category,
                amount: 0n,
                nft: {
                    capability: 'none',
                    commitment: '01' + role
                }
            }
        }));
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.release())
            .addInput(utxo, wallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: wallet.tokenAddress,
                    amount: DustAmount,
                    token: utxo.token,
                },
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: utxoUnderTest.token,
                }
            ]);
        expect(transaction).toFailRequireWith(Unauthorized);
    });

    it('should ensure authorized user released', ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.release())
            .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: utxoUnderTest.token,
                }
            ]);
        expect(transaction).toFailRequireWith(Unauthorized);
    });
});