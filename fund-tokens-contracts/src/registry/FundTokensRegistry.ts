import { FundTokensError, RegistryError } from '../core/errors.js';
import { assertCategory } from '../core/validation.js';
import { getFundType } from '../fund-types/index.js';
import type {
    RegistryDocumentVersion,
    RegistryFund,
    RegistryFundDetail,
    RegistryFundPage,
    RegistryHealth,
    RegistryInstance,
} from './types.js';

export interface FundTokensRegistryOptions {
    /** Network whose public registry to use when `url` is not given (default 'chipnet'). */
    network?: string | undefined;
    /** Registry base URL, e.g. 'http://localhost:3002/'. Overrides the `network` default. */
    url?: string | undefined;
    /** fetch implementation; defaults to the global `fetch`. */
    fetch?: typeof globalThis.fetch | undefined;
    /** Per-request timeout in milliseconds (default 10 000). */
    timeoutMs?: number | undefined;
    /** How long instance listings are cached, in milliseconds (default 60 000; 0 disables). */
    cacheTtlMs?: number | undefined;
}

/** A fund type given by registry type ('fixed-basket'), library key ('token-basket'), or descriptor (`TokenBasket`). */
export type FundTypeReference = string | { readonly registryType: string };

interface InstancesPayload {
    readonly current: Readonly<Record<string, number | null>>;
    readonly instances: readonly RegistryInstance[];
}

const DefaultTimeoutMs = 10_000;
const DefaultCacheTtlMs = 60_000;
const MaxPageSize = 500;
const MetadataRegistryPath = '.well-known/bitcoin-cash-metadata-registry.json';

const clone = <T>(value: T): T => structuredClone(value);

function toRegistryType(type: FundTypeReference): string {
    if (typeof type !== 'string') {
        return type.registryType;
    }
    return getFundType(type)?.registryType ?? type;
}

/**
 * Read-only client for the FundTokens registry: the instances (deployed system
 * contracts) it trusts, the funds it has discovered on-chain, and their BCMR metadata.
 *
 * @example
 * const registry = new FundTokensRegistry({ network: 'chipnet' });
 * const instance = await registry.getCurrentInstance(TokenBasket);
 * const v = TokenBasket.resolve(instance);
 * const system = v.parseSystemParameters(instance.parameters);
 */
export class FundTokensRegistry {
    readonly url: string;
    readonly network: string;
    readonly #fetch: typeof globalThis.fetch;
    readonly #timeoutMs: number;
    readonly #cacheTtlMs: number;
    #instances: { expiresAt: number; payload: Promise<InstancesPayload> } | undefined;

    constructor(options: FundTokensRegistryOptions = {}) {
        this.network = options.network ?? 'chipnet';
        if (!/^[a-z0-9-]+$/.test(this.network)) {
            throw new FundTokensError('INVALID_ARGUMENT', `network must be a plain name such as 'chipnet', got '${this.network}'`);
        }
        const url = options.url ?? `https://${this.network}-registry.fundtokens.cash/`;
        try {
            this.url = new URL(url.endsWith('/') ? url : `${url}/`).toString();
        } catch (cause) {
            throw new FundTokensError('INVALID_ARGUMENT', `url must be an absolute URL, got '${url}'`, { cause });
        }
        // Resolved per call so fetch can be replaced (e.g. mocked) after construction.
        this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
        this.#timeoutMs = options.timeoutMs ?? DefaultTimeoutMs;
        this.#cacheTtlMs = options.cacheTtlMs ?? DefaultCacheTtlMs;
    }

    /** Drops cached instance data so the next call refetches it. */
    clearCache(): void {
        this.#instances = undefined;
    }

