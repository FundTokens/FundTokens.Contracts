import { FundTokensError } from '../core/errors.js';
import type { FundTypeDescriptor, FundTypeVersion, InstanceReference } from './types.js';

/** The version of `fundType` that operates `instance`; throws `UNSUPPORTED_FUND_TYPE` when there is none. */
export function resolveVersion<T extends FundTypeDescriptor>(
    fundType: T,
    instance: InstanceReference,
): T['versions'][keyof T['versions']] {
    if (instance.type !== fundType.registryType) {
        throw new FundTokensError('UNSUPPORTED_FUND_TYPE',
            `Instance type '${instance.type}' is not ${fundType.name} ('${fundType.registryType}')`);
    }

    // Registry instances record the contract version id, which is independent of the npm package version.
    const version = Object.values(fundType.versions).find((candidate: FundTypeVersion) => candidate.id === instance.version);

    if (!version) {
        throw new FundTokensError('UNSUPPORTED_FUND_TYPE',
            `${fundType.name} version '${instance.version}' is not supported by this library; `
            + `known versions: ${Object.keys(fundType.versions).join(', ')}`);
    }
    if (version.status !== 'supported') {
        throw new FundTokensError('UNSUPPORTED_FUND_TYPE', `${fundType.name} ${version.id} is ${version.status}, not yet usable`);
    }
    return version as T['versions'][keyof T['versions']];
}
