import type { NetworkProvider } from 'cashscript';
import { deriveFundContracts, deriveSystemContracts, type FundContracts, type SystemContracts } from './contracts.js';
import { decodeFundCommitment } from './encoding.js';
import { FundTokenTransactionBuilder, type FundTokenTransactionBuilderOptions } from './FundTokenTransactionBuilder.js';
import { normalizeFund, parseFund } from './fund.js';
import { parseSystemParameters } from './parameters.js';
import { PublicFundTransactionBuilder, type PublicFundTransactionBuilderOptions } from './PublicFundTransactionBuilder.js';
import type { Fund, FundInput, SystemParameters } from './types.js';

/** Builder options the instance supplies itself. */
type BoundOptions = 'provider' | 'system';

export type PublicFundBuilderOptions = Omit<PublicFundTransactionBuilderOptions, BoundOptions>;
export type FundTokenBuilderOptions = Omit<FundTokenTransactionBuilderOptions, BoundOptions | 'fund'>;

export interface CreateInstanceOptions {
    provider: NetworkProvider;
    /** The instance's system parameters: registry JSON, or already parsed. */
    parameters: unknown;
}

/** A fund on a token basket v1 instance: parsed, with its contracts and a builder for it. */
export interface TokenBasketFund {
    readonly fund: Fund;
    readonly contracts: FundContracts;
    createBuilder(options?: FundTokenBuilderOptions): FundTokenTransactionBuilder;
}

/**
 * One deployed token basket v1 instance, bound to a network provider: its parsed
 * parameters, its contracts, and this version's builder classes. Usually obtained
 * from `FundTypeResolver.resolve(registryInstance)`.
 */
export class TokenBasketInstance {
    readonly key = 'token-basket';
    readonly registryType = 'fixed-basket';
    readonly version = 'v1';

    /** This version's builder classes, for constructing builders directly. */
    readonly PublicFundTransactionBuilder = PublicFundTransactionBuilder;
    readonly FundTokenTransactionBuilder = FundTokenTransactionBuilder;

    readonly provider: NetworkProvider;
    readonly system: SystemParameters;
    readonly contracts: SystemContracts;

    constructor({ provider, parameters }: CreateInstanceOptions) {
        this.provider = provider;
        this.system = parseSystemParameters(parameters);
        this.contracts = deriveSystemContracts(provider, this.system);
    }

    /** A builder for creating funds on this instance. */
    createPublicFundBuilder(options: PublicFundBuilderOptions = {}): PublicFundTransactionBuilder {
        return new PublicFundTransactionBuilder({ ...options, provider: this.provider, system: this.system });
    }

    /** A builder for minting and redeeming `fund`'s tokens. */
    createFundTokenBuilder(fund: FundInput | Fund, options: FundTokenBuilderOptions = {}): FundTokenTransactionBuilder {
        return new FundTokenTransactionBuilder({ ...options, provider: this.provider, system: this.system, fund });
    }

    /** `fund`'s contracts on this instance, without building anything. */
    getFundContracts(fund: FundInput | Fund): FundContracts {
        return deriveFundContracts(this.provider, this.system, normalizeFund(fund));
    }

    /** Validates a fund, e.g. a registry fund record's `fund` (amounts as strings). */
    parseFund(input: FundInput | Fund): Fund {
        return parseFund(input);
    }

    /** Decodes the fund commitment this version publishes on-chain. */
    decodeFundCommitment(hex: string): Fund {
        return decodeFundCommitment(hex);
    }

    /** A fund on this instance, with its contracts and a builder factory. */
    forFund(input: FundInput | Fund): TokenBasketFund {
        const fund = parseFund(input);
        return {
            fund,
            contracts: deriveFundContracts(this.provider, this.system, fund),
            createBuilder: (options: FundTokenBuilderOptions = {}) => this.createFundTokenBuilder(fund, options),
        };
    }
}

export const createInstance = (options: CreateInstanceOptions): TokenBasketInstance => new TokenBasketInstance(options);
