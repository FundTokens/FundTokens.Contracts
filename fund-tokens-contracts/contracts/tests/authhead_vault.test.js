import { test } from 'vitest';
import 'cashscript/vitest';

import {
    MockNetworkProvider,
    Network,
    randomToken,
    randomUtxo,
    TransactionBuilder,
    Contract,
} from 'cashscript';
import {
    bigIntToBinUint64LEClamped,
    binToHex,
    swapEndianness,
    utf8ToBin,
} from '@bitauth/libauth';

import { generateWallet } from '@/wallet.js';

import systemUnderTestJson from '@lib/art/authhead_vault.json' with { type: 'json' };

const DustAmount = 1000n;

describe(`System Under Test: ${systemUnderTestJson.contractName} Contract`, () => {
    const network = Network.MOCKNET;

    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });

    const ownerWallet = generateWallet(network);

    const updateAuthToken = randomToken({
        amount: 0n,
        nft: {
            capability: 'none',
            commitment: '02', // authhead update role
        }
    });

    const burnAuthToken = randomToken({
        category: updateAuthToken.category,
        amount: 0n,
        nft: {
            capability: 'none',
            commitment: '20', // authhead burn role
        }
    });

    const utxoUnderTest = randomUtxo({ satoshis: 10000n, vout: 0 });
    const updateAuthUtxo = randomUtxo({ satoshis: DustAmount, token: updateAuthToken });
    const burnAuthUtxo = randomUtxo({ satoshis: DustAmount, token: burnAuthToken });
    const bitcoinUtxo = randomUtxo({ satoshis: 10000n });

    const systemUnderTest = new Contract(systemUnderTestJson, [swapEndianness(updateAuthToken.category)], { provider });

    console.log('testing authhead', burnAuthToken, burnAuthUtxo);

    provider.addUtxo(systemUnderTest.tokenAddress, utxoUnderTest);
    provider.addUtxo(ownerWallet.tokenAddress, updateAuthUtxo);
    provider.addUtxo(ownerWallet.tokenAddress, burnAuthUtxo);
    provider.addUtxo(ownerWallet.tokenAddress, bitcoinUtxo);

    it('should allow authorized user to update as authhead', ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.update())
            .addInput(updateAuthUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount
                },
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: updateAuthUtxo.token,
                }
            ])
            .addBchChangeOutputIfNeeded({ to: ownerWallet.tokenAddress, feeRate: 1 });
        expect(transaction).not.toFailRequire();
    });

    test.each(['FF', '02', '0F'])('should allow an authorized role to release', (role) => {
        const wallet = generateWallet({ network });
        const utxo = randomUtxo({
            satoshis: 10000n,
            token: {
                category: updateAuthToken.category,
                amount: 0n,
                nft: {
                    capability: 'none',
                    commitment: role
                }
            }
        });
        provider.addUtxo(wallet.tokenAddress, utxo);
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.update())
            .addInput(utxo, wallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount
                },
                {
                    to: wallet.tokenAddress,
                    amount: DustAmount,
                    token: utxo.token,
                }
            ])
            .addBchChangeOutputIfNeeded({ to: wallet.tokenAddress, feeRate: 1 });
        expect(transaction).not.toFailRequire();
    });

    it('should ensure user is an authorized user', ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.update())
            .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                }
            ])
            .addBchChangeOutputIfNeeded({ to: ownerWallet.tokenAddress, feeRate: 1 });
        expect(transaction).toFailRequireWith("unauthorized user");
    });

    test.each(['01', '04'])('should ensure user has an authorized role', (role) => {
        const wallet = generateWallet({ network });
        const utxo = randomUtxo({
            satoshis: 10000n,
            token: {
                category: updateAuthToken.category,
                amount: 0n,
                nft: {
                    capability: 'none',
                    commitment: role
                }
            }
        });
        provider.addUtxo(wallet.tokenAddress, utxo);
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.update())
            .addInput(utxo, wallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                }
            ])
            .addBchChangeOutputIfNeeded({ to: wallet.tokenAddress, feeRate: 1 });
        expect(transaction).toFailRequireWith("unauthorized user");
    });


    it('should ensure authhead contains no tokens', () => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.update())
            .addInput(updateAuthUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: updateAuthUtxo.token,
                }
            ]);
        expect(transaction).toFailRequireWith("no token allowed on authhead");
    });

    it('should ensure input is first to keep separate', () => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInput(utxoUnderTest, systemUnderTest.unlock.update())
            .addInput(updateAuthUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                },
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: updateAuthUtxo.token,
                }
            ]);
        expect(transaction).toFailRequireWith("expected to be the first input");
    });

    it('should allow burning identities', () => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInput(utxoUnderTest, systemUnderTest.unlock.burn())
            .addInput(burnAuthUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOpReturnOutput([])
            .addOutputs([
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: burnAuthUtxo.token,
                }
            ]);
        expect(transaction).not.toFailRequire();
    });

    it('requires identity burning', () => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInput(utxoUnderTest, systemUnderTest.unlock.burn())
            .addInput(burnAuthUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                },
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: burnAuthUtxo.token,
                }
            ]);
        expect(transaction).toFailRequireWith("first output must be an OP_RETURN");
    });
});