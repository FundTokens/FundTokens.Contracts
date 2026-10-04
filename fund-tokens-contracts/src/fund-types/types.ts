import type { NetworkProvider } from 'cashscript';

/** `supported`: builders work. `planned`: declared so it can be recognised, not usable yet. */
export type FundTypeVersionStatus = 'supported' | 'planned';

/** What every fund type version module exports about itself. */
export interface FundTypeVersion {
    /** The contract version, e.g. 'v1'. Each version has its own frozen copy of contracts. */
    readonly id: string;
    readonly status: FundTypeVersionStatus;
    /** Binds an instance's parameters to a provider (see `FundTypeResolver`). Planned versions throw. */
    createInstance(options: { provider: NetworkProvider; parameters: unknown }): unknown;
}

/** What every fund type module exports about itself. */
export interface FundTypeDescriptor {
    /** The fund type, e.g. 'fixed-basket': the library's name for it and the registry's instance `type`. */
    readonly key: string;
    readonly name: string;
    readonly description: string;
    readonly versions: Readonly<Record<string, FundTypeVersion>>;
    readonly latest: string;
}

/** The fields of a registry instance that decide which fund type version operates it. */
export interface InstanceReference {
    readonly type: string;
    readonly version: string;
}

/** A registry instance as `FundTypeResolver` consumes it; `RegistryInstance` satisfies it. */
export interface InstanceData extends InstanceReference {
    readonly id?: number | undefined;
    readonly parameters: unknown;
}
