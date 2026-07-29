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
    bigIntToVmNumber,
    binToHex,
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

    const authUtxo = randomUtxo({ satoshis: DustAmount, token: authToken });
    const utxoUnderTest = randomUtxo({ satoshis: DustAmount, token: tokenUnderTest });
    const bitcoinUtxo = randomUtxo({ satoshis: 10000n });

    const systemUnderTest = new Contract(systemUnderTestJson, [swapEndianness(authToken.category), swapEndianness(tokenUnderTest.category), cashAddressToLockingBytecode(destinationWallet.address).bytecode], { provider });

    provider.addUtxo(ownerWallet.tokenAddress, authUtxo);
    provider.addUtxo(ownerWallet.tokenAddress, bitcoinUtxo);
    provider.addUtxo(systemUnderTest.tokenAddress, utxoUnderTest);

    test.each(['0001', '00FF'])('should allow authorized roles to mint to destination', role => {
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
            .addTokenChangeOutputIfNeeded({ to: ownerWallet.tokenAddress, category: authUtxo.token.category })
            .addBchChangeOutputIfNeeded({ to: ownerWallet.address, feeRate: 2 });
        await transaction.send();
    });
});