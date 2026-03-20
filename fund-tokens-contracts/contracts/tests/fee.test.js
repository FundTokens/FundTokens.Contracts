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
import { DustAmount } from '@lib/constants.js';

import systemUnderTestJson from '@lib/art/fee.json' with { type: 'json' };

import 'cashscript/vitest';

describe(`System Under Test: ${systemUnderTestJson.contractName} Contract`, () => {
    const network = Network.MOCKNET;

    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });

    const ownerWallet = generateWallet(network);
    const userWallet = generateWallet(network);

    const payByToken = randomToken();
    const payByTokenAmount = 1000n;
    const contractToken = randomToken();
    const encodedTokenFeeUtxo = randomUtxo({
        token: {
            category: contractToken.category,
            amount: 0n,
            nft: {
                capability: 'none',
                commitment: swapEndianness(payByToken.category) + binToHex(bigIntToBinUint64LEClamped(payByTokenAmount)),
            }
        }
    });
    const encodedBitcoinFeeUtxo = randomUtxo({
        token: {
            category: contractToken.category,
            amount: 0n,
            nft: {
                capability: 'none',
                commitment: swapEndianness('0'.repeat(32 * 2)) + binToHex(bigIntToBinUint64LEClamped(4000n)),
            }
        }
    });
    const encodedDestination = userWallet.address;
    const encodedTokenFeeWithDestinationUtxo = randomUtxo({
        token: {
            category: contractToken.category,
            amount: 0n,
            nft: {
                capability: 'none',
                commitment: swapEndianness(payByToken.category) + binToHex(bigIntToBinUint64LEClamped(payByTokenAmount)) + binToHex(cashAddressToLockingBytecode(encodedDestination).bytecode),
            }
        }
    });
    const defaultFeeUtxo = randomUtxo();
    const defaultFeeAmount = 2000n;

    const systemUnderTest = new Contract(systemUnderTestJson, [ownerWallet.pubKeyHex, swapEndianness(contractToken.category), defaultFeeAmount], { provider });

    provider.addUtxo(systemUnderTest.tokenAddress, defaultFeeUtxo);
    provider.addUtxo(systemUnderTest.tokenAddress, encodedTokenFeeUtxo);
    provider.addUtxo(systemUnderTest.tokenAddress, encodedTokenFeeWithDestinationUtxo);
    provider.addUtxo(systemUnderTest.tokenAddress, encodedBitcoinFeeUtxo);

    it('pay with default fee', async ({ expect }) => {
        const feeUtxo = randomUtxo({ satoshis: 10000n });
        provider.addUtxo(userWallet.address, feeUtxo);
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

    it('should fail when fee doesnt match default', async ({ expect }) => {
        const feeUtxo = randomUtxo({ satoshis: 10000n });
        provider.addUtxo(userWallet.address, feeUtxo);

        const testRange = [-1n, 1n];

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
        const feeUtxo = randomUtxo({
            token: {
                category: payByToken.category,
                amount: payByTokenAmount,
            },
        });
        provider.addUtxo(userWallet.address, feeUtxo);
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
        const feeUtxo = randomUtxo({ satoshis: 10000n });
        provider.addUtxo(userWallet.address, feeUtxo);
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
        const feeUtxo = randomUtxo({
            token: {
                category: payByToken.category,
                amount: payByTokenAmount,
            },
        });
        provider.addUtxo(userWallet.address, feeUtxo);

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
        const feeUtxo = randomUtxo({
            token: {
                category: payByToken.category,
                amount: payByTokenAmount,
            },
        });
        provider.addUtxo(userWallet.address, feeUtxo);
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

    it('allows the owner to close the fee thread', async ({ expect }) => {
        const transaction = new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true });
        transaction
            .addInput(defaultFeeUtxo, systemUnderTest.unlock.close(ownerWallet.signatureTemplate))
            .addInput(encodedTokenFeeUtxo, systemUnderTest.unlock.close(ownerWallet.signatureTemplate))
            .addInput(encodedTokenFeeWithDestinationUtxo, systemUnderTest.unlock.close(ownerWallet.signatureTemplate))
            .addOutput({
                to: ownerWallet.address,
                amount: DustAmount,
            });
        expect(transaction).not.toFailRequire();
    });

    it('prevents the owner from moving the encoded fee', async ({ expect }) => {
        const feeUtxo = randomUtxo();
        provider.addUtxo(ownerWallet.address, feeUtxo);
        const transaction = new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true });
        transaction
            .addInput(feeUtxo, ownerWallet.signatureTemplate)
            .addInput(encodedTokenFeeUtxo, systemUnderTest.unlock.close(ownerWallet.signatureTemplate))
            .addOutput({
                to: ownerWallet.address,
                amount: DustAmount,
                token: encodedTokenFeeUtxo.token,
            });
        expect(transaction).toFailRequire();
    });
});