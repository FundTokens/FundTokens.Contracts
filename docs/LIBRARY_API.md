# Library API

The fund-type independent API of `@fundtokens/builders`: entry points, the registry client,
fund type resolution and shared exports. Each fund type version documents its own builders,
e.g. [token basket v1](fund-types/token-basket/v1/BUILDERS.md). For a walkthrough, see the
[integration guide](INTEGRATION_GUIDE.md).

Source: [fund-tokens-contracts/src](../fund-tokens-contracts/src)

## Entry points

| Import | Contents |
| --- | --- |
| `@fundtokens/builders` | Everything: registry client, fund type namespaces (`TokenBasket`, `WeightedBchUsd`), shared errors and helpers |
| `@fundtokens/builders/registry` | `FundTokensRegistry` and registry types |
| `@fundtokens/builders/<fund-type>` | A fund type's descriptor, `resolve`, and every version (e.g. `token-basket`) |
| `@fundtokens/builders/<fund-type>/<version>` | One version's builders, encoding, fees, contract derivation (e.g. `token-basket/v1`) |
| `@fundtokens/builders/<fund-type>/<version>/artifacts/<name>.json` | That version's compiled contract artifacts |

From the root, fund types are namespaces: `TokenBasket.v1.FundTokenTransactionBuilder`.

**Versioning.** Use the version that matches the registry instance you operate on.
`FundTypeResolver` picks it for you:

```ts
import { FundTokensRegistry, FundTypeResolver, TokenBasket } from '@fundtokens/builders';

const registry = new FundTokensRegistry({ network: 'chipnet' });
const resolver = new FundTypeResolver({ provider });
const tb = resolver.resolve(await registry.getCurrentInstance(TokenBasket)); // a TokenBasket.v1 instance
const builder = tb.createFundTokenBuilder(fund);
```

The contract version id (`v1`) is independent of the npm package version.

---

## FundTokensRegistry

[src/registry/FundTokensRegistry.ts](../fund-tokens-contracts/src/registry/FundTokensRegistry.ts).
A read-only client for the FundTokens registry service.

```ts
new FundTokensRegistry({
    network?: string,        // default 'chipnet'; URL becomes https://<network>-registry.fundtokens.cash/
    url?: string,            // overrides network, e.g. 'http://localhost:3002'
    fetch?: typeof fetch,    // default: global fetch
    timeoutMs?: number,      // per request, default 10 000
    cacheTtlMs?: number,     // instance listing cache, default 60 000; 0 disables
})
```

| Method | Returns | Notes |
| --- | --- | --- |
| `getHealth()` | `RegistryHealth` | `{ ready, httpStatus, status, network, sync, registry, … }`. Never throws; an unreachable registry gives `ready: false` and `error` |
| `isLive()` | `boolean` | Liveness only |
| `getInstances({ type? })` | `RegistryInstance[]` | `type`: a registry type (`'fixed-basket'`), a library key (`'token-basket'`) or a descriptor (`TokenBasket`) |
| `getCurrentInstanceIds()` | `Record<type, id \| null>` | |
| `getInstance(id)` | `RegistryInstance \| undefined` | |
| `getCurrentInstance(type)` | `RegistryInstance` | Throws `REGISTRY_NOT_FOUND` when the type has no current instance |
| `getFunds({ limit?, offset?, includeBurned? })` | `RegistryFundPage` | `limit` is clamped to 1..500 |
| `iterateFunds({ pageSize?, includeBurned? })` | `AsyncGenerator<RegistryFund>` | Pages through every fund |
| `getFund(category)` | `RegistryFundDetail \| undefined` | Includes `authchain` and `identityHistory` |
| `getDocumentVersions()` | `RegistryDocumentVersion[]` | |
| `getMetadataRegistry()` | BCMR document | `/.well-known/bitcoin-cash-metadata-registry.json` |
| `clearCache()` | | Forces the next instance lookup to refetch |

Instance listings are cached and concurrent requests share one fetch. Results are copies.
Fund amounts are decimal strings; `FundTypeResolver.resolveFund` parses them with the
instance's version.

**`RegistryInstance`**: `{ id, name, network, type, status, version, txid, parameters, syncedHeight, createdAt, updatedAt }`.
`status` is `'pre' | 'main' | 'dep' | 'vul'` (pre-release, main, deprecated, vulnerable).
`version` is the contract version id. `parameters` is raw JSON, parsed by the matching version.

---

## Fund types

[src/fund-types](../fund-tokens-contracts/src/fund-types)

