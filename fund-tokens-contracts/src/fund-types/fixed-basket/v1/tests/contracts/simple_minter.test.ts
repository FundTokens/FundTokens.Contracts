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
    cashAddressToLockingBytecode,
    bigIntToVmNumber,
    binToHex,
} from '@bitauth/libauth';
import { generateWallet } from '@test-utils/wallet.js';
import { randomUtxo } from '@test-utils/random.js';
import systemUnderTestJson from '../../artifacts/simple_minter.js';

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
            commitment: '0100FF01',
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

    test.each(['0001', '00FF'])('should allow authorized roles to mint to destination', role => {
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
            .addOutput({
                to: systemUnderTest.tokenAddress,
                amount: DustAmount,
                token: {
                    category: tokenUnderTest.category,
                    amount: 0n,
                    nft: {
                        capability: 'minting',
                        commitment: '0002',
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
                        commitment: '0101',
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

    test.each(['0002', '00F0'])('ensure authorization role', role => {
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
            .addOutput({
                to: systemUnderTest.tokenAddress,
                amount: DustAmount,
                token: {
                    category: tokenUnderTest.category,
                    amount: 0n,
                    nft: {
                        capability: 'minting',
                        commitment: '0002',
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
                        commitment: '0101',
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
                        commitment: '0002',
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
                        commitment: '0101',
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
                        commitment: '0002',
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
                        commitment: '0101',
                    }
                }
            })
            .addOutput({
                to: ownerWallet.address,
                amount: DustAmount,
            });
        expect(transaction).toFailRequire();
    });

    it('should mint to destination', async ({ expect }) => {
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
                        commitment: '0002',
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
                        commitment: '0101',
                    }
                }
            })
            .addOutput({
                to: ownerWallet.tokenAddress,
                amount: DustAmount,
                token: authUtxo.token,
            })
            .addBchChangeOutputIfNeeded({ to: ownerWallet.address, feeRate: 2 });
        await transaction.send();
    });

    it('should increment serial number', async ({ expect }) => {
        const utxosUnderTest = await systemUnderTest.getUtxos();
        const utxoUnderTest = utxosUnderTest[0];
        const ownerUtxos = await provider.getUtxos(ownerWallet.tokenAddress);
        const authUtxo = ownerUtxos.filter(u => u.token?.category === authToken.category)[0];
        const bitcoinUtxo = ownerUtxos.filter(u => !u.token)[0];
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
                        commitment: '0004',
                    }
                }
            })
            .addOutputs(
                [
                    {
                        to: destinationWallet.address,
                        amount: DustAmount,
                        token: {
                            category: tokenUnderTest.category,
                            amount: 0n,
                            nft: {
                                capability: 'minting',
                                commitment: '0102',
                            }
                        }
                    },
                    {
                        to: destinationWallet.address,
                        amount: DustAmount,
                        token: {
                            category: tokenUnderTest.category,
                            amount: 0n,
                            nft: {
                                capability: 'minting',
                                commitment: '0103',
                            }
                        }
                    }
                ])
            .addTokenChangeOutputIfNeeded({ to: ownerWallet.tokenAddress, category: authUtxo.token!.category })
            .addBchChangeOutputIfNeeded({ to: ownerWallet.address, feeRate: 2 });
        await transaction.send();
    });

    describe('fungible tokens', () => {
        /** mint() returning the minting NFT with `kept` tokens and minting an NFT carrying `minted`. */
        const mint = ({ kept = 0n, minted = 0n }) => {
            const funding = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ satoshis: 10000n }));
            const transaction = new TransactionBuilder({ provider });
            transaction
                .addInput(utxoUnderTest, systemUnderTest.unlock.mint())
                .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
                .addInput(funding, ownerWallet.signatureTemplate.unlockP2PKH())
                .addOutput({
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: { category: tokenUnderTest.category, amount: kept, nft: { capability: 'minting', commitment: '0002' } },
                })
                .addOutput({
                    to: destinationWallet.address,
                    amount: DustAmount,
                    token: { category: tokenUnderTest.category, amount: minted, nft: { capability: 'minting', commitment: '0101' } },
                })
                .addOutput({ to: ownerWallet.tokenAddress, amount: DustAmount, token: authUtxo.token });
            return transaction;
        };

        it('mints NFTs without them (control)', ({ expect }) => {
            expect(mint({})).not.toFailRequire();
        });

        it('rejects minting an NFT carrying them', ({ expect }) => {
            expect(mint({ minted: 5n })).toFailRequireWith('tokenAmount == 0');
        });

        it('rejects minting them onto its own minting NFT', ({ expect }) => {
            expect(mint({ kept: 5n })).toFailRequireWith('tokenAmount == tx.outputs[this.activeInputIndex].tokenAmount');
        });
    });
});
