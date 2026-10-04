/** Instance lifecycle: pre-release, main (recommended), deprecated, vulnerable (do not use). */
export type RegistryInstanceStatus = 'pre' | 'main' | 'dep' | 'vul';

/** A deployed set of FundTokens system contracts that the registry indexes. */
export interface RegistryInstance {
    readonly id: number;
    readonly name: string;
    readonly network: string;
    /** Registry fund type, e.g. 'fixed-basket'. See `getFundType`. */
    readonly type: string;
    readonly status: RegistryInstanceStatus;
    /** The contract version (e.g. 'v1') or, for older instances, the library release that deployed it. */
    readonly version: string;
    readonly txid: string | null;
    /**
     * The instance's system parameters, as JSON. Their shape depends on the fund
     * type version: parse with that version's `parseSystemParameters`.
     */
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly syncedHeight: number;
    readonly createdAt: string;
    readonly updatedAt: string;
}

/** A fund definition as the registry serialises it: amounts are decimal strings. */
export interface RegistrySerializedFund {
    readonly category: string;
    readonly amount: string;
    readonly satoshis: string;
    readonly assets: readonly { readonly category: string; readonly amount: string }[];
}

export interface RegistryFund {
    readonly category: string;
    readonly instanceId: number;
    readonly genesisTxid: string;
    readonly genesisHeight: number;
    readonly genesisTimestamp: number;
    readonly lockingBytecode: string;
    /** Parse with the instance's fund type version, e.g. `TokenBasket.v1.parseFund`. */
    readonly fund: RegistrySerializedFund;
    readonly authheadTxid: string;
    readonly authheadHeight: number;
    readonly burned: boolean;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface RegistryAuthchainEntry {
    readonly id: number;
    readonly category: string;
    readonly txid: string;
    readonly previousTxid: string | null;
    readonly height: number;
    readonly timestamp: number;
}

/** A BCMR identity snapshot published for a fund. */
export interface RegistryIdentitySnapshot {
    readonly id: number;
    readonly category: string;
    readonly txid: string;
    readonly height: number;
    readonly timestamp: string;
    readonly sourceUri: string | null;
    readonly contentHash: string | null;
    readonly identity: Readonly<Record<string, unknown>>;
}

export interface RegistryFundDetail extends RegistryFund {
    readonly authchain: readonly RegistryAuthchainEntry[];
    readonly identityHistory: readonly RegistryIdentitySnapshot[];
}

export interface RegistryFundPage {
    readonly total: number;
    readonly limit: number;
    readonly offset: number;
    readonly funds: readonly RegistryFund[];
}

export interface RegistryDocumentVersion {
    readonly id: number;
    readonly version: string;
    readonly contentHash: string;
    readonly identities: number;
    readonly createdAt: string;
}

export interface RegistryHealth {
    /** True when the registry answered 200 and reports itself healthy. */
    readonly ready: boolean;
    /** HTTP status, or 0 when the registry could not be reached. */
    readonly httpStatus: number;
    /** 'ok', 'degraded', or 'unreachable'. */
    readonly status: string;
    readonly network?: string;
    readonly uptimeSeconds?: number;
    readonly electrum?: { readonly connected: boolean; readonly host: string | null };
    readonly sync?: {
        readonly running: boolean;
        readonly lastRunAt: string | null;
        readonly lastChainHeight: number;
        readonly consecutiveFailures: number;
        readonly lastError: string | null;
        readonly reorgsHandled: number;
    };
    readonly registry?: { readonly version: string | null; readonly funds: number; readonly pendingMetadata: number };
    /** Why the registry is not ready, when it could not be reached or answered unexpectedly. */
    readonly error?: string;
}
