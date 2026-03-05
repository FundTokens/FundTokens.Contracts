import {
    MockNetworkProvider,
    Network,
    randomToken,
    randomUtxo,
} from 'cashscript';

import { generateWallet } from './wallet.js';

import { DustAmount } from './lib/constants.js';
import SystemTransactionBuilder from './lib/SystemTransactionBuilder.js';
import PublicFundTransactionBuilder from './lib/PublicFundTransactionBuilder.js';

const provider = new MockNetworkProvider({
    updateUtxoSet: true,
});

const network = Network.MOCKNET;

const addUtxos = (address, utxos) => utxos.forEach(u => provider.addUtxo(address, u));

const systemOwnerWallet = generateWallet(network);
const authHeadOwnerWallet = generateWallet(network);

const feeUtxo = randomUtxo({ satoshis: 100000n}); // consume the entire utxo for simplicity

const genesisPartial = { vout: 0, satoshis: DustAmount };

const inflowGenesisUtxo = randomUtxo(genesisPartial);
const outflowGenesisUtxo = randomUtxo(genesisPartial);
const publicFundGenesisUtxo = randomUtxo(genesisPartial);
const createFundFeeGenesisUtxo = randomUtxo(genesisPartial);
const executeFundFeeGenesisUtxo = randomUtxo(genesisPartial);

const genesisInputs = [inflowGenesisUtxo, outflowGenesisUtxo, publicFundGenesisUtxo, createFundFeeGenesisUtxo, executeFundFeeGenesisUtxo].map(u => ({ ...u, unlocker: systemOwnerWallet.signatureTemplate.unlockP2PKH() }));

//
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

const { createFundFeeContract, executeFundFeeContract } = systemTransactionBuilder.getContracts();

systemTransactionBuilder
    .addInitializeSystem({ utxos: genesisInputs })
    .addInput(feeUtxo, systemOwnerWallet.signatureTemplate.unlockP2PKH())
    .addOutputs([
        {
            to: createFundFeeContract.tokenAddress,
            amount: DustAmount,
        },
        {
            to: executeFundFeeContract.tokenAddress,
            amount: DustAmount,
        }
    ]);

const initResponse = await systemTransactionBuilder.send();
console.log('initialize system tx size', initResponse.hex.length / 2);

///
///
///
const userWallet = generateWallet({ network });
const fundGenesisUtxo = randomUtxo(genesisPartial);
const assetUtxos = [
    randomUtxo({
        token: randomToken({
            amount: 1n
        })
    }),
    randomUtxo({
        token: randomToken({
            amount: 2n
        })
    }),
];

addUtxos(userWallet.tokenAddress, [fundGenesisUtxo, ...assetUtxos]);

const fund = {
    category: fundGenesisUtxo.txid,
    amount: 1n,
    satoshis: 0n,
    assets: assetUtxos.map(a => ({
        category: a.token.category,
        amount: a.token.amount,
    })),
};

const publicFundTransactonBuilder = new PublicFundTransactionBuilder({ provider, system });
publicFundTransactonBuilder.addInput(fundGenesisUtxo, userWallet.signatureTemplate.unlockP2PKH());
await publicFundTransactonBuilder.addBroadcast({ fund });
await publicFundTransactonBuilder.send();