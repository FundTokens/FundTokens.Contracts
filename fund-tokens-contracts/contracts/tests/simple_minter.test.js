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
    cashAddressToLockingBytecode,
} from '@bitauth/libauth';

import { generateWallet } from '@/wallet.js';

import systemUnderTestJson from '@lib/art/simple_minter.json' with { type: 'json' };


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
            commitment: 'FF',
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

    test.each(['01', 'FF'])('should allow authorized roles to mint to destination', role => {
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
            .addInput(utxoUnderTest, systemUnderTest.unlock.mint())
            .addInput(utxo, wallet.signatureTemplate.unlockP2PKH())
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
                to: wallet.address,
                amount: DustAmount,
                token: utxo.token,
            });
        expect(transaction).not.toFailRequire();
    });

    test.each(['02', 'F0'])('ensure authorization role', role => {
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
            .addInput(utxoUnderTest, systemUnderTest.unlock.mint())
            .addInput(utxo, wallet.signatureTemplate.unlockP2PKH())
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
                to: wallet.address,
                amount: DustAmount,
                token: utxo.token,
            });
        expect(transaction).toFailRequire();
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