| Export | Description |
| --- | --- |
| `TokenBasket` | `key: 'token-basket'`, `registryType: 'fixed-basket'`, `versions: { v1 }`, `latest: 'v1'`, `resolve(instance)` |
| `WeightedBchUsd` | `key` and `registryType: 'weighted-bch-usd'`, `versions: { v1 }` (planned) |
| `fundTypes` | Every fund type descriptor |
| `getFundType(keyOrRegistryType)` | Descriptor lookup, or `undefined` |
| `resolveVersion` | The version of a descriptor matching an instance (what `resolve` uses) |

A descriptor's `resolve(instance)` returns the version whose `id` equals `instance.version`.
It throws `UNSUPPORTED_FUND_TYPE` if the type differs, nothing matches, or the match is only
`planned`. Each version module exports `id`, `status` (`'supported'` or `'planned'`) and
`createInstance({ provider, parameters })`.

## FundTypeResolver

[src/fund-types/FundTypeResolver.ts](../fund-tokens-contracts/src/fund-types/FundTypeResolver.ts).
Turns registry data into the fund type version that operates it, bound to a provider.
Registry results feed in as-is, as does any object with the same fields
(`{ type, version, parameters, id? }` for instances, `{ fund, instanceId? }` for funds).

```ts
new FundTypeResolver({ provider })
```

| Member | Returns | Notes |
| --- | --- | --- |
| `FundTypeResolver.supports(instance)` (static) | `boolean` | False for unknown types and unsupported or planned versions. Usable as a filter callback |
| `resolve(instance)` | `ResolvedInstance` | Throws `UNSUPPORTED_FUND_TYPE`, or `INVALID_ARGUMENT` for malformed parameters |
| `resolveFund(record, instance)` | `ResolvedFund` | `{ fund, contracts, createBuilder(options?), instance }`. Throws `INVALID_ARGUMENT` if `record.instanceId` names another instance, or the fund is invalid |

`ResolvedInstance` is the union of every supported version's instance class. Narrow on
`key` and `version` once more than one exists. Every instance class has `key`,
`registryType`, `version`, `provider`, `system` (parsed parameters) and `contracts`, plus
its version's builders; see the version's builder docs (e.g.
[TokenBasketInstance](fund-types/token-basket/v1/BUILDERS.md#tokenbasketinstance)).

---

## Shared exports

[src/core](../fund-tokens-contracts/src/core)

| Export | Description |
| --- | --- |
| `FundTokensError` | Every library error; has `code` |
| `RegistryError` | Registry errors; adds `url` and `status` |
| `isFundTokensError(error, code?)` | Type guard |
| `BitcoinCategory` | 64 zeros; stands for BCH wherever a category is expected |
| `MaxTokenAmount` | 2⁶³−1 |
| `MaxSatoshis` | 21M BCH in satoshis |
| `withDust({ to, token? })` | An output carrying exactly the dust minimum for its size |
| `dustThreshold({ to, token? })` | That minimum |
| `silentLogger`, `Logger` | Builders log through `logger` (silent by default; pass `console` to trace) |
| `toBigInt`, `isCategory`, `isHex`, `lockingBytecodeOf`, `lockingBytecodeHexOf`, `hashBytecode`, `getAddressPrefix` | Helpers |

### Error codes

| Code | Typical cause | What to do |
| --- | --- | --- |
| `INVALID_ARGUMENT` | Malformed category or amount, invalid fund, units out of range | Fix the named field |
| `INVALID_ENCODING` | Corrupt fund or fee commitment | Check the source data |
| `INVALID_TRANSACTION_STATE` | Unequal inputs/outputs; missing genesis input; wrong output 0 | Add inputs/outputs in matching numbers; genesis input first |
| `MISSING_UTXO` | Fund not created yet; no thread; no fee thread for `payBy` | Create the fund; wait for threads; pay in BCH |
| `INSUFFICIENT_FUNDS` | Unminted supply or custody can't cover the units | Use fewer units |
| `TRANSACTION_TOO_LARGE` | A redemption releases so many custody UTXOs it can't fit in a standard transaction | Redeem at most the units the message names, over several transactions |
| `UNSUPPORTED_FUND_TYPE` | Registry instance version unknown to this library | Upgrade the library, or pick a version explicitly |
| `NOT_IMPLEMENTED` | Planned fund type | |
| `REGISTRY_REQUEST_FAILED`, `REGISTRY_NOT_FOUND`, `REGISTRY_INVALID_RESPONSE` | Registry unreachable or erroring; unknown record; unexpected payload | Check `getHealth()` and the registry URL |
