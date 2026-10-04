import { resolveVersion } from '../resolve.js';
import type { InstanceReference } from '../types.js';
import * as v1 from './v1/index.js';

/**
 * Weighted BCH/USD: a fund holding BCH and a USD-pegged token in target weights.
 * PLANNED; the stub reserves the type so it can be recognised before it works.
 */
export const key = 'weighted-bch-usd';
/** Registry `type` of weighted BCH/USD instances. */
export const registryType = 'weighted-bch-usd';
export const name = 'Weighted BCH/USD';
export const description = 'BCH and a USD-pegged token held in target weights. Planned.';

export { v1 };
export const versions = Object.freeze({ v1 });
export const latest = 'v1';

/** Throws `UNSUPPORTED_FUND_TYPE` until a version is supported. */
export const resolve = (instance: InstanceReference): (typeof versions)[keyof typeof versions] =>
    resolveVersion({ key, registryType, name, description, versions, latest }, instance);
