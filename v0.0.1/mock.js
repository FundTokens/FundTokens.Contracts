import {
    Contract,
    MockNetworkProvider,
    SignatureTemplate,
    TransactionBuilder,
    randomUtxo,
    randomToken,
    randomNFT,
} from 'cashscript';
import {
    instantiateSecp256k1,
    instantiateRipemd160,
    instantiateSha256,
    generatePrivateKey,
    binToHex,
    encodeCashAddress,
    hexToBin,
    swapEndianness,
    hash256,
    hash160,
    encodeLockingBytecodeP2sh32,
    addressContentsToLockingBytecode,
    base58AddressToLockingBytecode,
    cashAddressToLockingBytecode,
} from '@bitauth/libauth';


import inflow from './art/inflow.json' with { type: 'json' };
import mint from './art/mint.json' with { type: 'json' };
import collection from './art/collection.json' with { type: 'json' };

import outflow from './art/outflow.json' with { type: 'json' };
import burn from './art/burn.json' with { type: 'json' };
import distribute from './art/distribute.json' with { type: 'json' };

import holdings from './art/holdings.json' with { type: 'json' };


const secp256k1 = await instantiateSecp256k1();
const ripemd160 = await instantiateRipemd160();
const sha256 = await instantiateSha256();

const network = 'mocknet';

const generateWallet = () => {
    const privateKey = generatePrivateKey();
    const pubKeyBin = secp256k1.derivePublicKeyCompressed(privateKey);
    const pubKeyHex = binToHex(pubKeyBin);
    const signatureTemplate = new SignatureTemplate(privateKey);
    const pubKeyHash = ripemd160.hash(sha256.hash(pubKeyBin));
    const encoded = encodeCashAddress({ prefix: network === 'mainnet' ? 'bitcoincash' : 'bchtest', type: 'p2pkhWithTokens', payload: pubKeyHash });
    return { privateKey, pubKeyHex, pubKeyHash, signatureTemplate, address: typeof encoded === 'string' ? encoded : encoded.address };
};

const provider = new MockNetworkProvider({
    updateUtxoSet: true,
});

const wallet = generateWallet();

const contractUtxos = {
    inflow: {
        category: null,
        categoryHex: null,
        utxo: randomUtxo({
            satoshis: 1000n,
            token: randomToken({
                amount: 1n,
            }),
        })
    },
    minting: {
        category: null,
        categoryHex: null,
        utxo: randomUtxo({
            satoshis: 1000n,
            token: randomNFT({
                amount: 0n,
                nft: {
                    capability: 'minting',
                    commitment: ''
                },
            })
        })
    },
    collection: {
        category: null,
        categoryHex: null,
        utxo: randomUtxo({
            satoshis: 1000n,
            token: randomToken({
                amount: 1n
            }),
        })
    },
    outflow: {
        category: null,
        categoryHex: null,
        utxo: randomUtxo({
            satoshis: 1000n,
            token: randomToken({
                amount: 1n,
            }),
        })
    },
    burn: {
        category: null,
        categoryHex: null,
        utxo: randomUtxo({
            satoshis: 1000n,
            token: randomToken({
                amount: 1n
            }),
        })
    },
    distribution: {
        category: null,
        categoryHex: null,
        utxo: randomUtxo({
            satoshis: 1000n,
            token: randomToken({
                amount: 1n
            }),
        }),
    }
};

function mapWork(mainObj, type) {
    mainObj[type].category = mainObj[type].utxo.token.category;
    mainObj[type].categoryHex = swapEndianness(mainObj[type].utxo.token.category);
}


mapWork(contractUtxos, 'inflow');
mapWork(contractUtxos, 'collection');
mapWork(contractUtxos, 'minting');

mapWork(contractUtxos, 'outflow');
mapWork(contractUtxos, 'burn');
mapWork(contractUtxos, 'distribution');


const asset1Amount = 100n;
const asset1 = randomUtxo({
    satoshis: 1000n,
    token: randomToken({
        amount: asset1Amount,
    }),
});
const asset2Amount = 200n;
const asset2 = randomUtxo({
    satoshis: 1000n,
    token: randomToken({
        amount: asset2Amount,
    }),
});

const inflowFee = randomUtxo({
    satoshis: 10000n + 1000n,
});


const asset1HoldingsContract = new Contract(holdings, [contractUtxos.outflow.categoryHex, swapEndianness(asset1.token.category), asset1Amount], { provider });
const asset2HoldingsContract = new Contract(holdings, [contractUtxos.outflow.categoryHex, swapEndianness(asset2.token.category), asset2Amount], { provider });


const inflowContract = new Contract(inflow, [contractUtxos.inflow.categoryHex, contractUtxos.minting.categoryHex, contractUtxos.collection.categoryHex], { provider });
const mintContract = new Contract(mint, [contractUtxos.inflow.categoryHex, contractUtxos.minting.categoryHex], { provider });
const collectionContract = new Contract(collection, [
    contractUtxos.inflow.categoryHex, 
    cashAddressToLockingBytecode(asset1HoldingsContract.tokenAddress).bytecode,
    swapEndianness(asset1.token.category), 
    asset1Amount, 
    cashAddressToLockingBytecode(asset2HoldingsContract.tokenAddress).bytecode, 
    swapEndianness(asset2.token.category),
    asset2Amount
], { provider });

