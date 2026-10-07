/**
 * Fixed basket, contract version 1.
 *
 * Everything here is bound to this version's contracts in ./contracts. Those are
 * frozen: a contract change ships as a new version directory, never as an edit here.
 */
export const id = 'v1';
export const status = 'supported';

export {
    createInstance,
    FixedBasketInstance,
    type CreateInstanceOptions,
    type FundTokenBuilderOptions,
    type PublicFundBuilderOptions,
    type FixedBasketFund,
} from './instance.js';
export { FundTokenTransactionBuilder, type FundFlowOptions, type FundTokenTransactionBuilderOptions } from './FundTokenTransactionBuilder.js';
export { PublicFundTransactionBuilder, type BroadcastOptions, type PublicFundTransactionBuilderOptions } from './PublicFundTransactionBuilder.js';
export {
    deriveFundContracts,
    deriveSystemContracts,
    type AssetManagerContract,
    type AuthHeadVaultContract,
    type FeeManagerContract,
    type FundContracts,
    type FundInflowMintContract,
    type FundManagerContract,
    type FundOutflowMintContract,
    type FundStartupContract,
    type PublicFundContract,
    type PublicFundVaultContract,
    type SimpleVaultContract,
    type SystemContracts,
    type TransactionManagerContract,
} from './contracts.js';
export {
    categoryAscending,
    decodeFund,
    decodeFundCommitment,
    getFundBin,
    getFundCommitment,
    getFundHex,
    getPadding,
    getThreadCommitment,
    hashFund,
    MaxPaddingBytes,
    sortAssets,
} from './encoding.js';
export { decodeFee, encodeFee, getAvailableFees, getBestFee } from './fees.js';
export {
    authorizationNfts,
    bcmrNfts,
    feeNfts,
    getSystemRegistry,
    inflowNfts,
    instanceNfts,
    outflowNfts,
    publicFundNfts,
    SystemRegistryPlaceholders,
    type BcmrFieldEncoding,
    type BcmrParsableNfts,
    type BcmrRegistry,
    type SystemCategories,
} from './bcmr.js';
export { MaxFundAssets, normalizeFund, parseFund, validateFund } from './fund.js';
export { parseSystemParameters } from './parameters.js';
export * as artifacts from './artifacts/index.js';
export type {
    EncodedFee,
    FeeOption,
    FeeParameters,
    Fund,
    FundAsset,
    FundInput,
    SelectedFee,
    SystemParameters,
    SystemParametersInput,
} from './types.js';
