/**
 * @fundtokens/builders
 *
 * - `FundTokensRegistry`: read the FundTokens registry (instances, funds, metadata).
 * - Fund types, each with frozen contract versions and their builders:
 *     `FixedBasket.v1`     fixed basket ('fixed-basket')
 *     `BchUsdTargetBlend.v1`  planned, not implemented
 * - Shared primitives: errors, constants, output helpers.
 *
 * Fund type versions are also importable directly, e.g. '@fundtokens/builders/fixed-basket/v1'.
 */
export * from './core/index.js';
export * from './fund-types/index.js';
export * from './registry/index.js';
