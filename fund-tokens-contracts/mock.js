import {
    MockNetworkProvider,
    SignatureTemplate,
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
} from '@bitauth/libauth';

import FundTokenTransactionBuilder from './FundTokenTransactionBuilder.js';
import BroadcastTokenTransactionBuilder from './BroadcastTokenTransactionBuilder.js';

const secp256k1 = await instantiateSecp256k1();
const ripemd160 = await instantiateRipemd160();
const sha256 = await instantiateSha256();

const network = 'mocknet';

const DustAmount = 1000n;

// 2 assets - mint 2119 - redeem 2251
// 3 assets - mint 2381 - redeem 2543

// mint + 262
// redeem + 292

const generateWallet = () => {
    const privateKey = generatePrivateKey();
    const pubKeyBin = secp256k1.derivePublicKeyCompressed(privateKey);
    const pubKeyHex = binToHex(pubKeyBin);
    const signatureTemplate = new SignatureTemplate(privateKey);
    const pubKeyHash = ripemd160.hash(sha256.hash(pubKeyBin));
    const pubKeyHashHex = binToHex(pubKeyHash);
    const encoded = encodeCashAddress({ prefix: network === 'mainnet' ? 'bitcoincash' : 'bchtest', type: 'p2pkhWithTokens', payload: pubKeyHash });
    const address = typeof encoded === 'string' ? encoded : encoded.address;
    return { privateKey, pubKeyHex, pubKeyHash, pubKeyHashHex, signatureTemplate, address, tokenAddress: address };
};

const provider = new MockNetworkProvider({
    updateUtxoSet: true,
});

const systemOwnerWallet = generateWallet();

const authHeadOwnerWallet = generateWallet();

const systemFeeNft = randomUtxo({
    token: randomNFT(),
});
// amount: bigint;
//     category: string;
//     nft?: {
//         capability: 'none' | 'mutable' | 'minting';
//         commitment: string;
//     };
const defaultSystemFeeUtxo = randomUtxo();
// const bestFeeUtxo = randomUtxo({
//     token: {
//         category: systemFeeNft.token.category,
//         amount: 1n,
//         nft: {
//             capability: 'none',
//             commitment: binToHex(bigIntToBinUint64LEClamped(1000n)) + systemOwnerWallet.pubKeyHex,
//         }
//     }
// });

const inflowMintUtxo = randomUtxo({
    token: randomNFT({
        amount: 0n,
        nft: {
            capability: 'minting',
            commitment: '',
        }
    })
});
const outflowMintUtxo = randomUtxo({
    token: randomNFT({
        amount: 0n,
        nft: {
            capability: 'minting',
            commitment: '',
        }
    })
});

const broadcastSystem = {
    inflow: inflowMintUtxo.token.category,
    outflow: outflowMintUtxo.token.category,
    authHead: authHeadOwnerWallet.pubKeyHashHex,
    fee: {
        pubKey: systemOwnerWallet.pubKeyHex,
        nft: systemFeeNft.token.category,
        value: 1000000n,
    },
    fundFee: {
        pubKey: systemOwnerWallet.pubKeyHex,
        nft: systemFeeNft.token.category,
        value: 1000n
    }
};

const broadcastUtxo = randomUtxo();
const broadcastFeeUtxo = randomUtxo();


const broadcastBuilder = new BroadcastTokenTransactionBuilder({ provider, system: broadcastSystem });


// mock setup
const { broadcastContract, mintContract, feeContract: broadcastFeeContract } = broadcastBuilder.buildContracts();

provider.addUtxo(broadcastContract.tokenAddress, broadcastUtxo);
provider.addUtxo(mintContract.tokenAddress, inflowMintUtxo);
provider.addUtxo(mintContract.tokenAddress, outflowMintUtxo);
provider.addUtxo(broadcastFeeContract.tokenAddress, broadcastFeeUtxo); // default fee

//


///
///
///

const wallet = generateWallet();

const genesisUtxo = randomUtxo({
    satoshis: 1020000n,
    vout: 0,
});

///
provider.addUtxo(wallet.tokenAddress, genesisUtxo);
///


const asset1Amount = 100n; // fund defined amount and category
const asset1 = randomUtxo({
    satoshis: 1000n,
    token: randomToken({
        amount: asset1Amount,
    }),
});
const asset2Amount = 200n; // fund defined amount and category
const asset2 = randomUtxo({
    satoshis: 1000n,
    token: randomToken({
        amount: asset2Amount,
    }),
});

const asset3Amount = 300n; // fund defined amount and category
const asset3 = randomUtxo({
    satoshis: 1000n,
    token: randomToken({
        amount: asset3Amount,
    }),
});

