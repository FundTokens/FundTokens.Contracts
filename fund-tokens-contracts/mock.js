import {
    MockNetworkProvider,
    randomUtxo,
} from 'cashscript';

import { generateWallet } from './wallet.js';
import SystemTransactionBuilder from './builders/SystemTransactionBuilder.js';

const provider = new MockNetworkProvider({
    updateUtxoSet: true,
});

provider.addUtxos = (address, utxos) => utxos.forEach(u => this.addUtxo(address, u));

const systemOwnerWallet = generateWallet();
const authHeadOwnerWallet = generateWallet();

const genesisPartial = { vout: 0 };

const inflowGenesisUtxo = randomUtxo(genesisPartial);
const outflowGenesisUtxo = randomUtxo(genesisPartial);
const publicFundGenesisUtxo = randomUtxo(genesisPartial);
const createFundFeeGenesisUtxo = randomUtxo(genesisPartial);
const executeFundFeeGenesisUtxo = randomUtxo(genesisPartial);

provider.addUtxos(systemOwnerWallet.tokenAddress, [inflowGenesisUtxo, outflowGenesisUtxo, publicFundGenesisUtxo, createFundFeeGenesisUtxo, executeFundFeeGenesisUtxo]);

const system = {
    inflow: inflowGenesisUtxo.txid, // 32 byte, tx id/token id
    outflow: outflowGenesisUtxo.txid, // 32 byte, tx id/token id
    publicFund: publicFundGenesisUtxo.txid, // 32 byte, tx id/token id
    authHead: authHeadOwnerWallet.pubKeyHashHex, // public key hash
    owner: systemOwnerWallet.pubKeyHex, // public key
    fees: {
        create: {
            nft: createFundFeeGenesisUtxo.txid, // 32 byte, tx id/token id
            value: 10000n, // bigint
        },
        execute: {
            nft: executeFundFeeGenesisUtxo.txid, // 32 byte, tx id/token id
            value: 100000n, // bigint
        }
    },
};

const systemTransactionBuilder = new SystemTransactionBuilder({ provider, system, logger });

systemTransactionBuilder.addInitializeSystem({
    inflowGenesisUtxo,
    outflowGenesisUtxo,
    publicFundGenesisUtxo,
    createFundFeeGenesisUtxo,
    executeFundFeeGenesisUtxo,
})