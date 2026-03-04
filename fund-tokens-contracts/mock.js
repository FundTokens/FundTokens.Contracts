import {
    MockNetworkProvider,
    Network,
    randomUtxo,
} from 'cashscript';

import { generateWallet } from './wallet.js';

import { DustAmount } from './builders/constants.js';
import SystemTransactionBuilder from './builders/SystemTransactionBuilder.js';

const provider = new MockNetworkProvider({
    updateUtxoSet: true,
});

const addUtxos = (address, utxos) => utxos.forEach(u => provider.addUtxo(address, u));

const systemOwnerWallet = generateWallet(Network.MOCKNET);
const authHeadOwnerWallet = generateWallet(Network.MOCKNET);

const feeUtxo = randomUtxo({ satoshis: 100000000n});

const genesisPartial = { vout: 0, satoshis: DustAmount };

const inflowGenesisUtxo = randomUtxo(genesisPartial);
const outflowGenesisUtxo = randomUtxo(genesisPartial);
const publicFundGenesisUtxo = randomUtxo(genesisPartial);
const createFundFeeGenesisUtxo = randomUtxo(genesisPartial);
const executeFundFeeGenesisUtxo = randomUtxo(genesisPartial);

const genesisInputs = [inflowGenesisUtxo, outflowGenesisUtxo, publicFundGenesisUtxo, createFundFeeGenesisUtxo, executeFundFeeGenesisUtxo].map(u => ({ ...u, unlocker: systemOwnerWallet.signatureTemplate.unlockP2PKH() }));


addUtxos(systemOwnerWallet.tokenAddress, [...genesisInputs, feeUtxo]);

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

const systemTransactionBuilder = new SystemTransactionBuilder({ provider, system });

systemTransactionBuilder
    .addInitializeSystem({ utxos: genesisInputs })
    .addInput(feeUtxo, systemOwnerWallet.signatureTemplate.unlockP2PKH());

const initResponse = await systemTransactionBuilder.send();
console.log('initialize system tx size', initResponse.hex.length / 2);