const inflowTransactionFee = randomUtxo({
    satoshis: 10000n + 1000n + 1000n,
});


const asset1Category = asset1.token.category;
//const asset1Amount = XXX; // already declared
const asset2Category = asset2.token.category;
//const asset2Amount = XXX; // already declared
const asset3Category = asset3.token.category;



// fund defined settings
const fundCategory = genesisUtxo.txid; // fundUtxo.token.category;
const fundAmount = 1n; // user-defined at mint/redeem
const fundAssets = [{
    category: asset1Category,
    amount: asset1Amount,
}, {
    category: asset2Category,
    amount: asset2Amount,
}, {
    category: asset3Category,
    amount: asset3Amount,
}];

const fund = {
    category: fundCategory,
    amount: fundAmount,
    satoshis: 0n,
    assets: fundAssets,
};


const broadcastTransaction = await broadcastBuilder.newBroadcastTransaction({ fund, genesis: { utxo: genesisUtxo, unlocker: wallet.signatureTemplate.unlockP2PKH() } });

const broadcastDetails = await broadcastTransaction.send();
console.log('broadcast size:', broadcastDetails.hex.length / 2);


//
//
//


const system = {
    inflow: inflowMintUtxo.token.category,
    outflow: outflowMintUtxo.token.category,
    fee: {
        pubKey: systemOwnerWallet.pubKeyHex,
        nft: systemFeeNft.token.category,
        value: 1000n,
    },
};

const fundTokenTransactionBuilder = new FundTokenTransactionBuilder({ provider, system });

////// contract setup
const { managerContract, feeContract } = fundTokenTransactionBuilder.buildFundContracts(fund);



// hydrate fund contract
provider.addUtxo(feeContract.tokenAddress, defaultSystemFeeUtxo);

// hydrate wallet w/ UTXOs
provider.addUtxo(wallet.address, asset1);
provider.addUtxo(wallet.address, asset2);
provider.addUtxo(wallet.address, asset3);
provider.addUtxo(wallet.address, inflowTransactionFee);

// End of initial setup



///
//
// Below is "minting" a token by locking the fund assets into a contract
//
///
const userUtxoArray = await provider.getUtxos(wallet.tokenAddress);
let asset1Utxo = userUtxoArray.filter(u => u.token?.category == asset1Category && u.token?.amount >= asset1Amount)[0];
let asset2Utxo = userUtxoArray.filter(u => u.token?.category == asset2Category && u.token?.amount >= asset2Amount)[0];
let asset3Utxo = userUtxoArray.filter(u => u.token?.category == asset3Category && u.token?.amount >= asset3Amount)[0];

const mintAmount = 1n;

// mint a fund token
const inflowTransaction = (await fundTokenTransactionBuilder
    .newMintTransaction({
        amount: mintAmount,
        fund,
    }))
    .addInputs([asset1Utxo, asset2Utxo, asset3Utxo, inflowTransactionFee], wallet.signatureTemplate.unlockP2PKH())
    .addOutputs([
        {
            to: wallet.address,
            amount: 10000n,
        },
        {
            to: wallet.address,
            amount: 1000n,
            token: {
                category: fundCategory,
                amount: fundAmount,
            }
        }
    ]);

const inflowDetails = await inflowTransaction.send();
console.log('inflow size:', inflowDetails.hex.length / 2);


///
//
// Below is "redeeming" a token by locking the fund token and releasing the fund's assets
//
///

const updated = await provider.getUtxos(wallet.address);
const outflowTransactionFee = updated.filter(u => !u.token)[0];
const fundToken = updated.filter(u => !!u.token)[0];

const redeemAmount = 1n;

// redeem a fund token
const outflowTransaction = (await fundTokenTransactionBuilder
    .newRedeemTransaction({
        amount: redeemAmount,
        fund,
    }))
    .addInput(fundToken, wallet.signatureTemplate.unlockP2PKH())
    .addOutputs([
        {
            to: wallet.address,
            amount: DustAmount,
            token: {
                category: asset1Category,
                amount: asset1Amount * redeemAmount,
            },
        },
        {
            to: wallet.address,
            amount: DustAmount,
            token: {
                category: asset2Category,
                amount: asset2Amount * redeemAmount,
            }
        },
        {
            to: wallet.address,
            amount: DustAmount,
            token: {
                category: asset3Category,
                amount: asset3Amount * redeemAmount,
            }
        }
    ])
    //
    .addInput(outflowTransactionFee, wallet.signatureTemplate.unlockP2PKH())
    .addOutput({
        to: wallet.address,
        amount: 5000n,
    });

const outflowDetails = await outflowTransaction.send();
console.log('outflow size:', outflowDetails.hex.length / 2);