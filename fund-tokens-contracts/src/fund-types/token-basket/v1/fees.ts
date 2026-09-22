import {
    assertSuccess,
    bigIntToBinUint64LEClamped,
    binToBigIntUint64LE,
    binToHex,
    hexToBin,
    lockingBytecodeToCashAddress,
    swapEndianness,
} from '@bitauth/libauth';
import type { Output, Utxo } from 'cashscript';
import { BitcoinCategory, MaxTokenAmount } from '../../../core/constants.js';
import { FundTokensError } from '../../../core/errors.js';
import { getAddressPrefix } from '../../../core/network.js';
import { lockingBytecodeHexOf, withDust } from '../../../core/outputs.js';
import { pickRandom } from '../../../core/random.js';
import { assertCategory, assertInRange, isHex, toBigInt, type BigIntish } from '../../../core/validation.js';
import type { FeeManagerContract, SimpleVaultContract } from './contracts.js';
import type { EncodedFee, FeeOption, FeeParameters, SelectedFee } from './types.js';

/**
 * Fee NFT commitment (type 0x01, an enforced fee):
 *
 *   0x01 | category (32 bytes, byte-reversed) | amount (8 bytes LE) | destination locking bytecode (optional)
 *
 * The fee contract also accepts type 0x02 (voluntary, nothing enforced); the
 * builders never select those threads.
 */
const EnforcedFeeType = '01';
const EnforcedFeeMinHexLength = 2 + 64 + 16;

export function encodeFee({ category, amount, destination }: {
    category?: string | undefined;
    amount: BigIntish;
    destination?: string | undefined;
}): string {
    const feeAmount = assertInRange(toBigInt(amount, 'fee.amount'), 'fee.amount', 1n, MaxTokenAmount);
    const feeCategory = assertCategory(category ?? BitcoinCategory, 'fee.category');
    return EnforcedFeeType
        + swapEndianness(feeCategory)
        + binToHex(bigIntToBinUint64LEClamped(feeAmount))
        + (destination ? lockingBytecodeHexOf(destination) : '');
}

/** Decodes an enforced (type 0x01) fee commitment. `network` or `prefix` sets the destination address format. */
export function decodeFee({ hex, network, prefix }: {
    hex: string;
    network?: string | undefined;
    prefix?: 'bitcoincash' | 'bchtest' | 'bchreg' | undefined;
}): EncodedFee {
    if (!isHex(hex) || hex.length < EnforcedFeeMinHexLength) {
        throw new FundTokensError('INVALID_ENCODING', 'Fee commitment is too short or not hex');
    }
    const data = hex.toLowerCase();
    if (data.slice(0, 2) !== EnforcedFeeType) {
        throw new FundTokensError('INVALID_ENCODING', `Fee commitment type must be 0x${EnforcedFeeType}, got 0x${data.slice(0, 2)}`);
    }

    const category = swapEndianness(data.slice(2, 66));
    const amount = binToBigIntUint64LE(hexToBin(data.slice(66, 82)));
    if (data.length === EnforcedFeeMinHexLength) {
        return { category, amount };
    }

    const { address } = assertSuccess(lockingBytecodeToCashAddress({
        prefix: prefix ?? getAddressPrefix(network ?? 'mainnet'),
        bytecode: hexToBin(data.slice(EnforcedFeeMinHexLength)),
        tokenSupport: true,
    }));
    return { category, amount, destination: address };
}

/** Decodes a fee UTXO into a payment option, or undefined for threads the builders can't use. */
function toFeeOption(utxo: Utxo, fee: FeeParameters, network: string, defaultDestination: string): FeeOption | undefined {
    if (!utxo.token) {
        return { isBitcoin: true, category: BitcoinCategory, amount: fee.value, destination: defaultDestination, utxo };
    }
    if (utxo.token.category !== fee.nft || !utxo.token.nft) {
        return undefined;
    }
    try {
        const encoded = decodeFee({ network, hex: utxo.token.nft.commitment });
        return {
            isBitcoin: encoded.category === BitcoinCategory,
            category: encoded.category,
            amount: encoded.amount,
            destination: encoded.destination ?? defaultDestination,
            utxo,
        };
    } catch {
        // Voluntary (0x02) or malformed fee threads are not selectable.
        return undefined;
    }
}

const isBitcoinPayment = (payBy: string | undefined): boolean => !payBy || payBy === BitcoinCategory;

/**
 * The cheapest available fee per payment category, keyed by category.
 * Plain fee UTXOs (no NFT) cost the default `fee.value` in BCH.
 */
export async function getAvailableFees({ feeContract, fee }: {
    feeContract: FeeManagerContract;
    fee: FeeParameters;
}): Promise<Record<string, { category: string; amount: bigint }>> {
    const network = feeContract.provider.network;
    const cheapest: Record<string, { category: string; amount: bigint }> = {};

    for (const utxo of await feeContract.getUtxos()) {
        const option = toFeeOption(utxo, fee, network, '');
        if (!option) continue;
        const current = cheapest[option.category];
        if (!current || option.amount < current.amount) {
            cheapest[option.category] = { category: option.category, amount: option.amount };
        }
    }
    return cheapest;
}

/**
 * Chooses the cheapest fee UTXO payable in `payBy` (default BCH) and builds the
 * two outputs the fee contract requires: the fee UTXO returned to its contract,
 * then the payment. Ties are broken randomly to spread load across fee threads.
 */
export async function getBestFee({ feeContract, feeVaultContract, fee, payBy }: {
    feeContract: FeeManagerContract;
    feeVaultContract: SimpleVaultContract;
    fee: FeeParameters;
    payBy?: string | undefined;
}): Promise<SelectedFee> {
    if (feeContract.provider.network !== feeVaultContract.provider.network) {
        throw new FundTokensError('INVALID_ARGUMENT', 'The fee and fee vault contracts must use the same network');
    }
    const payByCategory = isBitcoinPayment(payBy) ? BitcoinCategory : assertCategory(payBy, 'payBy');

    const options = (await feeContract.getUtxos())
        .map(utxo => toFeeOption(utxo, fee, feeContract.provider.network, feeVaultContract.tokenAddress))
        .filter((option): option is FeeOption => option !== undefined && option.category === payByCategory);

    if (!options.length) {
        const currency = payByCategory === BitcoinCategory ? 'BCH' : `token ${payByCategory}`;
        throw new FundTokensError('MISSING_UTXO', `No fee thread accepts payment in ${currency} at ${feeContract.tokenAddress}`);
    }

    const lowest = options.reduce((min, option) => (option.amount < min ? option.amount : min), options[0]!.amount);
    const best = pickRandom(options.filter(option => option.amount === lowest))!;

    const returned = withDust({ to: feeContract.tokenAddress, token: best.utxo.token });
    const payment: Output = best.isBitcoin
        ? { to: best.destination, amount: best.amount }
        : withDust({ to: best.destination, token: { category: best.category, amount: best.amount } });

    return { ...best, outputs: [returned, payment] };
}
