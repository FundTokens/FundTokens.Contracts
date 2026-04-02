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
    cashAddressToLockingBytecode,
} from '@bitauth/libauth';

import { generateWallet } from '@/wallet.js';
import { DustAmount } from '@lib/constants.js';

import systemUnderTestJson from '@lib/art/simple_minter.json' with { type: 'json' };

import 'cashscript/vitest';

describe('Testing the SimpleMinter Contract', () => {
    const network = Network.MOCKNET;

    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });

    const ownerWallet = generateWallet(network);
    const destinationWallet = generateWallet(network);
    const anonWallet = generateWallet(network);

    const authToken = randomToken({
        nft: {
            capability: 'none',
            commitment: '',
        }
    });
    const tokenUnderTest = randomToken({
        amount: 0n,
        nft: {
            capability: 'minting',
            commitment: '',
        }
    });

    const authUtxo = randomUtxo({ satoshis: DustAmount, token: authToken });
    const utxoUnderTest = randomUtxo({ satoshis: DustAmount, token: tokenUnderTest });
    const bitcoinUtxo = randomUtxo({ satoshis: 10000n });

    const systemUnderTest = new Contract(systemUnderTestJson, [swapEndianness(authToken.category), swapEndianness(tokenUnderTest.category), cashAddressToLockingBytecode(destinationWallet.address).bytecode], { provider });

    provider.addUtxo(ownerWallet.tokenAddress, authUtxo);
    provider.addUtxo(ownerWallet.tokenAddress, bitcoinUtxo);
    provider.addUtxo(systemUnderTest.tokenAddress, utxoUnderTest);

    it('should mint to destination', ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.mint())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutput({
                to: systemUnderTest.tokenAddress,
                amount: DustAmount,
                token: {
                    category: tokenUnderTest.category,
                    amount: 0n,
                    nft: {
                        capability: 'minting',
                        commitment: '',
                    }
                }
            })
            .addOutput({
                to: destinationWallet.address,
                amount: DustAmount,
                token: {
                    category: tokenUnderTest.category,
                    amount: 0n,
                    nft: {
                        capability: 'minting',
                        commitment: '',
                    }
                }
            })
            .addOutput({
                to: ownerWallet.address,
                amount: DustAmount,
                token: authUtxo.token,
            });
        expect(transaction).not.toFailRequire();
    });

    it('should ensure unable to mint anywhere else', ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.mint())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutput({
                to: systemUnderTest.tokenAddress,
                amount: DustAmount,
                token: {
                    category: tokenUnderTest.category,
                    amount: 0n,
                    nft: {
                        capability: 'minting',
                        commitment: '',
                    }
                }
            })
            .addOutput({
                to: anonWallet.address,
                amount: DustAmount,
                token: {
                    category: tokenUnderTest.category,
                    amount: 0n,
                    nft: {
                        capability: 'minting',
                        commitment: '',
                    }
                }
            })
            .addOutput({
                to: ownerWallet.address,
                amount: DustAmount,
                token: authUtxo.token,
            });
        expect(transaction).toFailRequire();
    });

    it('should ensure auth token is spent', ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.mint())
            .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutput({
                to: systemUnderTest.tokenAddress,
                amount: DustAmount,
                token: {
                    category: tokenUnderTest.category,
                    amount: 0n,
                    nft: {
                        capability: 'minting',
                        commitment: '',
                    }
                }
            })
            .addOutput({
                to: destinationWallet.address,
                amount: DustAmount,
                token: {
                    category: tokenUnderTest.category,
                    amount: 0n,
                    nft: {
                        capability: 'minting',
                        commitment: '',
                    }
                }
            })
            .addOutput({
                to: ownerWallet.address,
                amount: DustAmount,
            });
        expect(transaction).toFailRequire();
    });
});