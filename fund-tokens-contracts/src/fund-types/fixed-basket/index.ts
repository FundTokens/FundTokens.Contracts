import { resolveVersion } from '../resolve.js';
import type { InstanceReference } from '../types.js';
import * as v1 from './v1/index.js';

/**
 * Fixed basket: a fund backed by a fixed basket of BCH and CashTokens, set when
 * the fund is created. Each fund token is redeemable for its share of the basket.
 */
/** The fund type: the library's name for it and the registry's instance `type`. */
export const key = 'fixed-basket';
export const name = 'Fixed Basket';
export const description = 'A fixed basket of BCH and CashTokens, set when the fund is created.';

export { v1 };
export const versions = Object.freeze({ v1 });
export const latest = 'v1';

/** The fixed basket version that operates a registry instance; throws `UNSUPPORTED_FUND_TYPE` if none does. */
export const resolve = (instance: InstanceReference): (typeof versions)[keyof typeof versions] =>
    resolveVersion({ key, name, description, versions, latest }, instance);
