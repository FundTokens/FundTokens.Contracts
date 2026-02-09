import {
    swapEndianness,
    hash256,
    bigIntToBinUint64LEClamped,
    hexToBin,
    binToHex,
} from '@bitauth/libauth';

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

export const hashFund = fund => binToHex(hash256(getFundHex(fund)));