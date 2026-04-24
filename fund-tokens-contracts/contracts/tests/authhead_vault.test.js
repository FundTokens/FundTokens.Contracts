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

import systemUnderTestJson from '@lib/art/authhead_vault.json' with { type: 'json' };

import 'cashscript/vitest';

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
            commitment: '',
        }
    });

    const utxoUnderTest = randomUtxo({ satoshis: 10000n, token: randomToken() });
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
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount
                },
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

    it('should ensure authorized user released', ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.release())
            .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                },
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: utxoUnderTest.token,
                }
            ]);
        expect(transaction).toFailRequireWith("unauthorized user");
    });

    it('should ensure authhead contains no tokens', ({ expect }) => {
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
        expect(transaction).toFailRequireWith("no token allowed on authhead");
    });

    it('should ensure input is first to keep separate', ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
        .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
        .addInput(utxoUnderTest, systemUnderTest.unlock.release())
            .addOutputs([
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                },
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: utxoUnderTest.token,
                }
            ]);
        expect(transaction).toFailRequireWith("expected to be the first input");
    });
});