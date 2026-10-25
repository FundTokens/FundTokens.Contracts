import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { FundTokensError } from '../core/errors.js';
import { getFundType } from '../fund-types/catalog.js';
import { resolveVersion } from '../fund-types/resolve.js';
import type { InstanceData } from '../fund-types/types.js';

/** How many hex characters of an instance hash name its folder (`getInstanceFolder`): 64 bits. */
export const InstanceFolderHashLength = 16;

const HASH_REGEX = /^[0-9a-f]{64}$/;

// JSON with every object's keys sorted, and no whitespace, so equal values serialize the same
const canonicalJson = (value: unknown): string => {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
    }
    return JSON.stringify(value);
};

/**
 * The hash that identifies an instance across the registry, the dashboard and the dApp: sha256, as
 * hex, of the canonical JSON of its fund type, contract version and identity parameters (the
 * version's `getIdentityParameters`: for fixed basket v1, the system parameters and the instance
 * proof category). Throws `UNSUPPORTED_FUND_TYPE` for a type or version this library can't hash,
 * and `INVALID_ARGUMENT` for invalid parameters.
 */
export function getInstanceHash(instance: Pick<InstanceData, 'type' | 'version' | 'parameters'>): string {
    const fundType = getFundType(instance.type);
    if (!fundType) {
        throw new FundTokensError('UNSUPPORTED_FUND_TYPE', `Unknown fund type '${instance.type}'`);
    }
    const version = resolveVersion(fundType, instance);
    if (!version.getIdentityParameters) {
        throw new FundTokensError('UNSUPPORTED_FUND_TYPE', `${fundType.name} ${version.id} instances can't be hashed`);
    }
    const json = canonicalJson({ type: fundType.key, version: version.id, parameters: version.getIdentityParameters(instance.parameters) });
    return binToHex(sha256.hash(utf8ToBin(json)));
}

/** The folder an instance's files are published under: `h` and the first 16 hex characters of its hash. */
export function getInstanceFolder(hash: string): string {
    if (!HASH_REGEX.test(hash)) {
        throw new FundTokensError('INVALID_ARGUMENT', `An instance hash must be 64 lowercase hex characters, got '${hash}'`);
    }
    return `h${hash.slice(0, InstanceFolderHashLength)}`;
}
