import {
    Network,
} from 'cashscript';
import {
    swapEndianness,
    hash256,
    bigIntToBinUint64LEClamped,
    hexToBin,
    binToHex,
    instantiateRipemd160,
    instantiateSha256,
    encodeCashAddress,
} from '@bitauth/libauth';

const ripemd160 = await instantiateRipemd160();
const sha256 = await instantiateSha256();

// base - 48bytes
// per asset - 40bytes
//
// two = 128bytes
// three = 168bytes
// four = 208bytes
export function getFundHex(fund) {
    const {
        category,
        amount,
        satoshis,
        assets,
    } = fund;
    const hex = [];
    hex.push(swapEndianness(category)); // 32 bytes
    hex.push(binToHex(bigIntToBinUint64LEClamped(amount))); // 8 bytes
    hex.push(binToHex(bigIntToBinUint64LEClamped(satoshis))); // 8 bytes TODO: consider trimming in size
    assets.map(asset => {
        hex.push(swapEndianness(asset.category)); // 32 bytes
        hex.push(binToHex(bigIntToBinUint64LEClamped(asset.amount))); // 8 bytes
    });
    return hexToBin(hex.join(''));
}

export function getFund(hex) {
    if(typeof hex !== 'string' && typeof hex !== 'number') {
        throw new Error('provide the fund hex as a string or number');
    }
    hex = typeof hex === 'number' ? hex.toString(16) : hex;

    const fund = {
        category: hex.substring(0, 32),
        amount: hex.substring(32, 40),
        satoshis: hex.substring(40, 48),
        assets: hex.slice(48),
    };

    // TODO assets

    return fund;
}

export const hashFund = fund => binToHex(hash256(getFundHex(fund)));

export async function getBestFee({ feeContract, payBy, fee }) {
    const network = feeContract.provider.network;
    const {
        pubKey,
        nft,
        value: defaultValue,
    } = fee;
    const feeUtxos = (await feeContract.getUtxos()).filter(u => {
        const payByBitcoin = !payBy || payBy === '';
        if(!!u.token && u.token.category === nft) {
            const feeType = u.token.nftCommittment; // TODO
            if(feeType === '000000') {
                return payByBitcoin;
            } else {
                return !payByBitcoin;
            }
        }
        return payByBitcoin && !u.token;
    }).sort((a, b) => {
        let aAmount = a.satoshis;
        let bAmount = b.satoshis;
        if(a.token) {
            aAmount = a.token.nftCommittment; // TODO: split
        }
        if(b.token) {
            bAmount = b.token.nftCommittment; // TODO: split
        }
        return aAmount > bAmount;
    }); // TODO need to verify sort func and check nfts too

    if(!feeUtxos) {
        return null;
    }

    const feeUtxo = feeUtxos[0];

    const pubKeyBin = hexToBin(pubKey);
    const pubKeyHash = ripemd160.hash(sha256.hash(pubKeyBin));
    const encoded = encodeCashAddress({ prefix: network === Network.MAINNET ? 'bitcoincash' : 'bchtest', type: 'p2pkhWithTokens', payload: pubKeyHash });
    const address = typeof encoded === 'string' ? encoded : encoded.address;

    
    const bestFee = { //TODO
        isBitcoin: true,
        category: null,
        amount: feeUtxo.token ? 0 : defaultValue,
        destination: address,
        utxo: feeUtxo,
    };
    return bestFee;
}