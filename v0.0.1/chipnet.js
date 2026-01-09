import {
    Contract,
    MockNetworkProvider,
    SignatureTemplate,
    TransactionBuilder,
    randomUtxo,
    randomToken,
    randomNFT,
    ElectrumNetworkProvider,
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
    decodePrivateKeyWif,
} from '@bitauth/libauth';

import myWallet from './wallet.json' with { type: 'json' };

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

const generateWallet = ({ network }) => {
    const privateKey = generatePrivateKey();
    const pubKeyBin = secp256k1.derivePublicKeyCompressed(privateKey);
    const pubKeyHex = binToHex(pubKeyBin);
    const signatureTemplate = new SignatureTemplate(privateKey);
    const pubKeyHash = ripemd160.hash(sha256.hash(pubKeyBin));
    const encoded = encodeCashAddress({ prefix: network === 'mainnet' ? 'bitcoincash' : 'bchtest', type: 'p2pkhWithTokens', payload: pubKeyHash });
    return { privateKey, pubKeyHex, pubKeyHash, signatureTemplate, address: typeof encoded === 'string' ? encoded : encoded.address };
};

function getWallet({ network, wallet }) {
    const privateKey = wallet.PrivateKey;
    const signatureTemplate = new SignatureTemplate(privateKey);

    const decodedWif = decodePrivateKeyWif(wallet.PrivateKey);
    const pubKeyBin = secp256k1.derivePublicKeyCompressed(decodedWif.privateKey);
    const pubKeyHex = binToHex(pubKeyBin);
    const pubKeyHash = ripemd160.hash(sha256.hash(pubKeyBin));
    const encoded = encodeCashAddress({ prefix: network === 'mainnet' ? 'bitcoincash' : 'bchtest', type: 'p2pkhWithTokens', payload: pubKeyHash });
    return { privateKey, signatureTemplate, pubKeyBin, pubKeyHex, pubKeyHash, address: typeof encoded === 'string' ? encoded : encoded.address };
}

