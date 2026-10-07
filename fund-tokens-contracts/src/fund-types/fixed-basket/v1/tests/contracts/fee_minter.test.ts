import { test } from 'vitest';

import {
    MockNetworkProvider,
    Network,
    randomToken,
    TransactionBuilder,
    Contract,
} from 'cashscript';
import {
    assertSuccess,
    swapEndianness,
    binToHex,
    cashAddressToLockingBytecode,
    bigIntToBinUint64LEClamped,
} from '@bitauth/libauth';

import { generateWallet } from '@test-utils/wallet.js';
import { randomUtxo } from '@test-utils/random.js';

import systemUnderTestJson from '../../artifacts/fee_minter.js';

const DustAmount = 1000n;

describe(`System Under Test: ${systemUnderTestJson.contractName} Contract`, () => {
    const network = Network.MOCKNET;

    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });

    const ownerWallet = generateWallet();
    const destinationWallet = generateWallet();
    const anonWallet = generateWallet();

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
    const authUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ satoshis: DustAmount, token: authToken }));
    const bitcoinUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ satoshis: 10000n }));

    const systemUnderTest = new Contract(systemUnderTestJson, [swapEndianness(authToken.category), swapEndianness(tokenUnderTest.category), assertSuccess(cashAddressToLockingBytecode(destinationWallet.address)).bytecode], { provider });

    const utxoUnderTest = provider.addUtxo(systemUnderTest.tokenAddress, randomUtxo({ satoshis: DustAmount, token: tokenUnderTest }));

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
                            commitment: '01' + newFeeToken.category + binToHex(bigIntToBinUint64LEClamped(1000n)) + binToHex(assertSuccess(cashAddressToLockingBytecode(ownerWallet.address)).bytecode),
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
        const wallet = generateWallet();
        const utxo = provider.addUtxo(wallet.tokenAddress, randomUtxo({
            satoshis: 10000n,
            token: {
                category: authToken.category,
                amount: 0n,
                nft: {
                    capability: 'none',
                    commitment: '00' + role
                }
            }
        }));
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
        expect(transaction).toFailRequireWith("unauthorized user");
    });

    describe('fungible tokens', () => {
        /** mint() returning the minting NFT with `kept` fee tokens and minting a fee NFT carrying `minted`. */
        const mint = ({ kept = 0n, minted = 0n }) => {
            const funding = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ satoshis: 10000n }));
            const transaction = new TransactionBuilder({ provider });
            transaction
                .addInput(utxoUnderTest, systemUnderTest.unlock.mint())
                .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
                .addInput(funding, ownerWallet.signatureTemplate.unlockP2PKH())
                .addOutputs([
                    { to: systemUnderTest.tokenAddress, amount: DustAmount, token: { ...tokenUnderTest, amount: kept } },
                    {
                        to: destinationWallet.tokenAddress,
                        amount: DustAmount,
                        token: {
                            category: tokenUnderTest.category,
                            amount: minted,
                            nft: { capability: 'none', commitment: '01' + newFeeToken.category + binToHex(bigIntToBinUint64LEClamped(1000n)) },
                        },
                    },
                    { to: ownerWallet.tokenAddress, amount: DustAmount, token: authUtxo.token },
                ]);
            return transaction;
        };

        it('mints fee NFTs without them (control)', ({ expect }) => {
            expect(mint({})).not.toFailRequire();
        });

        it('rejects minting a fee NFT carrying them', ({ expect }) => {
            expect(mint({ minted: 5n })).toFailRequireWith('tokenAmount == 0');
        });

        it('rejects minting them onto its own minting NFT', ({ expect }) => {
            expect(mint({ kept: 5n })).toFailRequireWith('tokenAmount == tx.outputs[this.activeInputIndex].tokenAmount');
        });
    });
});
