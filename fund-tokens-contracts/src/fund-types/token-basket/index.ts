import { resolveVersion } from '../resolve.js';
import type { InstanceReference } from '../types.js';
import * as v1 from './v1/index.js';

/**
 * Token basket: a fund backed by a fixed basket of BCH and CashTokens, set when
 * the fund is created. Each fund token is redeemable for its share of the basket.
 */
export const key = 'token-basket';
/** Registry `type` of token basket instances. */
export const registryType = 'fixed-basket';
export const name = 'Token Basket';
export const description = 'A fixed basket of BCH and CashTokens, set when the fund is created.';

export { v1 };
export const versions = Object.freeze({ v1 });
export const latest = 'v1';

/** The token basket version that operates a registry instance; throws `UNSUPPORTED_FUND_TYPE` if none does. */
export const resolve = (instance: InstanceReference): (typeof versions)[keyof typeof versions] =>
    resolveVersion({ key, registryType, name, description, versions, latest }, instance);
