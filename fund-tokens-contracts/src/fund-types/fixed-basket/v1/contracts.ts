import { Contract, type NetworkProvider } from 'cashscript';
import { hexToBin, swapEndianness } from '@bitauth/libauth';
import { BitcoinCategory } from '../../../core/constants.js';
import { hashBytecode, lockingBytecodeHexOf, lockingBytecodeOf } from '../../../core/outputs.js';
import { hashFund, sortAssets } from './encoding.js';
import type { FeeParameters, Fund, SystemParameters } from './types.js';

import assetArtifact from './artifacts/asset.js';
import authHeadVaultArtifact from './artifacts/authhead_vault.js';
import feeArtifact from './artifacts/fee.js';
import feeMinterArtifact from './artifacts/fee_minter.js';
import fundArtifact from './artifacts/fund.js';
import instanceVaultArtifact from './artifacts/instance_vault.js';
import managerArtifact from './artifacts/manager.js';
import mintInflowArtifact from './artifacts/mint_inflow.js';
import mintOutflowArtifact from './artifacts/mint_outflow.js';
import publicArtifact from './artifacts/public.js';
import publicVaultArtifact from './artifacts/public_vault.js';
import simpleMinterArtifact from './artifacts/simple_minter.js';
import simpleVaultArtifact from './artifacts/simple_vault.js';
import startupArtifact from './artifacts/startup.js';

export type AssetManagerContract = Contract<typeof assetArtifact>;
export type AuthHeadVaultContract = Contract<typeof authHeadVaultArtifact>;
export type FeeManagerContract = Contract<typeof feeArtifact>;
export type FeeMinterContract = Contract<typeof feeMinterArtifact>;
export type FundManagerContract = Contract<typeof fundArtifact>;
export type InstanceVaultContract = Contract<typeof instanceVaultArtifact>;
export type TransactionManagerContract = Contract<typeof managerArtifact>;
export type FundInflowMintContract = Contract<typeof mintInflowArtifact>;
export type FundOutflowMintContract = Contract<typeof mintOutflowArtifact>;
export type PublicFundContract = Contract<typeof publicArtifact>;
export type PublicFundVaultContract = Contract<typeof publicVaultArtifact>;
export type SimpleMinterContract = Contract<typeof simpleMinterArtifact>;
export type SimpleVaultContract = Contract<typeof simpleVaultArtifact>;
export type FundStartupContract = Contract<typeof startupArtifact>;

/** Contracts shared by every fund of an instance: fund creation, fees and vaults. */
export interface SystemContracts {
    readonly feeVaultContract: SimpleVaultContract;
    readonly createFundFeeContract: FeeManagerContract;
    readonly executeFundFeeContract: FeeManagerContract;
    readonly startupContract: FundStartupContract;
    readonly mintInflowContract: FundInflowMintContract;
    readonly mintOutflowContract: FundOutflowMintContract;
    readonly publicFundContract: PublicFundContract;
    readonly authHeadVaultContract: AuthHeadVaultContract;
    readonly publicFundVaultContract: PublicFundVaultContract;
}

/** Contracts specific to one fund: its manager, token holder and asset custody. */
export interface FundContracts {
    /** TransactionManager: holds the fund's inflow/outflow thread tokens. */
    readonly managerContract: TransactionManagerContract;
    /** FundManager: holds the fund's unminted token supply. */
    readonly fundContract: FundManagerContract;
    /** AssetManager per asset, in ascending category order (the encoded order, and `normalizeFund`'s). */
    readonly assetContracts: readonly AssetManagerContract[];
    /** AssetManager holding BCH backing; only present when `fund.satoshis > 0`. */
    readonly satoshiAssetContract: AssetManagerContract | undefined;
    /** The execute-fee FeeManager, which inflow and outflow pay through. */
    readonly feeContract: FeeManagerContract;
    readonly feeVaultContract: SimpleVaultContract;
}

const options = (provider: NetworkProvider) => ({ provider });

function deriveFeeVault(provider: NetworkProvider, system: SystemParameters): SimpleVaultContract {
    return new Contract(simpleVaultArtifact, [swapEndianness(system.authorization)], options(provider));
}

function deriveFeeContract(
    provider: NetworkProvider,
    system: SystemParameters,
    feeVaultContract: SimpleVaultContract,
    fee: FeeParameters,
): FeeManagerContract {
    return new Contract(feeArtifact, [
        swapEndianness(system.authorization),
        lockingBytecodeHexOf(feeVaultContract.tokenAddress),
        swapEndianness(fee.nft),
        fee.value,
    ], options(provider));
}

