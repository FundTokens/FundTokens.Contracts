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
    binToNumberInt32LE,
    hexToBin,
    numberToBinInt32LE,
    hash256,
} from '@bitauth/libauth';

import { generateWallet } from '@/wallet.js';

import systemUnderTestJson from '@lib/art/instance_vault.json' with { type: 'json' };

const DustAmount = 2000n;

describe(`System Under Test: ${systemUnderTestJson.contractName} Contract`, () => {
    const network = Network.MOCKNET;

    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });

    const ownerWallet = generateWallet(network);
    const authToken = randomToken({
        nft: {
            capability: 'none',
            commitment: '01004001'
        }
    });
    const authUtxo = randomUtxo({ satoshis: 10000n, token: authToken });
    provider.addUtxo(ownerWallet.tokenAddress, authUtxo);

    const instanceCategory = randomToken().category;
    const inflow = randomToken().category;
    const outflow = randomToken().category;
    const publicFund = randomToken().category;
    const fees = {
        create: {
            nft: randomToken().category,
            amount: 1234n,
        },
        execute: {
            nft: randomToken().category,
            amount: 123456n,
        },
    };
    const instanceHex = `01${swapEndianness(inflow)}${swapEndianness(outflow)}${swapEndianness(publicFund)}${swapEndianness(fees.create.nft)}${binToHex(numberToBinInt32LE(Number(fees.create.amount)))}${swapEndianness(fees.execute.nft)}${binToHex(numberToBinInt32LE(Number(fees.execute.amount)))}`;
    const instanceHash = binToHex(hash256(hexToBin(instanceHex.slice(2))));

    const instanceTxId = randomUtxo().txid;
    const instanceUtxos = [
        randomUtxo({
            txid: instanceTxId,
            vout: 0,
            satoshis: 3000n,
            token: {
                category: instanceCategory,
                amount: 0n,
                nft: {
                    capability: 'none',
                    commitment: '00' + instanceHash
                }
            }
        }),
        randomUtxo({
            txid: instanceTxId,
            vout: 1,
            satoshis: 3000n,
            token: {
                category: instanceCategory,
                amount: 0n,
                nft: {
                    capability: 'none',
                    commitment: instanceHex.slice(0, 256)
                }
            }
        }),
        randomUtxo({
            txid: instanceTxId,
            vout: 2,
            satoshis: 3000n,
            token: {
                category: instanceCategory,
                amount: 0n,
                nft: {
                    capability: 'none',
                    commitment: instanceHex.slice(256)
                }
            }
        })
    ];

    const systemUnderTest = new Contract(systemUnderTestJson, [swapEndianness(instanceCategory), swapEndianness(authToken.category)], { provider });
    instanceUtxos.forEach(u => provider.addUtxo(systemUnderTest.tokenAddress, u));

    it('Users can run on-chain proofs', async () => {
        const userWallet = generateWallet(network);
        const feeUtxo = randomUtxo({ satoshis: 10000n });
        provider.addUtxo(userWallet.address, feeUtxo);
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(instanceUtxos[0], systemUnderTest.unlock.prove())
            .addInput(instanceUtxos[1], systemUnderTest.unlock.data())
            .addInput(instanceUtxos[2], systemUnderTest.unlock.data())
            .addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: instanceUtxos[0].token
                },
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: instanceUtxos[1].token
                },
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: instanceUtxos[2].token
                },
                {
                    to: ownerWallet.address,
                    amount: DustAmount,
                }
            ]);
        expect(transaction).not.toFailRequire();
    });

    it('Users can not output reordered proofs', async () => {
        const userWallet = generateWallet(network);
        const feeUtxo = randomUtxo({ satoshis: 10000n });
        provider.addUtxo(userWallet.address, feeUtxo);
        const transaction = new TransactionBuilder({ provider });
        transaction
            .addInput(instanceUtxos[0], systemUnderTest.unlock.prove())
            .addInput(instanceUtxos[1], systemUnderTest.unlock.data())
            .addInput(instanceUtxos[2], systemUnderTest.unlock.data())
            .addInput(feeUtxo, userWallet.signatureTemplate.unlockP2PKH())
            .addOutputs([
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: instanceUtxos[1].token
                },
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: instanceUtxos[0].token
                },
                {
                    to: systemUnderTest.tokenAddress,
                    amount: DustAmount,
                    token: instanceUtxos[2].token
                },
                {
                    to: ownerWallet.address,
                    amount: DustAmount,
                }
            ]);
        expect(transaction).toFailRequireWith('NFT commitment and order must be preserved');
    });

    it('Authorized user can burn data and tokens', async () => {
        const transaction = new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true });
        transaction
            .addInput(instanceUtxos[0], systemUnderTest.unlock.close())
            .addInput(instanceUtxos[1], systemUnderTest.unlock.data())
            .addInput(instanceUtxos[2], systemUnderTest.unlock.data())
            .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH()) // contains auth and sats
            .addOutputs([
                {
                    to: ownerWallet.address,
                    amount: DustAmount,
                }
            ]);
        expect(transaction).not.toFailRequire();
    });
});