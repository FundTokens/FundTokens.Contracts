import type { NetworkProvider } from 'cashscript';
import { FundTokensError } from '../core/errors.js';
import { fundTypes, type FixedBasket, type BchUsdTargetBlend } from './catalog.js';
import { resolveVersion } from './resolve.js';
import type { FundTypeDescriptor, InstanceData, InstanceReference } from './types.js';

type CreatedBy<Versions> = Versions extends { createInstance(options: never): infer R } ? R : never;

/**
 * A resolved instance of any supported fund type version, e.g. `FixedBasket.v1.FixedBasketInstance`.
 * Narrow on `key` (and `version`) when a caller needs a specific one. Planned
 * versions never return from `createInstance`, so they drop out of the union.
 */
export type ResolvedInstance =
    | CreatedBy<(typeof FixedBasket.versions)[keyof typeof FixedBasket.versions]>
    | CreatedBy<(typeof BchUsdTargetBlend.versions)[keyof typeof BchUsdTargetBlend.versions]>;

/** A registry fund resolved against its instance: parsed, with contracts and a builder factory. */
export type ResolvedFund = ReturnType<ResolvedInstance['forFund']> & { readonly instance: ResolvedInstance };

/** A registry fund record as `resolveFund` consumes it; `RegistryFund` satisfies it. */
export interface FundData {
    readonly instanceId?: number | undefined;
    readonly fund: Parameters<ResolvedInstance['forFund']>[0];
}

function fundTypeOf(instance: InstanceReference): FundTypeDescriptor {
    const fundType = fundTypes.find(type => type.key === instance.type);
    if (!fundType) {
        throw new FundTokensError('UNSUPPORTED_FUND_TYPE', `Fund type '${instance.type}' is not known to this library`);
    }
    return fundType;
}

/**
 * Picks the fund type and contract version that operate a registry instance, and
 * returns them bound to a provider: parsed parameters, contracts, and the right
 * version's builder classes.
 *
 * @example
 * const resolver = new FundTypeResolver({ provider });
 * const instance = resolver.resolve(await registry.getCurrentInstance(FixedBasket));
 * const builder = instance.createFundTokenBuilder(fund);
 *
 * const record = await registry.getFund(category);
 * const { fund, contracts, createBuilder } = resolver.resolveFund(record, await registry.getInstance(record.instanceId));
 */
export class FundTypeResolver {
    readonly provider: NetworkProvider;

    constructor({ provider }: { provider: NetworkProvider }) {
        this.provider = provider;
    }

    /** True when this library can operate the instance: a known type with a supported version. */
    static supports(instance: InstanceReference): boolean {
        try {
            resolveVersion(fundTypeOf(instance), instance);
            return true;
        } catch (error) {
            if (error instanceof FundTokensError && error.code === 'UNSUPPORTED_FUND_TYPE') {
                return false;
            }
            throw error;
        }
    }

    /**
     * The instance's fund type version, bound to this resolver's provider. Throws
     * `UNSUPPORTED_FUND_TYPE` for unknown types or versions, and `INVALID_ARGUMENT`
     * for malformed parameters.
     */
    resolve(instance: InstanceData): ResolvedInstance {
        const version = resolveVersion(fundTypeOf(instance), instance);
        return version.createInstance({ provider: this.provider, parameters: instance.parameters }) as ResolvedInstance;
    }

    /** A registry fund on `instance`. Throws `INVALID_ARGUMENT` if the fund belongs to another instance. */
    resolveFund(record: FundData, instance: InstanceData): ResolvedFund {
        if (record.instanceId !== undefined && instance.id !== undefined && record.instanceId !== instance.id) {
            throw new FundTokensError('INVALID_ARGUMENT',
                `The fund belongs to instance ${record.instanceId}, not instance ${instance.id}`);
        }
        const resolved = this.resolve(instance);
        return { ...resolved.forFund(record.fund), instance: resolved };
    }
}
