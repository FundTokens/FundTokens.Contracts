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

import { FundTokenTransactionBuilder } from './FundTokenTransactionBuilder.js';

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
    const encoded = encodeCashAddress({ prefix: network === 'mainnet' ? 'bitcoincash' : 'bchtest', type: 'p2pkhWithTokens', payload: pubKeyHash });
    const address = typeof encoded === 'string' ? encoded : encoded.address;
    return { privateKey, pubKeyHex, pubKeyHash, signatureTemplate, address, tokenAddress: address };
};

const provider = new MockNetworkProvider({
    updateUtxoSet: true,
});

const wallet = generateWallet();

// system or fund setup
const inflowUtxo = randomUtxo({
    satoshis: 1000n,
    token: randomNFT({
        amount: 1n,
        nft: {
            capability: 'none',
            commitment: '',
        }
    }),
});

const outflowUtxo = randomUtxo({
    satoshis: 1000n,
    token: randomNFT({
        amount: 1n,
        nft: {
            capability: 'none',
            commitment: '',
        }
    }),
});

const fundUtxo = randomUtxo({
    satoshis: 1000n,
    token: randomToken({
        amount: 2n,
    }),
});



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

const inflowTransactionFee = randomUtxo({
    satoshis: 10000n + 1000n,
});

const inflowCategory = inflowUtxo.token.category;
const outflowCategory = outflowUtxo.token.category;
const asset1Category = asset1.token.category;
//const asset1Amount = XXX; // already declared
const asset2Category = asset2.token.category;
//const asset2Amount = XXX; // already declared



// fund defined settings
const fundCategory = fundUtxo.token.category;
const fundAmount = 1n; // user-defined at mint/redeem
const fundAssets = [{
    category: asset1Category,
    amount: asset1Amount,
}, {
    category: asset2Category,
    amount: asset2Amount,
}];



////// contract setup
const { managerContract, fundContract } = new FundTokenTransactionBuilder({ provider })
    .setFundTokenSystem({ inflowCategory, outflowCategory })
    .buildContracts({
        category: fundCategory,
        amount: fundAmount,
        assets: fundAssets,
    });


// MOCKING //
// hydrate inflow contracts w/ UTXOs
provider.addUtxo(managerContract.tokenAddress, inflowUtxo);
provider.addUtxo(managerContract.tokenAddress, outflowUtxo);

// hydrate fund contract
provider.addUtxo(fundContract.tokenAddress, fundUtxo);

// hydrate wallet w/ UTXOs
provider.addUtxo(wallet.address, asset1);
provider.addUtxo(wallet.address, asset2);
provider.addUtxo(wallet.address, inflowTransactionFee);

// End of mockup setup



///
//
// Below is "minting" a token by locking the fund assets into a contract
//
///
const userUtxoArray = await provider.getUtxos(wallet.tokenAddress);
let asset1Utxo = userUtxoArray.filter(u => u.token?.category == asset1Category && u.token?.amount >= asset1Amount)[0];
let asset2Utxo = userUtxoArray.filter(u => u.token?.category == asset2Category && u.token?.amount >= asset2Amount)[0];

const mintAmount = 1n;

// mint a fund token
const inflowTransaction = (await new FundTokenTransactionBuilder({ provider })
    .setFundTokenSystem({ inflowCategory, outflowCategory })
    .addMint({
        amount: mintAmount,
        fund: {
            category: fundCategory,
            amount: fundAmount,
            assets: fundAssets,
        },
    }))
    .addInputs([asset1Utxo, asset2Utxo, inflowTransactionFee], wallet.signatureTemplate.unlockP2PKH())
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
const outflowTransaction = (await new FundTokenTransactionBuilder({ provider })
    .setFundTokenSystem({ inflowCategory, outflowCategory })
    .addRedeem({
        amount: redeemAmount,
        fund: {
            category: fundCategory,
            amount: fundAmount,
            assets: fundAssets,
        }
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