const outflowContract = new Contract(outflow, [contractUtxos.outflow.categoryHex, contractUtxos.burn.categoryHex, contractUtxos.distribution.categoryHex], { provider });
const burnContract = new Contract(burn, [contractUtxos.burn.categoryHex, contractUtxos.minting.categoryHex], { provider });
const distributeContract = new Contract(distribute, [
    contractUtxos.outflow.categoryHex,
    contractUtxos.distribution.categoryHex, 
    cashAddressToLockingBytecode(asset1HoldingsContract.tokenAddress).bytecode, 
    swapEndianness(asset1.token.category), 
    asset1Amount, 
    cashAddressToLockingBytecode(asset2HoldingsContract.tokenAddress).bytecode,
    swapEndianness(asset2.token.category), 
    asset2Amount
], { provider });

// hydrate inflow contracts w/ UTXOs
provider.addUtxo(inflowContract.tokenAddress, contractUtxos.inflow.utxo);
provider.addUtxo(mintContract.tokenAddress, contractUtxos.minting.utxo);
provider.addUtxo(collectionContract.tokenAddress, contractUtxos.collection.utxo);

// hydrate wallet w/ UTXOs
provider.addUtxo(wallet.address, asset1);
provider.addUtxo(wallet.address, asset2);
provider.addUtxo(wallet.address, inflowFee);

// mint a composed token
await new TransactionBuilder({ provider })
    .addInput(contractUtxos.inflow.utxo, inflowContract.unlock.main())
    .addOutput({ // return to contract
        to: inflowContract.tokenAddress,
        amount: 1000n,
        token: {
            amount: 1n,
            category: contractUtxos.inflow.category
        },
    })
    .addInput(contractUtxos.minting.utxo, mintContract.unlock.mint())
    .addOutputs([
        { // return to contract
            to: mintContract.tokenAddress,
            amount: 1000n,
            token: {
                amount: 0n,
                category: contractUtxos.minting.category,
                nft: {
                    capability: 'minting',
                    commitment: '',
                }
            },
        },
        { // send fun(d) token to user
            to: wallet.address,
            amount: 1000n,
            token: {
                amount: 0n,
                category: contractUtxos.minting.category,
                nft: {
                    capability: 'none',
                    commitment: '',
                }
            }
        },
    ])
    .addInput(contractUtxos.collection.utxo, collectionContract.unlock.assert())
    .addOutput({ // return to contract
        to: collectionContract.tokenAddress,
        amount: 1000n,
        token: {
            amount: 1n,
            category: contractUtxos.collection.category,
        },
    })
    .addInput(asset1, wallet.signatureTemplate.unlockP2PKH())
    .addInput(asset2, wallet.signatureTemplate.unlockP2PKH())
    .addOutputs(
        [
            { // collect asset
                to: asset1HoldingsContract.tokenAddress,
                amount: 1000n,
                token: {
                    category: asset1.token.category,
                    amount: asset1Amount,
                }
            },
            { // collect asset
                to: asset2HoldingsContract.tokenAddress,
                amount: 1000n,
                token: {
                    category: asset2.token.category,
                    amount: asset2Amount,
                }
            },
        ])
    .addInput(inflowFee, wallet.signatureTemplate.unlockP2PKH())
    .addOutput({ // change
        to: wallet.address,
        amount: 10000n,
    })
    .send();

// hydrate provider with outflow contracts
provider.addUtxo(outflowContract.tokenAddress, contractUtxos.outflow.utxo);
provider.addUtxo(burnContract.tokenAddress, contractUtxos.burn.utxo);
provider.addUtxo(distributeContract.tokenAddress, contractUtxos.distribution.utxo);

const holding1 = (await asset1HoldingsContract.getUtxos())[0];
const holding2 = (await asset2HoldingsContract.getUtxos())[0];

const updated = await provider.getUtxos(wallet.address);
const outflowFee = updated.filter(u => !u.token)[0];
const composedToken = updated.filter(u => !!u.token)[0];

// redeem a composed token
await new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true })
    .addInput(contractUtxos.outflow.utxo, outflowContract.unlock.main())
    .addOutput({ // return to contract
        to: outflowContract.tokenAddress,
        amount: 1000n,
        token: {
            amount: 1n,
            category: contractUtxos.outflow.category,
        },
    })
    .addInput(contractUtxos.distribution.utxo, distributeContract.unlock.assert())
    .addOutput({
        to: distributeContract.tokenAddress,
        amount: 1000n,
        token: {
            amount: 1n,
            category: contractUtxos.distribution.category,
        },
    })
    .addInput(holding1, asset1HoldingsContract.unlock.release())
    .addOutput({
        to: wallet.address,
        amount: 1000n,
        token: {
            ...holding1.token,
        }
    })
    .addInput(holding2, asset2HoldingsContract.unlock.release())
    .addOutput({
        to: wallet.address,
        amount: 1000n,
        token: {
            ...holding2.token,
        }
    })
    .addInput(outflowFee, wallet.signatureTemplate.unlockP2PKH())
    .addOutput({
        to: wallet.address,
        amount: 5000n,
    })
    // putting at the end as most contracts want input[n] => output[n]|output[n+1]
    // this will make the outputs uneven amount
    .addInput(contractUtxos.burn.utxo, burnContract.unlock.prove())
    .addInput(composedToken, wallet.signatureTemplate.unlockP2PKH()) // no token output will burn token
    .addOutput({ // return to contract
        to: burnContract.tokenAddress,
        amount: 1000n,
        token: {
            amount: 1n,
            category: contractUtxos.burn.category,
        },
    })
    .send();