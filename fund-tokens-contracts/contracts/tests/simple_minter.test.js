import {
    MockNetworkProvider,
    Network,
    randomToken,
    randomUtxo,
} from 'cashscript';
import 'cashscript/vitest';

import { generateWallet } from '@/wallet.js';
import { DustAmount } from '@lib/constants.js';

describe('Testing the SimpleMinter Contract', () => {
    const network = Network.MOCKNET;

    const provider = new MockNetworkProvider({
        updateUtxoSet: true,
    });

    const addUtxos = (address, utxos) => utxos.forEach(u => provider.addUtxo(address, u));

    const wallet = generateWallet(network);

    it('should mint to destination', async () => {

    });
});