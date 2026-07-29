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
    binToHex,
    cashAddressToLockingBytecode,
    bigIntToBinUint64LEClamped,
} from '@bitauth/libauth';

import { generateWallet } from '@/wallet.js';

import systemUnderTestJson from '@lib/art/fee_minter.json' with { type: 'json' };

const DustAmount = 1000n;

describe(`System Under Test: ${systemUnderTestJson.contractName} Contract`, () => {
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
            commitment: '0100FF',
        }
    });
    const tokenUnderTest = randomToken({
        amount: 0n,
        nft: {
            capability: 'minting',
            commitment: '0001',
        }
    });
    const utxoUnderTest = randomUtxo({ satoshis: DustAmount, token: tokenUnderTest });
    const authUtxo = randomUtxo({ satoshis: DustAmount, token: authToken });
    const bitcoinUtxo = randomUtxo({ satoshis: 10000n });

    const systemUnderTest = new Contract(systemUnderTestJson, [swapEndianness(authToken.category), swapEndianness(tokenUnderTest.category), cashAddressToLockingBytecode(destinationWallet.address).bytecode], { provider });

    provider.addUtxo(systemUnderTest.tokenAddress, utxoUnderTest);
    provider.addUtxo(ownerWallet.tokenAddress, authUtxo);
    provider.addUtxo(ownerWallet.tokenAddress, bitcoinUtxo);

    const newFeeToken = randomToken();

    it('should mint to destination', ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.mint())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: tokenUnderTest
                },
                {
                    to: destinationWallet.tokenAddress,
                    amount: DustAmount,
                    token: {
                        category: tokenUnderTest.category,
                        amount: 0n,
                        nft: {
                            capability: 'none',
                            commitment: '01' + newFeeToken.category + binToHex(bigIntToBinUint64LEClamped(1000n)),
                        }
                    }
                },
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: authUtxo.token,
                }
            ]);
        expect(transaction).not.toFailRequire();
    });

    test.each(['00FF', '00F0', '0010'])('should mint to destination', role => {
        const wallet = generateWallet({ network });
        const utxo = randomUtxo({
            satoshis: 10000n,
            token: {
                category: authToken.category,
                amount: 0n,
                nft: {
                    capability: 'none',
                    commitment: '01' + role
                }
            }
        });
        provider.addUtxo(wallet.tokenAddress, utxo);
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.mint())
            .addInput(utxo, wallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: tokenUnderTest
                },
                {
                    to: destinationWallet.tokenAddress,
                    amount: DustAmount,
                    token: {
                        category: tokenUnderTest.category,
                        amount: 0n,
                        nft: {
                            capability: 'none',
                            commitment: '01' + newFeeToken.category + binToHex(bigIntToBinUint64LEClamped(1000n)),
                        }
                    }
                },
                {
                    to: wallet.tokenAddress,
                    amount: DustAmount,
                    token: utxo.token,
                }
            ]);
        expect(transaction).not.toFailRequire();
    });

    it('should mint to destination with encoded destination', ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.mint())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: tokenUnderTest
                },
                {
                    to: destinationWallet.tokenAddress,
                    amount: DustAmount,
                    token: {
                        category: tokenUnderTest.category,
                        amount: 0n,
                        nft: {
                            capability: 'none',
                            commitment: '01' + newFeeToken.category + binToHex(bigIntToBinUint64LEClamped(1000n)) + binToHex(cashAddressToLockingBytecode(ownerWallet.address).bytecode),
                        }
                    }
                },
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: authUtxo.token,
                }
            ]);
        expect(transaction).not.toFailRequire();
    });

    it('should ensure unable to mint anywhere else', ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.mint())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: tokenUnderTest
                },
                {
                    to: anonWallet.tokenAddress,
                    amount: DustAmount,
                    token: {
                        category: tokenUnderTest.category,
                        amount: 0n,
                        nft: {
                            capability: 'none',
                            commitment: '01' + newFeeToken.category + binToHex(bigIntToBinUint64LEClamped(1000n)),
                        }
                    }
                },
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: authUtxo.token,
                }
            ]);
        expect(transaction).toFailRequire();
    });

    it('should ensure the owner approves the tx', ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.mint())
            .addInput(bitcoinUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: tokenUnderTest
                },
                {
                    to: destinationWallet.tokenAddress,
                    amount: DustAmount,
                    token: {
                        category: tokenUnderTest.category,
                        amount: 0n,
                        nft: {
                            capability: 'none',
                            commitment: '01' + newFeeToken.category + binToHex(bigIntToBinUint64LEClamped(1000n)),
                        }
                    }
                },
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                }
            ]);
        expect(transaction).toFailRequire();
    });

    test.each(['0001', '000F'])('should ensure the correct role', role => {
        const wallet = generateWallet({ network });
        const utxo = randomUtxo({
            satoshis: 10000n,
            token: {
                category: authToken.category,
                amount: 0n,
                nft: {
                    capability: 'none',
                    commitment: '00' + role
                }
            }
        });
        provider.addUtxo(wallet.tokenAddress, utxo);
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxoUnderTest, systemUnderTest.unlock.mint())
            .addInput(utxo, wallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: tokenUnderTest
                },
                {
                    to: destinationWallet.tokenAddress,
                    amount: DustAmount,
                    token: {
                        category: tokenUnderTest.category,
                        amount: 0n,
                        nft: {
                            capability: 'none',
                            commitment: '01' + newFeeToken.category + binToHex(bigIntToBinUint64LEClamped(1000n)),
                        }
                    }
                },
                {
                    to: wallet.tokenAddress,
                    amount: DustAmount,
                    token: utxo.token,
                }
            ]);
        expect(transaction).toFailRequire("unauthorized user");
    });
});