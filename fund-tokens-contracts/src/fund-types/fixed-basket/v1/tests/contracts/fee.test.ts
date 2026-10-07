import { test } from 'vitest';

import {
    MockNetworkProvider,
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

import systemUnderTestJson from '../../artifacts/fee.js';

const DustAmount = 1000n;

describe(`System Under Test: ${systemUnderTestJson.contractName} Contract`, () => {
    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });

    const ownerWallet = generateWallet();
    const userWallet = generateWallet();

    const authToken = randomToken({
        nft: {
            capability: 'none',
            commitment: '0100FF01'
        }
    });
    const payByToken = randomToken();
    const payByTokenAmount = 1000n;
    const contractToken = randomToken();
    const encodedDestination = userWallet.address;
    const defaultFeeAmount = 2000n;

    const systemUnderTest = new Contract(systemUnderTestJson, [swapEndianness(authToken.category), binToHex(assertSuccess(cashAddressToLockingBytecode(ownerWallet.tokenAddress)).bytecode), swapEndianness(contractToken.category), defaultFeeAmount], { provider });

    const authUtxo = provider.addUtxo(ownerWallet.tokenAddress, randomUtxo({ token: authToken }));

    const defaultFeeUtxo = provider.addUtxo(systemUnderTest.tokenAddress, randomUtxo());
    const encodedTokenFeeUtxo = provider.addUtxo(systemUnderTest.tokenAddress, randomUtxo({
        token: {
            category: contractToken.category,
            amount: 0n,
            nft: {
                capability: 'none',
                commitment: '01' + swapEndianness(payByToken.category) + binToHex(bigIntToBinUint64LEClamped(payByTokenAmount)),
            }
        }
    }));
    const encodedTokenFeeWithDestinationUtxo = provider.addUtxo(systemUnderTest.tokenAddress, randomUtxo({
        token: {
            category: contractToken.category,
            amount: 0n,
            nft: {
                capability: 'none',
                commitment: '01' + swapEndianness(payByToken.category) + binToHex(bigIntToBinUint64LEClamped(payByTokenAmount)) + binToHex(assertSuccess(cashAddressToLockingBytecode(encodedDestination)).bytecode),
            }
        }
    }));
    const encodedBitcoinFeeUtxo = provider.addUtxo(systemUnderTest.tokenAddress, randomUtxo({
        token: {
            category: contractToken.category,
            amount: 0n,
            nft: {
                capability: 'none',
                commitment: '01' + swapEndianness('0'.repeat(32 * 2)) + binToHex(bigIntToBinUint64LEClamped(4000n)),
            }
        }
    }));
    const voluntaryFeeUtxo = provider.addUtxo(systemUnderTest.tokenAddress, randomUtxo({
        token: {
            category: contractToken.category,
            amount: 0n,
            nft: {
                capability: 'none',
                commitment: '02',
            }
        }
    }));

    it('pay with default fee', async ({ expect }) => {
        const feeUtxo = provider.addUtxo(userWallet.address, randomUtxo({ satoshis: 10000n }));
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(defaultFeeUtxo, systemUnderTest.unlock.pay())
            .addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: defaultFeeUtxo.satoshis,
                },
                {
                    to: ownerWallet.address,
                    amount: defaultFeeAmount,
                }
            ]);
        expect(transaction).not.toFailRequire();
    });

    it('should fail when fee is less than default', async ({ expect }) => {
        const feeUtxo = provider.addUtxo(userWallet.address, randomUtxo({ satoshis: 10000n }));

        const testRange = [-2n, -1n, 1n];

        for (let index = 0; index < testRange.length; ++index) {
            const offset = testRange[index];
            const transaction = new TransactionBuilder({ provider });
            transaction
                .addInput(defaultFeeUtxo, systemUnderTest.unlock.pay())
                .addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH())
                .addOutputs([
                    {
                        to: systemUnderTest.tokenAddress,
                        amount: DustAmount,
                    },
                    {
                        to: ownerWallet.address,
                        amount: defaultFeeAmount + offset,
                    }
                ]);
            expect(transaction).toFailRequire();
        }
    });

    it('pay with encoded fee, no new destination', async ({ expect }) => {
        const feeUtxo = provider.addUtxo(userWallet.address, randomUtxo({
            token: {
                category: payByToken.category,
                amount: payByTokenAmount,
            },
        }));
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(encodedTokenFeeUtxo, systemUnderTest.unlock.pay())
            .addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: encodedTokenFeeUtxo.satoshis,
                    token: encodedTokenFeeUtxo.token,
                },
                {
                    to: ownerWallet.address,
                    amount: DustAmount,
                    token: {
                        category: payByToken.category,
                        amount: payByTokenAmount,
                    }
                }
            ]);
        expect(transaction).not.toFailRequire();
    });

    it('pay with encoded Bitcoin fee, no new destination', async ({ expect }) => {
        const feeUtxo = provider.addUtxo(userWallet.address, randomUtxo({ satoshis: 10000n }));
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(encodedBitcoinFeeUtxo, systemUnderTest.unlock.pay())
            .addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: encodedBitcoinFeeUtxo.satoshis,
                    token: encodedBitcoinFeeUtxo.token,
                },
                {
                    to: ownerWallet.address,
                    amount: 4000n,
                }
            ]);
        expect(transaction).not.toFailRequire();
    });

    it('should fail when encoded fee doesnt match', async ({ expect }) => {
        const feeUtxo = provider.addUtxo(userWallet.address, randomUtxo({
            token: {
                category: payByToken.category,
                amount: payByTokenAmount,
            },
        }));

        const testRange = [-1n, 1n];

        for (let index = 0; index < testRange.length; ++index) {
            const offset = testRange[index];
            const transaction = new TransactionBuilder({ provider });
            transaction
                .addInput(encodedTokenFeeUtxo, systemUnderTest.unlock.pay())
                .addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH())
                .addOutputs([
                    {
                        to: systemUnderTest.tokenAddress,
                        amount: encodedTokenFeeUtxo.satoshis,
                        token: encodedTokenFeeUtxo.token,
                    },
                    {
                        to: ownerWallet.address,
                        amount: DustAmount,
                        token: {
                            category: payByToken.category,
                            amount: payByTokenAmount + offset,
                        }
                    }
                ]);
            expect(transaction).toFailRequire();
        }
    });

    it('pay with encoded fee, use new destination', async ({ expect }) => {
        const feeUtxo = provider.addUtxo(userWallet.address, randomUtxo({
            token: {
                category: payByToken.category,
                amount: payByTokenAmount,
            },
        }));
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(encodedTokenFeeWithDestinationUtxo, systemUnderTest.unlock.pay())
            .addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: encodedTokenFeeWithDestinationUtxo.satoshis,
                    token: encodedTokenFeeWithDestinationUtxo.token,
                },
                {
                    to: encodedDestination,
                    amount: DustAmount,
                    token: {
                        category: payByToken.category,
                        amount: payByTokenAmount,
                    }
                }
            ]);
        expect(transaction).not.toFailRequire();
    });

    it('voluntary payments allow no payment (use OP_RETURN output)', async () => {
        const feeUtxo = provider.addUtxo(userWallet.address, randomUtxo());
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(voluntaryFeeUtxo, systemUnderTest.unlock.pay())
            .addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: voluntaryFeeUtxo.satoshis,
                    token: voluntaryFeeUtxo.token,
                },
            ])
            .addOpReturnOutput([]);
        expect(transaction).not.toFailRequire();
    });

    it('allows voluntary BCH payment to default destination', async () => {
        const feeUtxo = provider.addUtxo(userWallet.address, randomUtxo());
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(voluntaryFeeUtxo, systemUnderTest.unlock.pay())
            .addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: voluntaryFeeUtxo.satoshis,
                    token: voluntaryFeeUtxo.token,
                },
                {
                    to: ownerWallet.address,
                    amount: DustAmount,
                },
            ]);
        expect(transaction).not.toFailRequire();
    });

    it('allows voluntary token payment to default destination', async () => {
        const feeUtxo = provider.addUtxo(userWallet.address, randomUtxo({
            token: {
                category: payByToken.category,
                amount: 1n,
            },
        }));
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(voluntaryFeeUtxo, systemUnderTest.unlock.pay())
            .addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: voluntaryFeeUtxo.satoshis,
                    token: voluntaryFeeUtxo.token,
                },
                {
                    to: ownerWallet.tokenAddress,
                    amount: DustAmount,
                    token: {
                        category: payByToken.category,
                        amount: 1n,
                    }
                },
            ]);
        expect(transaction).not.toFailRequire();
    });

    it('allows the owner to close the fee thread', async ({ expect }) => {
        const transaction = new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true });
        transaction
            .addInput(defaultFeeUtxo, systemUnderTest.unlock.close())
            .addInput(encodedTokenFeeUtxo, systemUnderTest.unlock.close())
            .addInput(encodedTokenFeeWithDestinationUtxo, systemUnderTest.unlock.close())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutput({
                to: ownerWallet.address,
                amount: DustAmount,
                token: authUtxo.token,
            });
        expect(transaction).not.toFailRequireWith("unauthorized user");
    });

    test.each(['00FF', '0020'])('allows the owner with the correct roles to close the fee thread', async role => {
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
        const transaction = new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true });
        transaction
            .addInput(defaultFeeUtxo, systemUnderTest.unlock.close())
            .addInput(encodedTokenFeeUtxo, systemUnderTest.unlock.close())
            .addInput(encodedTokenFeeWithDestinationUtxo, systemUnderTest.unlock.close())
            .addInput(utxo, wallet.signatureTemplate.unlockP2PKH())
            .addOutput({
                to: wallet.address,
                amount: DustAmount,
                token: utxo.token,
            });
        expect(transaction).not.toFailRequireWith("unauthorized user");
    });

    test.each(['0010', '0040'])('ensures the authorization usuer has the correct role', async role => {
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
        const transaction = new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true });
        transaction
            .addInput(defaultFeeUtxo, systemUnderTest.unlock.close())
            .addInput(encodedTokenFeeUtxo, systemUnderTest.unlock.close())
            .addInput(encodedTokenFeeWithDestinationUtxo, systemUnderTest.unlock.close())
            .addInput(utxo, wallet.signatureTemplate.unlockP2PKH())
            .addOutput({
                to: wallet.address,
                amount: DustAmount,
                token: utxo.token,
            });
        expect(transaction).toFailRequireWith("unauthorized user");
    });

    it('prevents the owner from moving a fee', async ({ expect }) => {
        const feeUtxo = provider.addUtxo(ownerWallet.address, randomUtxo());
        const transaction = new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true });
        transaction
            .addInput(feeUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addInput(encodedTokenFeeUtxo, systemUnderTest.unlock.close())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: ownerWallet.address,
                    amount: DustAmount,
                    token: encodedTokenFeeUtxo.token,
                },
                {
                    to: ownerWallet.address,
                    amount: DustAmount,
                    token: authUtxo.token,
                },
            ]);
        expect(transaction).toFailRequire();
    });

    describe('fungible tokens on the fee NFT', () => {
        /** pay() through an encoded Bitcoin fee NFT carrying 50 fee tokens, returning `returned` of them to it. */
        const pay = (returned: bigint) => {
            const feeNft = provider.addUtxo(systemUnderTest.tokenAddress, randomUtxo({
                token: {
                    category: contractToken.category,
                    amount: 50n,
                    nft: { capability: 'none', commitment: '01' + swapEndianness('0'.repeat(32 * 2)) + binToHex(bigIntToBinUint64LEClamped(4000n)) },
                },
            }));
            const funding = provider.addUtxo(userWallet.address, randomUtxo({ satoshis: 10000n }));
            const transaction = new TransactionBuilder({ provider });
            transaction
                .addInput(feeNft, systemUnderTest.unlock.pay())
                .addInput(funding, userWallet.signatureTemplate.unlockP2PKH())
                .addOutputs([
                    { to: systemUnderTest.tokenAddress, amount: feeNft.satoshis, token: { ...feeNft.token!, amount: returned } },
                    { to: ownerWallet.address, amount: 4000n },
                ]);
            if (returned < 50n) {
                transaction.addOutput({ to: userWallet.tokenAddress, amount: DustAmount, token: { category: contractToken.category, amount: 50n - returned } });
            }
            return transaction;
        };

        it('keeps them on the fee NFT', ({ expect }) => {
            expect(pay(50n)).not.toFailRequire();
        });

        it('rejects taking them off the fee NFT', ({ expect }) => {
            expect(pay(0n)).toFailRequireWith('tokenAmount == tx.outputs[this.activeInputIndex].tokenAmount');
        });
    });
});
