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
    hash256,
    hexToBin,
    binToHex,
    cashAddressToLockingBytecode,
} from '@bitauth/libauth';

import { generateWallet } from '@/wallet.js';
import { DustAmount } from '@lib/constants.js';

import systemUnderTestJson from '@lib/art/simple_minter.json' with { type: 'json' };

import 'cashscript/vitest';

describe('Testing the SimpleMinter Contract', () => {
    const network = Network.MOCKNET;

    const provider = new MockNetworkProvider({
        updateUtxoSet: false,
    });

    const wallet = generateWallet(network);

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
            });
        expect(transaction).not.toFailRequire();
        await transaction.send();
    });
});