export function deriveSystemContracts(provider: NetworkProvider, system: SystemParameters): SystemContracts {
    const inflow = swapEndianness(system.inflow);
    const outflow = swapEndianness(system.outflow);
    const publicFund = swapEndianness(system.publicFund);
    const authorization = swapEndianness(system.authorization);

    const feeVaultContract = deriveFeeVault(provider, system);
    const createFundFeeContract = deriveFeeContract(provider, system, feeVaultContract, system.fees.create);
    const executeFundFeeContract = deriveFeeContract(provider, system, feeVaultContract, system.fees.execute);
    const executeFeeHash = hashBytecode(executeFundFeeContract.bytecode);

    const startupContract = new Contract(startupArtifact, [
        hashBytecode(createFundFeeContract.bytecode),
        inflow,
        outflow,
    ], options(provider));
    const startupContractHash = hashBytecode(startupContract.bytecode);

    const mintArgs = [
        startupContractHash,
        inflow,
        outflow,
        executeFeeHash,
        hexToBin(managerArtifact.debug.bytecode),
        hexToBin(fundArtifact.debug.bytecode),
        hexToBin(assetArtifact.debug.bytecode),
    ] as const;
    const mintInflowContract = new Contract(mintInflowArtifact, [...mintArgs], options(provider));
    const mintOutflowContract = new Contract(mintOutflowArtifact, [...mintArgs], options(provider));

    const authHeadVaultContract = new Contract(authHeadVaultArtifact, [authorization], options(provider));
    const publicFundVaultContract = new Contract(publicVaultArtifact, [publicFund, authorization], options(provider));

    const publicFundContract = new Contract(publicArtifact, [
        lockingBytecodeHexOf(authHeadVaultContract.tokenAddress),
        lockingBytecodeHexOf(publicFundVaultContract.tokenAddress),
        publicFund,
        startupContractHash,
        fundArtifact.debug.bytecode,
        inflow,
        outflow,
    ], options(provider));

    return Object.freeze({
        feeVaultContract,
        createFundFeeContract,
        executeFundFeeContract,
        startupContract,
        mintInflowContract,
        mintOutflowContract,
        publicFundContract,
        authHeadVaultContract,
        publicFundVaultContract,
    });
}

/** The maintenance contracts that hold each system category's minting NFT. */
export interface MinterContracts {
    readonly inflowMinterContract: SimpleMinterContract;
    readonly outflowMinterContract: SimpleMinterContract;
    readonly publicFundMinterContract: SimpleMinterContract;
    readonly createFeeMinterContract: FeeMinterContract;
    readonly executeFeeMinterContract: FeeMinterContract;
}

/** The SimpleMinters and FeeMinters an instance's deployment seeds its minting NFTs into. */
export function deriveMinterContracts(provider: NetworkProvider, system: SystemParameters): MinterContracts {
    const contracts = deriveSystemContracts(provider, system);
    const authorization = swapEndianness(system.authorization);
    const simpleMinter = (token: string, destination: string) =>
        new Contract(simpleMinterArtifact, [authorization, swapEndianness(token), lockingBytecodeOf(destination)], options(provider));
    const feeMinter = (token: string, destination: string) =>
        new Contract(feeMinterArtifact, [authorization, swapEndianness(token), lockingBytecodeOf(destination)], options(provider));

    return Object.freeze({
        inflowMinterContract: simpleMinter(system.inflow, contracts.mintInflowContract.tokenAddress),
        outflowMinterContract: simpleMinter(system.outflow, contracts.mintOutflowContract.tokenAddress),
        publicFundMinterContract: simpleMinter(system.publicFund, contracts.publicFundContract.tokenAddress),
        createFeeMinterContract: feeMinter(system.fees.create.nft, contracts.createFundFeeContract.tokenAddress),
        executeFeeMinterContract: feeMinter(system.fees.execute.nft, contracts.executeFundFeeContract.tokenAddress),
    });
}

/** The InstanceVault holding the `instance` category's proof and data NFTs. */
export function deriveInstanceVault(provider: NetworkProvider, system: SystemParameters, instance: string): InstanceVaultContract {
    return new Contract(instanceVaultArtifact, [swapEndianness(instance), swapEndianness(system.authorization)], options(provider));
}

export function deriveFundContracts(provider: NetworkProvider, system: SystemParameters, fund: Fund): FundContracts {
    const inflow = swapEndianness(system.inflow);
    const outflow = swapEndianness(system.outflow);
    const category = swapEndianness(fund.category);
    const fundHash = hashFund(fund);

    const feeVaultContract = deriveFeeVault(provider, system);
    const feeContract = deriveFeeContract(provider, system, feeVaultContract, system.fees.execute);

    const managerContract = new Contract(managerArtifact, [
        hashBytecode(feeContract.bytecode),
        inflow,
        outflow,
        category,
        fundHash,
        hexToBin(fundArtifact.debug.bytecode),
        hexToBin(assetArtifact.debug.bytecode),
    ], options(provider));
    const managerLockingBytecode = lockingBytecodeHexOf(managerContract.tokenAddress);

    // The FundManager and every AssetManager only act alongside this fund's TransactionManager.
    const fundContract = new Contract(fundArtifact, [inflow, outflow, category, fundHash, managerLockingBytecode], options(provider));

    // Each AssetManager is bound to the manager and linked to the one redeemed before it
    // (satoshis first, then assets by ascending category); the first links to nothing.
    let linkedAsset = '';
    const assetContract = (assetCategory: string) => {
        const contract = new Contract(assetArtifact, [outflow, fundHash, assetCategory, managerLockingBytecode, linkedAsset], options(provider));
        linkedAsset = lockingBytecodeHexOf(contract.tokenAddress);
        return contract;
    };

    const satoshiAssetContract = fund.satoshis > 0n ? assetContract(BitcoinCategory) : undefined;
    const assetContracts = Object.freeze(sortAssets(fund.assets).map(asset => assetContract(swapEndianness(asset.category))));

    return Object.freeze({
        managerContract,
        fundContract,
        assetContracts,
        satoshiAssetContract,
        feeContract,
        feeVaultContract,
    });
}
