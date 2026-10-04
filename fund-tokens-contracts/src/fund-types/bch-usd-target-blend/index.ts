import { resolveVersion } from '../resolve.js';
import type { InstanceReference } from '../types.js';
import * as v1 from './v1/index.js';

/**
 * BCH/USD Target Blend: a fund holding BCH and a USD-pegged token in target weights.
 * PLANNED; the stub reserves the type so it can be recognised before it works.
 */
/** The fund type: the library's name for it and the registry's instance `type`. */
export const key = 'bch-usd-target-blend';
export const name = 'BCH/USD Target Blend';
export const description = 'BCH and a USD-pegged token held in target weights. Planned.';

export { v1 };
export const versions = Object.freeze({ v1 });
export const latest = 'v1';

/** Throws `UNSUPPORTED_FUND_TYPE` until a version is supported. */
export const resolve = (instance: InstanceReference): (typeof versions)[keyof typeof versions] =>
    resolveVersion({ key, name, description, versions, latest }, instance);
