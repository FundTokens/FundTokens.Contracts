import * as TokenBasket from './token-basket/index.js';
import * as WeightedBchUsd from './weighted-bch-usd/index.js';
import type { FundTypeDescriptor } from './types.js';

export { TokenBasket, WeightedBchUsd };

/** Every fund type this library knows, including planned ones. */
export const fundTypes: readonly FundTypeDescriptor[] = Object.freeze([TokenBasket, WeightedBchUsd]);

/** Looks a fund type up by library key ('token-basket') or registry type ('fixed-basket'). */
export function getFundType(keyOrRegistryType: string): FundTypeDescriptor | undefined {
    return fundTypes.find(type => type.key === keyOrRegistryType || type.registryType === keyOrRegistryType);
}