    /** Reports the registry's health. Never throws: an unreachable registry reports `ready: false`. */
    async getHealth(): Promise<RegistryHealth> {
        try {
            const { status, body } = await this.#get('api/health', [200, 503]);
            const health = body !== null && typeof body === 'object' ? body as Record<string, unknown> : {};
            return {
                ...health,
                ready: status === 200 && health.status === 'ok',
                httpStatus: status,
                status: typeof health.status === 'string' ? health.status : 'unknown',
            } as RegistryHealth;
        } catch (error) {
            return {
                ready: false,
                httpStatus: error instanceof RegistryError ? error.status ?? 0 : 0,
                status: 'unreachable',
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /** True when the registry process is up (liveness only; see `getHealth` for readiness). */
    async isLive(): Promise<boolean> {
        try {
            await this.#get('api/health/live');
            return true;
        } catch {
            return false;
        }
    }

    /** All instances on this registry's network, optionally only those of one fund type. */
    async getInstances(filter: { type?: FundTypeReference | undefined } = {}): Promise<RegistryInstance[]> {
        const { instances } = await this.#loadInstances();
        const type = filter.type === undefined ? undefined : toRegistryType(filter.type);
        return clone(instances.filter(instance => type === undefined || instance.type === type));
    }

    /** The current instance id per registry fund type; `null` where a type has none. */
    async getCurrentInstanceIds(): Promise<Record<string, number | null>> {
        return clone({ ...(await this.#loadInstances()).current });
    }

    async getInstance(id: number): Promise<RegistryInstance | undefined> {
        const { instances } = await this.#loadInstances();
        const instance = instances.find(candidate => candidate.id === id);
        return instance && clone(instance);
    }

    /**
     * The instance new activity for a fund type should use. Throws
     * `REGISTRY_NOT_FOUND` when the registry has no current instance for it.
     */
    async getCurrentInstance(type: FundTypeReference): Promise<RegistryInstance> {
        const registryType = toRegistryType(type);
        const { current, instances } = await this.#loadInstances();
        const id = current[registryType];
        const instance = id === null || id === undefined ? undefined : instances.find(candidate => candidate.id === id);
        if (!instance) {
            throw new RegistryError('REGISTRY_NOT_FOUND', `The registry has no current '${registryType}' instance`, {
                url: this.#resolve('api/instances'),
            });
        }
        return clone(instance);
    }

    /** One page of discovered funds, newest first as the registry orders them. */
    async getFunds(options: { limit?: number; offset?: number; includeBurned?: boolean } = {}): Promise<RegistryFundPage> {
        const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), MaxPageSize);
        const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
        const query = new URLSearchParams({ limit: String(limit), offset: String(offset), includeBurned: String(options.includeBurned ?? false) });
        return this.#read(`api/funds?${query}`, body => {
            const page = expectObject(body, 'fund page');
            return {
                total: expectNumber(page.total, 'fund page total'),
                limit: expectNumber(page.limit, 'fund page limit'),
                offset: expectNumber(page.offset, 'fund page offset'),
                funds: expectArray(page.funds, 'fund page funds').map(expectFund),
            };
        });
    }

    /** Every discovered fund, fetched a page at a time. */
    async *iterateFunds(options: { pageSize?: number; includeBurned?: boolean } = {}): AsyncGenerator<RegistryFund> {
        const limit = options.pageSize ?? 100;
        let offset = 0;
        for (;;) {
            const page = await this.getFunds({ limit, offset, includeBurned: options.includeBurned ?? false });
            yield* page.funds;
            offset += page.funds.length;
            if (page.funds.length === 0 || offset >= page.total) return;
        }
    }

    /** A fund with its authchain and identity history, or undefined if the registry doesn't know it. */
    async getFund(category: string): Promise<RegistryFundDetail | undefined> {
        const normalized = assertCategory(category, 'category');
        try {
            return await this.#read(`api/funds/${normalized}`, body => {
                const fund = expectFund(body) as RegistryFundDetail;
                expectArray(fund.authchain, 'fund authchain');
                expectArray(fund.identityHistory, 'fund identity history');
                return fund;
            });
        } catch (error) {
            if (error instanceof RegistryError && error.code === 'REGISTRY_NOT_FOUND') {
                return undefined;
            }
            throw error;
        }
    }