async function main() {
    const network = 'chipnet';

    const provider = new ElectrumNetworkProvider(network);

    const backingWallet = getWallet({ network, wallet: myWallet });

    const wallet = generateWallet({ network });

    console.log('generated wallet address is: ' + wallet.address);

    const backingUtxoSet = await provider.getUtxos(backingWallet.address);

    if(backingUtxoSet.filter(u => !u.token && u.satoshis > 100000n).length === 0) {
        console.error('no acceptable UTXO in the backing wallet. Send funds to: ' + backingWallet.address);
        return;
    }

    const genesis = backingUtxoSet[0];

    await new TransactionBuilder({ provider })
        .addInput(genesis, backingWallet.signatureTemplate.unlockP2PKH())
        .addOutput({
            to: backingWallet.address,
            amount: genesis.satoshis - 51000n,
        })
        .addOutput({
            to: wallet.address,
            amount: 50000n,
        })
        .send();

    let walletUtxos = await provider.getUtxos(wallet.address);

    if (walletUtxos.length === 0) {
        console.error('need a UTXO at: ' + wallet.address);
        return;
    }

    let walletUtxo = walletUtxos[0];
    if (walletUtxo.vout !== 0) {
        console.log('making auth token');
        await new TransactionBuilder({ provider })
            .addInput(walletUtxo, wallet.signatureTemplate.unlockP2PKH())
            .addOutput({
                to: wallet.address,
                amount: walletUtxo.satoshis - 1000n
            })
            .send();
        walletUtxo = (await provider.getUtxos(wallet.address))[0];
    }

    // inflow
    console.log('producing inflow');
    const inflowCategory = walletUtxo.txid;
    await new TransactionBuilder({ provider })
        .addInput(walletUtxo, wallet.signatureTemplate.unlockP2PKH())
        .addOutput({
            to: wallet.address,
            amount: walletUtxo.satoshis - 2000n,
            token: undefined,
        })
        .addOutput({
            to: wallet.address,
            amount: 1000n,
            token: {
                category: inflowCategory,
                amount: 1n,
                nft: undefined,
            }
        })
        .send();

    // collection
    console.log('producing collection');
    walletUtxo = (await provider.getUtxos(wallet.address)).filter(u => !u.token)[0];
    const collectionCategory = walletUtxo.txid;
    await new TransactionBuilder({ provider })
        .addInput(walletUtxo, wallet.signatureTemplate.unlockP2PKH())
        .addOutput({
            to: wallet.address,
            amount: walletUtxo.satoshis - 2000n,
        })
        .addOutput({
            to: wallet.address,
            amount: 1000n,
            token: {
                category: collectionCategory,
                amount: 1n,
            }
        })
        .send();

    // outflow
    console.log('producing outflow');
    walletUtxo = (await provider.getUtxos(wallet.address)).filter(u => !u.token)[0];
    const outflowCategory = walletUtxo.txid;
    await new TransactionBuilder({ provider })
        .addInput(walletUtxo, wallet.signatureTemplate.unlockP2PKH())
        .addOutput({
            to: wallet.address,
            amount: walletUtxo.satoshis - 2000n,
        })
        .addOutput({
            to: wallet.address,
            amount: 1000n,
            token: {
                category: outflowCategory,
                amount: 1n,
            }
        })
        .send();

    // burn
    console.log('producing burn');
    walletUtxo = (await provider.getUtxos(wallet.address)).filter(u => !u.token)[0];
    const burnCategory = walletUtxo.txid;
    await new TransactionBuilder({ provider })
        .addInput(walletUtxo, wallet.signatureTemplate.unlockP2PKH())
        .addOutput({
            to: wallet.address,
            amount: walletUtxo.satoshis - 2000n,
        })
        .addOutput({
            to: wallet.address,
            amount: 1000n,
            token: {
                category: burnCategory,
                amount: 1n,
            }
        })
        .send();

    // distribution
    console.log('producing distro');
    walletUtxo = (await provider.getUtxos(wallet.address)).filter(u => !u.token)[0];
    const distroCategory = walletUtxo.txid;
    await new TransactionBuilder({ provider })
        .addInput(walletUtxo, wallet.signatureTemplate.unlockP2PKH())
        .addOutput({
            to: wallet.address,
            amount: walletUtxo.satoshis - 2000n,
        })
        .addOutput({
            to: wallet.address,
            amount: 1000n,
            token: {
                category: distroCategory,
                amount: 1n,
            }
        })
        .send();

    // minting
    console.log('producing mint');
    walletUtxo = (await provider.getUtxos(wallet.address)).filter(u => !u.token)[0];
    const mintingCategory = walletUtxo.txid;
    await new TransactionBuilder({ provider })
        .addInput(walletUtxo, wallet.signatureTemplate.unlockP2PKH())
        .addOutput({
            to: wallet.address,
            amount: walletUtxo.satoshis - 2000n,
        })
        .addOutput({
            to: wallet.address,
            amount: 1000n,
            token: {
                category: mintingCategory,
                amount: 0n,
                nft: {
                    capability: 'minting',
                    commitment: ''
                }
            }
        })
        .send();


    const contractUtxos = {
        inflow: {
            category: inflowCategory,
            categoryHex: null,
            utxo: null
        },
        collection: {
            category: collectionCategory,
            categoryHex: null,
            utxo: null
        },
        outflow: {
            category: outflowCategory,
            categoryHex: null,
            utxo: null
        },
        burn: {
            category: burnCategory,
            categoryHex: null,
            utxo: null
        },
        distribution: {
            category: distroCategory,
            categoryHex: null,
            utxo: null
        },
        minting: {
            category: mintingCategory,
            categoryHex: null,
            utxo: null
        },
    };

    function mapWork(mainObj, type) {
        mainObj[type].categoryHex = swapEndianness(mainObj[type].category);
    }

    mapWork(contractUtxos, 'inflow');
    mapWork(contractUtxos, 'collection');
    mapWork(contractUtxos, 'minting');

    mapWork(contractUtxos, 'outflow');
    mapWork(contractUtxos, 'burn');
    mapWork(contractUtxos, 'distribution');


    // asset1
    console.log('producing asset 1');
    walletUtxo = (await provider.getUtxos(wallet.address)).filter(u => !u.token)[0];
    const asset1Amount = 100n;
    const asset1Category = walletUtxo.txid;
    await new TransactionBuilder({ provider })
        .addInput(walletUtxo, wallet.signatureTemplate.unlockP2PKH())
        .addOutput({
            to: wallet.address,
            amount: walletUtxo.satoshis - 2000n,
        })
        .addOutput({
            to: wallet.address,
            amount: 1000n,
            token: {
                category: asset1Category,
                amount: asset1Amount,
            }
        })
        .send();
    const asset1 = (await provider.getUtxos(wallet.address)).filter(u => u.token?.category === asset1Category)[0];

    // asset2
    console.log('producing asset 2');
    walletUtxo = (await provider.getUtxos(wallet.address)).filter(u => !u.token)[0];
    const asset2Amount = 200n;
    const asset2Category = walletUtxo.txid;
    await new TransactionBuilder({ provider })
        .addInput(walletUtxo, wallet.signatureTemplate.unlockP2PKH())
        .addOutput({
            to: wallet.address,
            amount: walletUtxo.satoshis - 2000n,
        })
        .addOutput({
            to: wallet.address,
            amount: 1000n,
            token: {
                category: asset2Category,
                amount: asset2Amount,
            }
        })
        .send();
    const asset2 = (await provider.getUtxos(wallet.address)).filter(u => u.token?.category === asset2Category)[0];

    console.log('starting contract object creation', contractUtxos);
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
    console.log('all contracts created in memory');

    // hydrate inflow
    console.log('hydrating inflow');
    walletUtxo = (await provider.getUtxos(wallet.address)).filter(u => !u.token)[0];
    await new TransactionBuilder({ provider })
        .addInput((await provider.getUtxos(wallet.address)).filter(u => u.token?.category === inflowCategory)[0], wallet.signatureTemplate.unlockP2PKH())
        .addInput(walletUtxo, wallet.signatureTemplate.unlockP2PKH())
        .addOutput({
            to: inflowContract.tokenAddress,
            amount: 1000n,
            token: {
                category: inflowCategory,
                amount: 1n,
            }
        })
        .addOutput({
            to: wallet.address,
            amount: walletUtxo.satoshis - 1000n,
        })
        .send();
    contractUtxos.inflow.utxo = (await inflowContract.getUtxos())[0];

    // hydrate mint
    console.log('hydrating mint');
    walletUtxo = (await provider.getUtxos(wallet.address)).filter(u => !u.token)[0];
    await new TransactionBuilder({ provider })
        .addInput((await provider.getUtxos(wallet.address)).filter(u => u.token?.category === mintingCategory)[0], wallet.signatureTemplate.unlockP2PKH())
        .addInput(walletUtxo, wallet.signatureTemplate.unlockP2PKH())
        .addOutput({
            to: mintContract.tokenAddress,
            amount: 1000n,
            token: {
                category: mintingCategory,
                amount: 0n,
                nft: {
                    capability: 'minting',
                    commitment: '',
                }
            }
        })
        .addOutput({
            to: wallet.address,
            amount: walletUtxo.satoshis - 1000n,
        })
        .send();
    contractUtxos.minting.utxo = (await mintContract.getUtxos())[0];

    // hydrate collection
    console.log('hydrating collection');
    walletUtxo = (await provider.getUtxos(wallet.address)).filter(u => !u.token)[0];
    await new TransactionBuilder({ provider })
        .addInput((await provider.getUtxos(wallet.address)).filter(u => u.token?.category === collectionCategory)[0], wallet.signatureTemplate.unlockP2PKH())
        .addInput(walletUtxo, wallet.signatureTemplate.unlockP2PKH())
        .addOutput({
            to: collectionContract.tokenAddress,
            amount: 1000n,
            token: {
                category: collectionCategory,
                amount: 1n,
            }
        })
        .addOutput({
            to: wallet.address,
            amount: walletUtxo.satoshis - 1000n,
        })
        .send();
    contractUtxos.collection.utxo = (await collectionContract.getUtxos())[0];

    // hydrate outflow
    console.log('hydrating outflow');
    walletUtxo = (await provider.getUtxos(wallet.address)).filter(u => !u.token)[0];
    await new TransactionBuilder({ provider })
        .addInput((await provider.getUtxos(wallet.address)).filter(u => u.token?.category === outflowCategory)[0], wallet.signatureTemplate.unlockP2PKH())
        .addInput(walletUtxo, wallet.signatureTemplate.unlockP2PKH())
        .addOutput({
            to: outflowContract.tokenAddress,
            amount: 1000n,
            token: {
                category: outflowCategory,
                amount: 1n,
            }
        })
        .addOutput({
            to: wallet.address,
            amount: walletUtxo.satoshis - 1000n,
        })
        .send();
    contractUtxos.outflow.utxo = (await outflowContract.getUtxos())[0];

    // hydrate burn
    console.log('hydrating burn');
    walletUtxo = (await provider.getUtxos(wallet.address)).filter(u => !u.token)[0];
    await new TransactionBuilder({ provider })
        .addInput((await provider.getUtxos(wallet.address)).filter(u => u.token?.category === burnCategory)[0], wallet.signatureTemplate.unlockP2PKH())
        .addInput(walletUtxo, wallet.signatureTemplate.unlockP2PKH())
        .addOutput({
            to: burnContract.tokenAddress,
            amount: 1000n,
            token: {
                category: burnCategory,
                amount: 1n,
            }
        })
        .addOutput({
            to: wallet.address,
            amount: walletUtxo.satoshis - 1000n,
        })
        .send();
    contractUtxos.burn.utxo = (await burnContract.getUtxos())[0];

    // hydrate distro
    console.log('hydrating distro');
    walletUtxo = (await provider.getUtxos(wallet.address)).filter(u => !u.token)[0];
    await new TransactionBuilder({ provider })
        .addInput((await provider.getUtxos(wallet.address)).filter(u => u.token?.category === distroCategory)[0], wallet.signatureTemplate.unlockP2PKH())
        .addInput(walletUtxo, wallet.signatureTemplate.unlockP2PKH())
        .addOutput({
            to: distributeContract.tokenAddress,
            amount: 1000n,
            token: {
                category: distroCategory,
                amount: 1n,
            }
        })
        .addOutput({
            to: wallet.address,
            amount: walletUtxo.satoshis - 1000n,
        })
        .send();
    contractUtxos.distribution.utxo = (await distributeContract.getUtxos())[0];


    // --------------------------------------------------

    // mint a basket token
    console.log('minting the basket token', contractUtxos);
    const inflowFee = (await provider.getUtxos(wallet.address)).filter(u => !u.token)[0];
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

    const holding1 = (await asset1HoldingsContract.getUtxos())[0];
    const holding2 = (await asset2HoldingsContract.getUtxos())[0];

    const updated = await provider.getUtxos(wallet.address);
    const outflowFee = updated.filter(u => !u.token)[0];
    const composedToken = updated.filter(u => !!u.token)[0];

    // redeem a basket token
    console.log('redeeming the basket token');
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
}

await main();