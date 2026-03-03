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
    hexToBin,
    encodeCashAddress,
    decodeTransaction,
} from '@bitauth/libauth';

import FundTokenTransactionBuilder from './FundTokenTransactionBuilder.js';
import PublicFundTransactionBuilder from './PublicFundTransactionBuilder.js';

const secp256k1 = await instantiateSecp256k1();
const ripemd160 = await instantiateRipemd160();
const sha256 = await instantiateSha256();

const network = 'mocknet';

const DustAmount = 1000n;

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

const createFundNft = randomUtxo({
    token: randomNFT(),
});
const defaultCreateFundFee = randomUtxo();

const fundFeeNft = randomUtxo({
    token: randomNFT(),
});
const defaultFundFee = randomUtxo();

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

const publicFundSystem = {
    inflow: inflowMintUtxo.token.category,
    outflow: outflowMintUtxo.token.category,
    authHead: authHeadOwnerWallet.pubKeyHashHex,
    fees: {
        create: {
            pubKey: systemOwnerWallet.pubKeyHex,
            nft: fundFeeNft.token.category,
            value: 1000000n,
        },
        execute: {
            pubKey: systemOwnerWallet.pubKeyHex,
            nft: fundFeeNft.token.category,
            value: 1000n
        }
    },
};

const startupUtxo = randomUtxo();
const startupFeeUtxo = randomUtxo();


const publicFundBuilder = new PublicFundTransactionBuilder({ provider, system: publicFundSystem });

///
// mock setup
///
const { startupContract, mintContract, feeContract: broadcastFeeContract } = publicFundBuilder.buildContracts();

provider.addUtxo(startupContract.tokenAddress, startupUtxo);
provider.addUtxo(mintContract.tokenAddress, inflowMintUtxo);
provider.addUtxo(mintContract.tokenAddress, outflowMintUtxo);
provider.addUtxo(broadcastFeeContract.tokenAddress, startupFeeUtxo); // default fee

///
// create a new fund
///
const userWallet = generateWallet();

const genesisUtxo = randomUtxo({
    satoshis: 1020000n,
    vout: 0,
});

///
// mock setup
///
provider.addUtxo(userWallet.tokenAddress, genesisUtxo);


///
// fund configuration
///
const fundSatoshis = 0n;

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

const asset1Category = asset1.token.category;
const asset2Category = asset2.token.category;
const asset3Category = asset3.token.category;

// fund defined settings
const fundCategory = genesisUtxo.txid; // user provided UTXO
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
    satoshis: fundSatoshis,
    assets: fundAssets,
};

///
// broadcast a new fund transaction
///
const broadcastTransaction = await publicFundBuilder.newBroadcastTransaction({ fund, genesis: { utxo: genesisUtxo, unlocker: userWallet.signatureTemplate.unlockP2PKH() } });
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
        nft: fundFeeNft.token.category,
        value: 1000n,
    },
};

const fundTokenTransactionBuilder = new FundTokenTransactionBuilder({ provider, system });

////// contract setup
const { managerContract, feeContract } = fundTokenTransactionBuilder.buildFundContracts(fund);



// hydrate fund contract
provider.addUtxo(feeContract.tokenAddress, defaultFundFee);

const inflowTransactionFee = randomUtxo({
    satoshis: 10000n + 1000n + 1000n,
});

// hydrate wallet w/ UTXOs
provider.addUtxo(userWallet.address, asset1);
provider.addUtxo(userWallet.address, asset2);
provider.addUtxo(userWallet.address, asset3);
provider.addUtxo(userWallet.address, inflowTransactionFee);

// End of initial setup



///
//
// Below is "minting" a token by locking the fund assets into a contract
//
///
const userUtxoArray = await provider.getUtxos(userWallet.tokenAddress);
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
    .addInputs([asset1Utxo, asset2Utxo, asset3Utxo, inflowTransactionFee], userWallet.signatureTemplate.unlockP2PKH())
    .addOutputs([
        {
            to: userWallet.address,
            amount: 10000n,
        },
        {
            to: userWallet.address,
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

const updated = await provider.getUtxos(userWallet.address);
const outflowTransactionFee = updated.filter(u => !u.token)[0];
const fundToken = updated.filter(u => !!u.token)[0];

const redeemAmount = 1n;

// redeem a fund token
const outflowTransaction = (await fundTokenTransactionBuilder
    .newRedeemTransaction({
        amount: redeemAmount,
        fund,
    }))
    .addInput(fundToken, userWallet.signatureTemplate.unlockP2PKH())
    .addOutputs([
        {
            to: userWallet.address,
            amount: DustAmount,
            token: {
                category: asset1Category,
                amount: asset1Amount * redeemAmount,
            },
        },
        {
            to: userWallet.address,
            amount: DustAmount,
            token: {
                category: asset2Category,
                amount: asset2Amount * redeemAmount,
            }
        },
        {
            to: userWallet.address,
            amount: DustAmount,
            token: {
                category: asset3Category,
                amount: asset3Amount * redeemAmount,
            }
        }
    ])
    //
    .addInput(outflowTransactionFee, userWallet.signatureTemplate.unlockP2PKH())
    .addOutput({
        to: userWallet.address,
        amount: 5000n,
    });

const outflowDetails = await outflowTransaction.send();
console.log('outflow size:', outflowDetails.hex.length / 2);