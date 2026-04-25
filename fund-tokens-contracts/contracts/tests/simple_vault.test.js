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
    swapEndianness,
} from '@bitauth/libauth';

import { generateWallet } from '@/wallet.js';

import systemUnderTestJson from '@lib/art/simple_vault.json' with { type: 'json' };


const DustAmount = 1000n;

describe(`System Under Test: ${systemUnderTestJson.contractName} Contract`, () => {
    const network = Network.MOCKNET;

    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });

    const ownerWallet = generateWallet(network);

    const authToken = randomToken({
        nft: {
            capability: 'none',
            commitment: 'FF',
        }
    });

    const utxoUnderTest = randomUtxo({ satoshis: 10000n, token: randomToken() });
    const authUtxo = randomUtxo({ satoshis: DustAmount, token: authToken });
    const bitcoinUtxo = randomUtxo({ satoshis: 10000n });

    const systemUnderTest = new Contract(systemUnderTestJson, [swapEndianness(authToken.category)], { provider });

    provider.addUtxo(systemUnderTest.tokenAddress, utxoUnderTest);
    provider.addUtxo(ownerWallet.tokenAddress, authUtxo);
    provider.addUtxo(ownerWallet.tokenAddress, bitcoinUtxo);

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

    test.each(['F0', '80'])('should allow authorized roles to release', role => {
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
            .addInput(utxo, ownerWallet.signatureTemplate.unlockP2PKH())
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

    test.each(['40', '7F'])('should ensure authorized roles', role => {
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
            .addInput(utxo, ownerWallet.signatureTemplate.unlockP2PKH())
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
        expect(transaction).toFailRequire('unauthorized user');
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
        expect(transaction).toFailRequireWith("unauthorized user");
    });
});