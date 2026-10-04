import type { Output, SpendableUtxo } from 'cashscript';
import type { BigIntish } from '../../../core/validation.js';

/** One token held by a fund: `amount` units of `category` back each whole fund unit. */
export interface FundAsset {
    readonly category: string;
    readonly amount: bigint;
}

/**
 * A fixed basket fund definition.
 *
 * A "whole fund unit" is `amount` fund tokens; it is backed by `satoshis` BCH and
 * `asset.amount` of each asset. Assets are kept in ascending category order, the
 * order the contracts require.
 */
export interface Fund {
    /** The fund token category; the txid of the genesis UTXO that created it. */
    readonly category: string;
    /** Fund tokens per whole fund unit. */
    readonly amount: bigint;
    /** Satoshis backing each whole fund unit; 0 for no BCH backing. */
    readonly satoshis: bigint;
    readonly assets: readonly FundAsset[];
}

/** A fund as callers may supply it: amounts as bigint, safe integer or decimal string. */
export interface FundInput {
    category: string;
    amount: BigIntish;
    satoshis?: BigIntish | undefined;
    assets?: readonly { category: string; amount: BigIntish }[] | undefined;
}

export interface FeeParameters {
    /** Fee token (NFT) category that marks this fee thread. */
    readonly nft: string;
    /** Default fee in satoshis, charged by fee UTXOs that carry no encoded fee. */
    readonly value: bigint;
}

/** The system parameters of a fixed basket v1 instance, as published by the registry. */
export interface SystemParameters {
    readonly inflow: string;
    readonly outflow: string;
    readonly publicFund: string;
    readonly authorization: string;
    readonly fees: {
        readonly create: FeeParameters;
        readonly execute: FeeParameters;
    };
}

/** System parameters as callers may supply them; the registry returns fee values as numbers. */
export interface SystemParametersInput {
    inflow: string;
    outflow: string;
    publicFund: string;
    authorization: string;
    fees: {
        create: { nft: string; value: BigIntish };
        execute: { nft: string; value: BigIntish };
    };
}

/** A fee enforced by a fee NFT commitment. */
export interface EncodedFee {
    /** Category to pay in; `BitcoinCategory` means BCH. */
    readonly category: string;
    readonly amount: bigint;
    /** Where the fee goes; defaults to the system fee vault when absent. */
    readonly destination?: string | undefined;
}

/** One way of paying a fee, backed by a specific fee contract UTXO. */
export interface FeeOption {
    readonly isBitcoin: boolean;
    readonly category: string;
    readonly amount: bigint;
    readonly destination: string;
    readonly utxo: SpendableUtxo;
}

/** The chosen fee option plus the two outputs it requires: the fee UTXO returned, then the payment. */
export interface SelectedFee extends FeeOption {
    readonly outputs: readonly [Output, Output];
}