    /** Published versions of the registry's BCMR document, newest first. */
    async getDocumentVersions(): Promise<RegistryDocumentVersion[]> {
        return this.#read('api/registry/versions', body =>
            expectArray(expectObject(body, 'document versions').versions, 'document versions') as RegistryDocumentVersion[]);
    }

    /** The registry's current BCMR document (Bitcoin Cash Metadata Registry JSON). */
    async getMetadataRegistry(): Promise<Record<string, unknown>> {
        return this.#read(MetadataRegistryPath, body => expectObject(body, 'metadata registry'));
    }

    #loadInstances(): Promise<InstancesPayload> {
        const now = Date.now();
        if (this.#instances && this.#instances.expiresAt > now) {
            return this.#instances.payload;
        }

        const payload = this.#read('api/instances', body => {
            const data = expectObject(body, 'instances');
            const current = expectObject(data.current, 'current instances') as Record<string, number | null>;
            const instances = expectArray(data.instances, 'instances').map(expectInstance);
            return { current, instances };
        });
        // Concurrent callers share one request; a failure is not cached.
        const entry = { expiresAt: now + this.#cacheTtlMs, payload };
        this.#instances = this.#cacheTtlMs > 0 ? entry : undefined;
        payload.catch(() => {
            if (this.#instances === entry) this.#instances = undefined;
        });
        return payload;
    }

    /** GETs `path` and shapes the body with `parse`, reporting shape errors against the request URL. */
    async #read<T>(path: string, parse: (body: unknown) => T): Promise<T> {
        const { body } = await this.#get(path);
        try {
            return parse(body);
        } catch (error) {
            if (error instanceof ShapeError) {
                const url = this.#resolve(path);
                throw new RegistryError('REGISTRY_INVALID_RESPONSE', `Unexpected response from ${url}: ${error.message}`, { url });
            }
            throw error;
        }
    }

    #resolve(path: string): string {
        return new URL(path, this.url).toString();
    }

    async #get(path: string, acceptedStatuses: readonly number[] = [200]): Promise<{ status: number; body: unknown }> {
        const url = this.#resolve(path);

        let response: Response;
        try {
            response = await this.#fetch(url, {
                headers: { accept: 'application/json' },
                signal: AbortSignal.timeout(this.#timeoutMs),
            });
        } catch (cause) {
            const timedOut = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
            const reason = timedOut ? `timed out after ${this.#timeoutMs}ms` : `failed: ${cause instanceof Error ? cause.message : String(cause)}`;
            throw new RegistryError('REGISTRY_REQUEST_FAILED', `Registry request to ${url} ${reason}`, { url, cause });
        }

        const text = await response.text();
        let body: unknown;
        let parsed = true;
        try {
            body = text ? JSON.parse(text) : undefined;
        } catch {
            parsed = false;
        }

        if (!acceptedStatuses.includes(response.status)) {
            const detail = parsed && body !== null && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
                ? `: ${(body as { message: string }).message}`
                : '';
            const code = response.status === 404 ? 'REGISTRY_NOT_FOUND' : 'REGISTRY_REQUEST_FAILED';
            throw new RegistryError(code, `Registry returned HTTP ${response.status} for ${url}${detail}`, { url, status: response.status });
        }
        if (!parsed) {
            throw new RegistryError('REGISTRY_INVALID_RESPONSE', `Registry returned a non-JSON response for ${url}`, { url, status: response.status });
        }
        return { status: response.status, body };
    }
}

/** A response did not have the expected shape; `#read` turns it into a RegistryError with the URL. */
class ShapeError extends Error {}
const invalidResponse = (message: string) => new ShapeError(message);

function expectObject(value: unknown, what: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw invalidResponse(`${what} is not an object`);
    }
    return value as Record<string, unknown>;
}

function expectArray(value: unknown, what: string): unknown[] {
    if (!Array.isArray(value)) {
        throw invalidResponse(`${what} is not an array`);
    }
    return value;
}

function expectNumber(value: unknown, what: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw invalidResponse(`${what} is not a number`);
    }
    return value;
}

function expectString(value: unknown, what: string): string {
    if (typeof value !== 'string') {
        throw invalidResponse(`${what} is not a string`);
    }
    return value;
}

function expectInstance(value: unknown): RegistryInstance {
    const instance = expectObject(value, 'instance');
    expectNumber(instance.id, 'instance id');
    expectString(instance.type, 'instance type');
    expectString(instance.version, 'instance version');
    expectString(instance.status, 'instance status');
    expectObject(instance.parameters, 'instance parameters');
    return instance as unknown as RegistryInstance;
}

function expectFund(value: unknown): RegistryFund {
    const fund = expectObject(value, 'fund');
    expectString(fund.category, 'fund category');
    expectNumber(fund.instanceId, 'fund instanceId');
    const definition = expectObject(fund.fund, 'fund definition');
    expectString(definition.amount, 'fund definition amount');
    expectArray(definition.assets, 'fund definition assets');
    return fund as unknown as RegistryFund;
}
