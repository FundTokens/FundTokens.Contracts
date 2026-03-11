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

    const wallet = generateWallet(network);
    const secondaryWallet = generateWallet(network);

    const token = randomToken({
        amount: 0n,
        nft: {
            capability: 'minting',
            commitment: '',
        }
    });
    const utxo = randomUtxo({ token });

    const systemUnderTest = new Contract(systemUnderTestJson, [wallet.pubKeyHex, swapEndianness(token.category), cashAddressToLockingBytecode(wallet.address).bytecode], { provider });

    provider.addUtxo(systemUnderTest.tokenAddress, utxo);

    const standardDestinationOutput = {
        to: wallet.address,
        amount: DustAmount,
        token: {
            category: token.category,
            amount: 0n,
            nft: {
                capability: 'minting',
                commitment: '',
            }
        }
    }

    it('should mint to destination', async () => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxo, systemUnderTest.unlock.mint(wallet.signatureTemplate))
            .addOutput({
                to: systemUnderTest.tokenAddress,
                amount: DustAmount,
                token: {
                    category: token.category,
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
                token: {
                    category: token.category,
                    amount: 0n,
                    nft: {
                        capability: 'minting',
                        commitment: '',
                    }
                }
            })
            .addOutput({
                to: secondaryWallet.address,
                amount: DustAmount,
            });
        expect(transaction).not.toFailRequire();
        await transaction.send();
    });

    it('should ensure unable to mint anywhere else', async () => {
        const expectedToFailOutput = {
            ...standardDestinationOutput,
            to: secondaryWallet.address,
        };
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxo, systemUnderTest.unlock.mint(wallet.signatureTemplate))
            .addOutput({
                to: systemUnderTest.tokenAddress,
                amount: DustAmount,
                token: {
                    category: token.category,
                    amount: 0n,
                    nft: {
                        capability: 'minting',
                        commitment: '',
                    }
                }
            })
            .addOutput({
                to: secondaryWallet.address,
                amount: DustAmount,
                token: {
                    category: token.category,
                    amount: 0n,
                    nft: {
                        capability: 'minting',
                        commitment: '',
                    }
                }
            });
        expect(transaction).toFailRequire();
        transaction.outputs.pop();
        transaction.addOutput({ ...standardDestinationOutput });
        expect(transaction).not.toFailRequire();
        transaction.addOutput({ ...expectedToFailOutput});
        expect(transaction).toFailRequire();
    });

    it('should ensure the owner approves the tx', async () => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxo, systemUnderTest.unlock.mint(secondaryWallet.signatureTemplate))
            .addOutput({
                to: systemUnderTest.tokenAddress,
                amount: DustAmount,
                token: {
                    category: token.category,
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
                token: {
                    category: token.category,
                    amount: 0n,
                    nft: {
                        capability: 'minting',
                        commitment: '',
                    }
                }
            });
        expect(transaction).toFailRequire();
    });
});