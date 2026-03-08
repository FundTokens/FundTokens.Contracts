import {
    MockNetworkProvider,
    Network,
    randomToken,
    randomUtxo,
} from 'cashscript';
import {
    swapEndianness,
    hash256,
    hexToBin,
    binToHex,
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

    const addUtxos = (address, utxos) => utxos.forEach(u => provider.addUtxo(address, u));

    const wallet = generateWallet(network);

    const token = randomToken();

    // const systemUnderTest = new Contract(systemUnderTestJson, [wallet.pubKey, swapEndianness(token.category), ''], { provider });

    it('should mint to destination', async () => {

    });
});