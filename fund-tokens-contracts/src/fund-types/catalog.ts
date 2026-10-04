import * as FixedBasket from './fixed-basket/index.js';
import * as BchUsdTargetBlend from './bch-usd-target-blend/index.js';
import type { FundTypeDescriptor } from './types.js';

export { FixedBasket, BchUsdTargetBlend };

/** Every fund type this library knows, including planned ones. */
export const fundTypes: readonly FundTypeDescriptor[] = Object.freeze([FixedBasket, BchUsdTargetBlend]);

/** Looks a fund type up by key, e.g. 'fixed-basket' (the registry's instance `type`). */
export function getFundType(key: string): FundTypeDescriptor | undefined {
    return fundTypes.find(type => type.key === key);
}
