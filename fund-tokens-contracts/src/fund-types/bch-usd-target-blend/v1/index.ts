/**
 * BCH/USD Target Blend, contract version 1: PLANNED, not implemented.
 *
 * This stub reserves the module layout and public surface so the type can be
 * recognised (e.g. in registry listings) before it works. To implement it:
 *
 *   1. add the CashScript sources to ./contracts and run `yarn build:contracts`
 *   2. replace the placeholder types and builders below
 *   3. add tests under ./tests
 *   4. set `status` to 'supported'
 */
import { TransactionBuilder, type NetworkProvider } from 'cashscript';
import { FundTokensError } from '../../../core/errors.js';
import type { Logger } from '../../../core/logger.js';

export const id = 'v1';
export const status: 'supported' | 'planned' = 'planned';

/** Placeholder until the v1 contracts define the instance parameters. */
export type SystemParameters = Readonly<Record<string, unknown>>;

/** Placeholder until the v1 contracts define the fund. */
export interface Fund {
    readonly category: string;
}

type TransactionBuilderOptions = ConstructorParameters<typeof TransactionBuilder>[0];

export interface BuilderOptions extends Omit<TransactionBuilderOptions, 'provider'> {
    provider: NetworkProvider;
    system: SystemParameters;
    logger?: Logger | undefined;
}

const notImplemented = (what: string) =>
    new FundTokensError('NOT_IMPLEMENTED', `BCH/USD Target Blend ${what} is planned but not implemented yet`);

export function parseSystemParameters(_input: unknown): SystemParameters {
    throw notImplemented('parseSystemParameters');
}

/** Planned: a BCH/USD target blend instance bound to a provider. Throws `NOT_IMPLEMENTED`. */
export function createInstance(_options: { provider: NetworkProvider; parameters: unknown }): never {
    throw notImplemented('createInstance');
}

/** Planned: creates BCH/USD target blend funds. Throws `NOT_IMPLEMENTED`. */
export class PublicFundTransactionBuilder extends TransactionBuilder {
    constructor(options: BuilderOptions) {
        super({ provider: options.provider });
        throw notImplemented('PublicFundTransactionBuilder');
    }
}

/** Planned: mints and redeems BCH/USD target blend fund tokens. Throws `NOT_IMPLEMENTED`. */
export class FundTokenTransactionBuilder extends TransactionBuilder {
    constructor(options: BuilderOptions & { fund: Fund }) {
        super({ provider: options.provider });
        throw notImplemented('FundTokenTransactionBuilder');
    }
}
