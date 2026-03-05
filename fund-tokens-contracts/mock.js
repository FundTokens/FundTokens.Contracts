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

const network = Network.MOCKNET;
const genesisPartial = { vout: 0, satoshis: DustAmount };

const addUtxos = (address, utxos) => utxos.forEach(u => provider.addUtxo(address, u));

///
const provider = new MockNetworkProvider({
    updateUtxoSet: true,
});

const systemOwnerWallet = generateWallet(network);
const authHeadOwnerWallet = generateWallet(network);

const system = {
    inflow: '1111111111111111111111111111111111111111111111111111111111111111', // 32 byte, tx id/token id
    outflow: '2222222222222222222222222222222222222222222222222222222222222222', // 32 byte, tx id/token id
    publicFund: '3333333333333333333333333333333333333333333333333333333333333333', // 32 byte, tx id/token id
    authHead: authHeadOwnerWallet.pubKeyHashHex, // public key hash
    owner: systemOwnerWallet.pubKeyHex, // public key
    fees: {
        create: {
            nft: '4444444444444444444444444444444444444444444444444444444444444444', // 32 byte, tx id/token id
            value: 10000n, // bigint
        },
        execute: {
            nft: '5555555555555555555555555555555555555555555555555555555555555555', // 32 byte, tx id/token id
            value: 100000n, // bigint
        }
    },
};

const initializeControlTokens = async () => {
    const inflowGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.inflow });
    const outflowGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.outflow });
    const publicFundGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.publicFund });
    const createFundFeeGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.fees.create.nft });
    const executeFundFeeGenesisUtxo = randomUtxo({ ...genesisPartial, txid: system.fees.execute.nft });
    const genesisInputs = [inflowGenesisUtxo, outflowGenesisUtxo, publicFundGenesisUtxo, createFundFeeGenesisUtxo, executeFundFeeGenesisUtxo].map(u => ({ ...u, unlocker: systemOwnerWallet.signatureTemplate.unlockP2PKH() }));
    const feeUtxo = randomUtxo({ satoshis: 10000n });

    addUtxos(systemOwnerWallet.tokenAddress, [feeUtxo, ...genesisInputs]);

    const systemTransactionBuilder = new SystemTransactionBuilder({ provider, system });
    systemTransactionBuilder
        .addInitializeSystem({ utxos: genesisInputs })
        .addInput(feeUtxo, systemOwnerWallet.signatureTemplate.unlockP2PKH());

    const initResponse = await systemTransactionBuilder.send();
    console.log('initialize system tx size', initResponse.hex.length / 2);
};

const createNewSystemThreads = async () => {
    const feeUtxo = randomUtxo({ satoshis: 10000n });
    const systemTransactionBuilder = new SystemTransactionBuilder({ provider, system });
    const { startupContract, createFundFeeContract, executeFundFeeContract } = systemTransactionBuilder.getContracts();

    addUtxos(systemOwnerWallet.tokenAddress, [feeUtxo]);

    systemTransactionBuilder
        .addInput(feeUtxo, systemOwnerWallet.signatureTemplate.unlockP2PKH())
        .addOutputs([
            {
                to: startupContract.tokenAddress,
                amount: DustAmount,
            },
            {
                to: createFundFeeContract.tokenAddress,
                amount: DustAmount,
            },
            {
                to: executeFundFeeContract.tokenAddress,
                amount: DustAmount,
            },
        ]);

    const initResponse = await systemTransactionBuilder.send();
    console.log('create new public fund threads tx size', initResponse.hex.length / 2);
};

// owner
await initializeControlTokens();
await createNewSystemThreads();

// mock fund
const fund = {
    category: '1111111111111111111111111111111111111111111111111111111111111111',
    amount: 1n,
    satoshis: 0n,
    assets: [
        {
            category: '2222222222222222222222222222222222222222222222222222222222222222',
            amount: 2n,
        },
        {
            category: '3333333333333333333333333333333333333333333333333333333333333333',
            amount: 3n,
        }
    ]
};

const fundBroadcast = async () => {
    const userWallet = generateWallet({ network });
    const fundGenesisUtxo = randomUtxo({ ...genesisPartial, txid: fund.category });
    const assetUtxos = fund.assets.map(a => randomUtxo({ token: randomToken({ ...a }) }));

    addUtxos(userWallet.tokenAddress, [fundGenesisUtxo, ...assetUtxos]);

    const publicFundTransactonBuilder = new PublicFundTransactionBuilder({ provider, system });
    publicFundTransactonBuilder.addInput(fundGenesisUtxo, userWallet.signatureTemplate.unlockP2PKH());
    await publicFundTransactonBuilder.addBroadcast({ fund });
    await publicFundTransactonBuilder.send();
};

const fundInflow = async () => {

};

const fundOutflow = async () => {

};

await fundBroadcast();
await fundInflow();
await fundOutflow();