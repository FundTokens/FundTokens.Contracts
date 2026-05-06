import {
    swapEndianness,
    hash256,
    bigIntToBinUint64LEClamped,
    hexToBin,
    binToHex,
    cashAddressToLockingBytecode,
    binToBigIntUint64LE,
    lockingBytecodeToCashAddress,
    getDustThreshold,
} from '@bitauth/libauth';
import { BitcoinCategory } from './constants';

export const withDust = output => {
    const o = {
        lockingBytecode: cashAddressToLockingBytecode(output.to).bytecode,
        valueSatoshis: 0n,
    };
    if(output.token) {
        o.token = {
            ...output.token,
            category: hexToBin(output.token?.category),
        };
    }
    return {
        ...output,
        amount: getDustThreshold(o),
    }
};

export const categoryAscending = (a, b) => {
    return a.category.localeCompare(b.category);
};

// base - 48bytes
// per asset - 40bytes
//
// two = 128bytes
// three = 168bytes
// four = 208bytes
export function getFundHex(fund) {
    const fundClone = {
        ...fund,
        assets: [...fund.assets.map(a => ({ ...a }))],
    };
    const {
        category,
        amount,
        satoshis,
        assets,
    } = fundClone;
    const hex = [];
    hex.push(swapEndianness(category)); // 32 bytes
    hex.push(binToHex(bigIntToBinUint64LEClamped(amount))); // 8 bytes
    hex.push(binToHex(bigIntToBinUint64LEClamped(satoshis))); // 8 bytes
    assets.sort(categoryAscending).map(asset => {
        hex.push(swapEndianness(asset.category)); // 32 bytes
        hex.push(binToHex(bigIntToBinUint64LEClamped(asset.amount))); // 8 bytes
    });
    return hex.join('');
}

export function getFundBin(fund) {
    return hexToBin(getFundHex(fund));
}

export function decodeFund(hex) {
    if(typeof hex !== 'string' && typeof hex !== 'number') {
        throw new Error('provide the fund hex as a string or number');
    }
    hex = typeof hex === 'number' ? hex.toString(16) : hex;

    const fund = {
        category: swapEndianness(hex.slice(0, 64)),
        amount: binToBigIntUint64LE(hexToBin(hex.slice(64, 80))),
        satoshis: binToBigIntUint64LE(hexToBin(hex.slice(80, 96))),
        assets: [],
    };

    let assetsHex = hex.slice(96);

    while(assetsHex.length > 0) {
        fund.assets.push({
            category: swapEndianness(assetsHex.slice(0, 64)),
            amount: binToBigIntUint64LE(hexToBin(assetsHex.slice(64, 80))),
        });
        assetsHex = assetsHex.slice(80);
    }

    return fund;
}

export const hashFund = fund => binToHex(hash256(getFundBin(fund)));

export function decodeFee(hex) {
    const category = swapEndianness(hex.slice(0, 64));
    const amount = binToBigIntUint64LE(hexToBin(hex.slice(64, 80)));
    if(hex.length > 80) {
        const lockingBytecode = hex.slice(80);
        const destination = lockingBytecodeToCashAddress({ bytecode: hexToBin(lockingBytecode), tokenSupport: true });
        return { category, amount, destination: typeof destination === 'string' ? destination : destination.address };
    }
    return { category, amount };
}

export function encodeFee({ category, amount, destination }) {
    if(!amount) {
        throw new Error('Unable to encode fee, amount is required');
    }
    let encoded = swapEndianness(category ?? '0'.repeat(32 * 2)) + binToHex(bigIntToBinUint64LEClamped(amount));
    if(destination) {
        encoded += binToHex(cashAddressToLockingBytecode(destination).bytecode);
    }
    return encoded;
}

// return [{ category: '', amount: 0n }]
export async function getAvailableFees({ feeContract, fee }) {
    if(!feeContract) {
        throw new Error('Expected a fee contract');
    }

    const {
        nft: feeCategory,
        value: defaultValue,
    } = fee;

    const utxos = await feeContract.getUtxos();

    return utxos
        .filter(u => !u.token || u.token.category === feeCategory)
        .reduce((prev, curr) => {
            if(!curr.token) {
                prev[BitcoinCategory] = {
                    category: BitcoinCategory,
                    amount: prev[BitcoinCategory]?.amount < defaultValue ? prev[BitcoinCategory].amount : defaultValue,
                };
            } else {
                const {
                    category,
                    amount,
                } = decodeFee(curr.token.nft.commitment);
                prev[category] = {
                    category,
                    amount: prev[category]?.amount < amount ? prev[category].amount : amount,
                };
            }
            return prev;
        }, {});
}

export async function getBestFee({ feeContract, feeVaultContract, fee, payBy }) {
    if(!feeContract) {
        throw new Error('Expected fee contract');
    }
    
    const defaultDestination = feeVaultContract.tokenAddress;

    const {
        nft,
        value: defaultValue,
    } = fee;
    const feeUtxos = (await feeContract.getUtxos())
        .filter(u => {
            if(!u.token) {
                return true;
            } else {
                return u.token.category === nft;
            }
        })
        .map(u => {
            if(!u.token) {
                return {
                    isBitcoin: true,
                    amount: defaultValue,
                    destination: defaultDestination,
                    utxo: u,
                };
            }

            const encodedFee = decodeFee(u.token.nft.commitment);
            
            return {
                isBitcoin: encodedFee.category === BitcoinCategory,
                category: encodedFee.category,
                amount: encodedFee.amount,
                destination: encodedFee.destination ?? defaultDestination,
                utxo: u,
            };
        })
        .filter(b => {
            const payByBitcoin = !payBy || payBy === '' || payBy === BitcoinCategory;
            if(payByBitcoin) {
                return b.isBitcoin;
            } else {
                return b.category === payBy;
            }
        })
        .sort((a, b) => {
            return a.amount > b.amount;
        });

    if(!feeUtxos || !feeUtxos.length) {
        throw new Error('No acceptable fee UTXOs found');
    }

    const bestFee = feeUtxos[0];

    const result = {
        isBitcoin: bestFee.isBitcoin,
        category: bestFee.category,
        amount: bestFee.amount,
        destination: bestFee.destination,
        utxo: bestFee.utxo,
        outputs: [
            withDust({
                ...bestFee.utxo,
                to: feeContract.tokenAddress,
            }),
        ],
    };

    if(result.isBitcoin) {
        result.outputs.push({
            to: result.destination,
            amount: result.amount,
        });
    } else {
        result.outputs.push(withDust({
            to: result.destination,
            token: {
                category: result.category,
                amount: result.amount,
            }
        }));
    }

    return result;
}

//
export const getRandomInt = max => Math.floor(Math.random() * max);