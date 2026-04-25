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

    const authToken = randomToken({
        amount: 0n,
        nft: {
            capability: 'none',
            commitment: '02', // authhead role
        }
    });

    const utxoUnderTest = randomUtxo({ satoshis: 10000n, vout: 0 });
    const authUtxo = randomUtxo({ satoshis: DustAmount, token: authToken });
    const bitcoinUtxo = randomUtxo({ satoshis: 10000n });

    const systemUnderTest = new Contract(systemUnderTestJson, [swapEndianness(authToken.category)], { provider });

    provider.addUtxo(systemUnderTest.tokenAddress, utxoUnderTest);
    provider.addUtxo(ownerWallet.tokenAddress, authUtxo);
    provider.addUtxo(ownerWallet.tokenAddress, bitcoinUtxo);

    it('should allow authorized user to release as authhead', ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.release())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount
                },
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: authUtxo.token,
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
                category: authToken.category,
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
            .addInput(utxoUnderTest, systemUnderTest.unlock.release())
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
            .addInput(utxoUnderTest, systemUnderTest.unlock.release())
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
                category: authToken.category,
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
            .addInput(utxoUnderTest, systemUnderTest.unlock.release())
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


    it('should ensure authhead contains no tokens', ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.release())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: authUtxo.token,
                }
            ]);
        expect(transaction).toFailRequireWith("no token allowed on authhead");
    });

    it('should ensure input is first to keep separate', ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
        .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
        .addInput(utxoUnderTest, systemUnderTest.unlock.release())
        .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
        .addOutputs([
            {
                to: systemUnderTest.tokenAddress,
                amount: DustAmount,
            },
            {
                to: ownerWallet.tokenAddress,
                amount: DustAmount,
                token: authUtxo.token,
            }
        ]);
        expect(transaction).toFailRequireWith("expected to be the first input");
    });
});