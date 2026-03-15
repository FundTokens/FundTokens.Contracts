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

import systemUnderTestJson from '@lib/art/fee_minter.json' with { type: 'json' };

import 'cashscript/vitest';

describe(`System Under Test: ${systemUnderTestJson.contractName} Contract`, () => {
    const network = Network.MOCKNET;

    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });

    const wallet = generateWallet(network);
    const destination = generateWallet(network);
    const secondaryWallet = generateWallet(network);

    const token = randomToken({
        amount: 0n,
        nft: {
            capability: 'minting',
            commitment: '',
        }
    });
    const utxo = randomUtxo({ token });

    const systemUnderTest = new Contract(systemUnderTestJson, [wallet.pubKeyHex, swapEndianness(token.category), cashAddressToLockingBytecode(destination.address).bytecode], { provider });

    provider.addUtxo(systemUnderTest.tokenAddress, utxo);

    const testingToken = randomToken();

    const outputTemplate = {
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
    };

    const requiredOutputs = [
        {
            ...outputTemplate
        },
        {
            ...outputTemplate,
            to: destination.address,
            token: {
                ...outputTemplate.token,
                nft: {
                    capability: 'none',
                    commitment: testingToken.category + binToHex(bigIntToBinUint64LEClamped(1000n)),
                }
            }
        }
    ];

    it('should mint to destination', async ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxo, systemUnderTest.unlock.mint(wallet.signatureTemplate))
            .addOutputs(requiredOutputs)
            .addOutput({
                to: secondaryWallet.address,
                amount: DustAmount,
            });
        expect(transaction).not.toFailRequire();
        await transaction.send();
    });

    it('should allow minting with encoded destination', async ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxo, systemUnderTest.unlock.mint(wallet.signatureTemplate))
            .addOutputs([
                {
                    ...outputTemplate
                },
                {
                    ...outputTemplate,
                    to: destination.address,
                    token: {
                        ...outputTemplate.token,
                        nft: {
                            capability: 'none',
                            commitment: testingToken.category + binToHex(bigIntToBinUint64LEClamped(1000n)) + binToHex(cashAddressToLockingBytecode(wallet.address).bytecode),
                        }
                    }
                }
            ]);
        expect(transaction).not.toFailRequire();
    });

    it('should ensure unable to mint anywhere else', async ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxo, systemUnderTest.unlock.mint(wallet.signatureTemplate))
            .addOutput({
                ...outputTemplate,
                to: systemUnderTest.tokenAddress,
            })
            .addOutput({
                ...outputTemplate,
                to: secondaryWallet.address,
            });
        expect(transaction).toFailRequire();
        transaction.outputs = [];
        transaction.addOutputs([
            ...requiredOutputs,
            { 
                to: secondaryWallet.address,
                amount: DustAmount,
                token: {
                    category: token.category,
                    amount: 0n,
                    nft: {
                        capability: 'minting',
                        commitment: '',
                    },
                }
            }
        ]);
        expect(transaction).toFailRequire();
    });

    it('should ensure the owner approves the tx', async ({ expect }) => {
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(utxo, systemUnderTest.unlock.mint(secondaryWallet.signatureTemplate))
            .addOutputs(requiredOutputs);
        expect(transaction).toFailRequire();
    });
});