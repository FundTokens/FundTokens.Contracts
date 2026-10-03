# Transaction Builder API Reference

API reference for `@fundtokens/builders`, the TypeScript library for building FundTokens
transactions and reading the FundTokens registry. For a guided walkthrough, see the
[Integration Guide](04-INTEGRATION_GUIDE.md).

## Overview

| Import | Contents |
| --- | --- |
| `@fundtokens/builders` | Everything: registry client, fund type namespaces (`TokenBasket`, `WeightedBchUsd`), shared errors and helpers |
| `@fundtokens/builders/registry` | `FundTokensRegistry` and registry types |
| `@fundtokens/builders/token-basket` | Token basket descriptor, `resolve`, and every version |
| `@fundtokens/builders/token-basket/v1` | Token basket v1: builders, encoding, fees, contract derivation, artifacts |
| `@fundtokens/builders/token-basket/v1/artifacts/<name>.json` | Compiled v1 contract artifacts |
| `@fundtokens/builders/weighted-bch-usd[/v1]` | Planned fund type (stub) |

**Versioning.** Each fund type has frozen contract versions (`v1`, later `v2`, …). A
version bundles its own contracts, builders and encoding, and never changes once
released. Use the version that matches the registry instance you are operating on:

```ts
import { FundTokensRegistry, FundTypeResolver, TokenBasket } from '@fundtokens/builders';

const registry = new FundTokensRegistry({ network: 'chipnet' });
const resolver = new FundTypeResolver({ provider });
const tb = resolver.resolve(await registry.getCurrentInstance(TokenBasket)); // a TokenBasket.v1 instance
const builder = tb.createFundTokenBuilder(fund);
```

Source: [fund-tokens-contracts/src](../fund-tokens-contracts/src)

---

## FundTokensRegistry

**Location**: [src/registry/FundTokensRegistry.ts](../fund-tokens-contracts/src/registry/FundTokensRegistry.ts)

A read-only client for the FundTokens registry service.

### Constructor

```ts
new FundTokensRegistry({
    network?: string,        // default 'chipnet'; URL becomes https://<network>-registry.fundtokens.cash/
    url?: string,            // overrides network, e.g. 'http://localhost:3002'
    fetch?: typeof fetch,    // default: global fetch
    timeoutMs?: number,      // per request, default 10 000
    cacheTtlMs?: number,     // instance listing cache, default 60 000; 0 disables
})
```

### Methods

| Method | Returns | Notes |
| --- | --- | --- |
| `getHealth()` | `RegistryHealth` | `{ ready, httpStatus, status, network, sync, registry, … }`. Never throws; an unreachable registry gives `ready: false` and `error` |
| `isLive()` | `boolean` | Liveness only |
| `getInstances({ type? })` | `RegistryInstance[]` | `type` may be a registry type (`'fixed-basket'`), a library key (`'token-basket'`) or a descriptor (`TokenBasket`) |
| `getCurrentInstanceIds()` | `Record<type, id \| null>` | |
| `getInstance(id)` | `RegistryInstance \| undefined` | |
| `getCurrentInstance(type)` | `RegistryInstance` | Throws `REGISTRY_NOT_FOUND` when the type has no current instance |
| `getFunds({ limit?, offset?, includeBurned? })` | `RegistryFundPage` | `limit` is clamped to 1..500 |
| `iterateFunds({ pageSize?, includeBurned? })` | `AsyncGenerator<RegistryFund>` | Pages through every fund |
| `getFund(category)` | `RegistryFundDetail \| undefined` | Includes `authchain` and `identityHistory` |
| `getDocumentVersions()` | `RegistryDocumentVersion[]` | |
| `getMetadataRegistry()` | BCMR document | `/.well-known/bitcoin-cash-metadata-registry.json` |
| `clearCache()` | | Forces the next instance lookup to refetch |

Instance listings are cached and concurrent requests share one fetch. Every result is
a copy. Registry fund amounts are decimal strings: [`FundTypeResolver.resolveFund`](#fundtyperesolver)
parses them with the instance's version.

**`RegistryInstance`**: `{ id, name, network, type, status, version, txid, parameters, syncedHeight, createdAt, updatedAt }`.
`status` is `'pre' | 'main' | 'dep' | 'vul'` (pre-release, main, deprecated, vulnerable).
`parameters` is raw JSON; `FundTypeResolver.resolve(instance)` parses it with the matching version.

---

## Fund types

**Location**: [src/fund-types](../fund-tokens-contracts/src/fund-types)

| Export | Description |
| --- | --- |
| `TokenBasket` | `key: 'token-basket'`, `registryType: 'fixed-basket'`, `versions: { v1 }`, `latest: 'v1'`, `resolve(instance)` |
| `WeightedBchUsd` | `key` and `registryType: 'weighted-bch-usd'`, `versions: { v1 }` (planned) |
| `fundTypes` | Every known fund type descriptor |
| `getFundType(keyOrRegistryType)` | Descriptor lookup, or `undefined` |

**`resolve(instance)`** returns the version whose `id` equals `instance.version`. It throws
`UNSUPPORTED_FUND_TYPE` if the type differs, nothing matches, or the match is only
`planned`. The contract version id is independent of the npm package version.

| Version | `id` | Status |
| --- | --- | --- |
| `TokenBasket.v1` | `v1` | supported |
| `WeightedBchUsd.v1` | `v1` | planned; builders throw `NOT_IMPLEMENTED` |

---

## FundTypeResolver

**Location**: [src/fund-types/FundTypeResolver.ts](../fund-tokens-contracts/src/fund-types/FundTypeResolver.ts)

Turns registry data into the fund type version that operates it, bound to a network
provider. `FundTokensRegistry` results feed in as-is; so does any object with the
same fields (`{ type, version, parameters, id? }` for instances, `{ fund, instanceId? }` for funds).

```ts
new FundTypeResolver({ provider })
```

| Member | Returns | Notes |
| --- | --- | --- |
| `FundTypeResolver.supports(instance)` (static) | `boolean` | False for unknown types and unsupported or planned versions. Usable as a filter callback |
| `resolve(instance)` | `ResolvedInstance` | Throws `UNSUPPORTED_FUND_TYPE`, or `INVALID_ARGUMENT` for malformed parameters |
| `resolveFund(record, instance)` | `ResolvedFund` | `{ fund, contracts, createBuilder(options?), instance }`. Throws `INVALID_ARGUMENT` if `record.instanceId` names another instance, or the fund is invalid |

`ResolvedInstance` is the union of every supported version's instance class. Today that
is `TokenBasket.v1.TokenBasketInstance`:

| Member | Description |
| --- | --- |
| `key`, `registryType`, `version` | `'token-basket'`, `'fixed-basket'`, `'v1'`: narrow on these when more types exist |
| `provider`, `system`, `contracts` | The bound provider, parsed `SystemParameters`, and `SystemContracts` |
| `PublicFundTransactionBuilder`, `FundTokenTransactionBuilder` | This version's builder classes |
| `createPublicFundBuilder(options?)` | A `PublicFundTransactionBuilder` bound to the provider and parameters |
| `createFundTokenBuilder(fund, options?)` | A `FundTokenTransactionBuilder` for `fund` |
| `getFundContracts(fund)` | `FundContracts` for `fund` |
| `parseFund(input)`, `decodeFundCommitment(hex)` | This version's fund parsing and on-chain decoding |
| `forFund(input)` | `{ fund, contracts, createBuilder(options?) }` |

Each supported version module also exports `createInstance({ provider, parameters })`,
which is what the resolver calls. Planned versions throw `NOT_IMPLEMENTED` from it.

---

## Token basket v1

**Location**: [src/fund-types/token-basket/v1](../fund-tokens-contracts/src/fund-types/token-basket/v1)

### System parameters

```ts
interface SystemParameters {
    inflow: string;          // 32-byte hex categories
    outflow: string;
    publicFund: string;
    authorization: string;
    fees: {
        create:  { nft: string; value: bigint };  // value: default fee in satoshis
        execute: { nft: string; value: bigint };
    };
}
```

`parseSystemParameters(input)` validates and normalises registry JSON or an object you
built: categories are lowercased, and fee values (number, bigint or decimal string)
become bigint. It throws `INVALID_ARGUMENT` naming the bad field. The builders call it
for you, so registry parameters can be passed straight in.

### Funds

```ts
interface Fund {
    category: string;        // fund token category = genesis txid
    amount: bigint;          // fund tokens per whole fund unit
    satoshis: bigint;        // BCH backing per unit (0 = none)
    assets: { category: string; amount: bigint }[]; // per unit; kept in ascending category order
}
```

A **unit** is `amount` fund tokens, backed by `satoshis` BCH and each asset's `amount`.
Minting and redeeming happen in whole units.

| Function | Purpose |
| --- | --- |
| `parseFund(input)` | `normalizeFund` then `validateFund`: the usual way to accept a fund |
| `normalizeFund(input)` | Shape only: bigint amounts (bigint, safe integer or decimal string), lowercase categories, assets sorted; `satoshis` defaults to 0, `assets` to `[]` |
| `validateFund(fund)` | Value rules, listed below; throws `INVALID_ARGUMENT` |

Validation rules, matching what the contracts enforce plus checks for unusable funds:

- `amount` from 1 to 2⁶³−1
- `satoshis` from 0 to 2,100,000,000,000,000 (21M BCH)
- at least one of `satoshis > 0` or one asset
- each asset `amount` from 1 to 2⁶³−1
- no duplicate assets, no asset with the Bitcoin (all-zero) category, and no asset that is the fund's own token

### PublicFundTransactionBuilder

Creates ("broadcasts") funds. Extends CashScript's `TransactionBuilder`.

```ts
new PublicFundTransactionBuilder({
    provider,               // CashScript NetworkProvider
    system,                 // SystemParameters (or registry JSON)
    logger?,                // { debug, info, warn, error }; silent by default
    ...transactionBuilderOptions, // e.g. maximumFeeSatoshis, allowImplicitFungibleTokenBurn
})
```

| Member | Description |
| --- | --- |
| `system` | The parsed system parameters |
| `contracts` / `getContracts()` | `SystemContracts`: `feeVaultContract`, `createFundFeeContract`, `executeFundFeeContract`, `startupContract`, `mintInflowContract`, `mintOutflowContract`, `publicFundContract`, `authHeadVaultContract`, `publicFundVaultContract` |
| `getFundContracts(fund)` | The `FundContracts` of a fund on this instance (no network access) |
| `getAuthHeadOutput()` | The fund's identity output; must be output 0 |
| `addBroadcast({ fund, payBy?, validate?, padding?, startupPadding? })` | Adds the contract side of creating `fund`; resolves to the builder. `padding` and `startupPadding` (bytes, default 0) buy PublicFund and FundStartup more compute; see [Performance considerations](#performance-considerations) |

**`addBroadcast` preconditions**

- Input 0 is the genesis input: output index 0 of its transaction, with no tokens. Its txid is the fund's category (checked).
- If outputs were added first, output 0 is `getAuthHeadOutput()`. Otherwise it is added for you.
- Input and output counts are equal, counting the authhead output.

Nothing is added unless every check and UTXO lookup succeeds.

**Adds**

- Inputs: startup, inflow minting, outflow minting, create-fee, public fund
- Outputs: those UTXOs returned to their contracts, the fee payment, the fund's inflow and
  outflow thread NFTs (to its manager), the fund's full token supply (2⁶³−1, to its fund
  contract), then the fund commitment split into 128-byte NFT chunks at the public fund vault

The caller adds BCH (or `payBy` tokens) for the create fee, and change.

### FundTokenTransactionBuilder

Mints (inflow) and redeems (outflow) a fund's tokens. Extends `TransactionBuilder`.

```ts
new FundTokenTransactionBuilder({
    provider, system, fund,
    logger?,
    validate?,               // default true
    ...transactionBuilderOptions,
})
```

| Member | Description |
| --- | --- |
| `system`, `fund` | Parsed parameters and fund (frozen) |
| `contracts` / `getContracts()` | `FundContracts`: `managerContract` (TransactionManager), `fundContract` (FundManager), `assetContracts` (AssetManager per asset, ascending), `satoshiAssetContract` (only when `satoshis > 0`), `feeContract` (execute fee), `feeVaultContract` |
| `addInflow({ units, payBy? })` | Adds the contract side of minting `units` whole units |
| `addOutflow({ units, payBy?, padding? })` | Adds the contract side of redeeming `units` whole units |

`addOutflow`'s `padding` (bytes, default 0) buys the TransactionManager more compute; see
[Performance considerations](#performance-considerations). Minting never needs it.

Both need equal input and output counts when called. Add your own inputs and outputs
before or after, in matching numbers.

**`addInflow`** adds the fund's inflow thread and an execute-fee UTXO, plus enough
fund-supply UTXOs to cover `units × fund.amount`, chosen randomly to avoid collisions.
It also adds outputs locking `units × satoshis` BCH and `units × asset.amount` of each
asset into custody. The caller adds inputs supplying those assets and the fee's BCH,
an output receiving `units × fund.amount` fund tokens, and change.

**`addOutflow`** adds the fund's outflow thread, an execute-fee UTXO, and a fund
UTXO that collects the redeemed tokens. It releases custody UTXOs, largest first, to
cover `units × satoshis` BCH and `units × asset.amount` of each asset, and returns
change to custody. BCH change is never left below dust. The caller adds inputs
supplying `units × fund.amount` fund tokens and the fee's BCH, outputs receiving the
released BCH and assets, and change.

**Errors**: `INVALID_TRANSACTION_STATE` (misaligned inputs/outputs), `INVALID_ARGUMENT`
(bad `units`, amounts overflowing 2⁶³−1, or BCH locked below dust, with the minimum
units named), `MISSING_UTXO` (no thread: the fund isn't created; no fee thread for
`payBy`), `INSUFFICIENT_FUNDS` (supply or custody can't cover the request).

### Encoding

| Function | Description |
| --- | --- |
| `getFundHex(fund)` / `getFundBin(fund)` | Fund encoding: `category(32, reversed) · amount(8 LE) · satoshis(7 LE) · [asset category(32, reversed) · amount(8 LE)]…`, i.e. 47 bytes + 40 per asset. Assets are sorted first |
| `hashFund(fund)` | hash256 of the encoding, as hex |
| `getFundCommitment(fund)` | `02 · hash256(fund) · fund`, the published commitment |
| `decodeFund(hex)` / `decodeFundCommitment(hex)` | Inverses; the latter verifies the hash. Throw `INVALID_ENCODING` |
| `categoryAscending`, `sortAssets` | Contract asset ordering |

Encoding does not validate: out-of-range amounts are clamped. Validate first (the builders do).

### Fees

| Function | Description |
| --- | --- |
| `encodeFee({ category?, amount, destination? })` | Enforced-fee NFT commitment: `01 · category(32, reversed) · amount(8 LE) · [destination locking bytecode]`. `category` defaults to BCH |
| `decodeFee({ hex, network? \| prefix? })` | Inverse; `network` picks the destination address prefix |
| `getBestFee({ feeContract, feeVaultContract, fee, payBy? })` | The cheapest fee UTXO payable in `payBy` (default BCH). Ties are broken randomly. Returns the option plus its two outputs (fee UTXO returned, payment) |
| `getAvailableFees({ feeContract, fee })` | Cheapest amount per payment category |

Plain fee UTXOs (no NFT) cost the default `fee.value` in BCH. Voluntary (`0x02`) and
malformed fee NFTs are skipped.

### Contracts and artifacts

| Export | Description |
| --- | --- |
| `deriveSystemContracts(provider, system)` | `SystemContracts`, derived without network access |
| `deriveFundContracts(provider, system, fund)` | `FundContracts` |
| `artifacts` | Typed (`as const`) artifacts keyed by contract name: `transactionManager`, `fundManager`, `assetManager`, `feeManager`, `fundStartup`, `fundInflowMint`, `fundOutflowMint`, `publicFund`, `publicFundVault`, `authHeadVault`, `simpleVault`, `simpleMinter`, `feeMinter`, `instanceVault` |

The contracts are typed by artifact (for example `TransactionManagerContract`), so
constructor arguments and `unlock.*()` calls are type-checked.

---

## Shared exports

**Location**: [src/core](../fund-tokens-contracts/src/core)

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
| `toBigInt`, `isCategory`, `isHex`, `lockingBytecodeOf`, `hashBytecode`, `getAddressPrefix` | Helpers |

### Error codes

| Code | Typical cause | What to do |
| --- | --- | --- |
| `INVALID_ARGUMENT` | Malformed category or amount, invalid fund, units out of range | Fix the named field |
| `INVALID_ENCODING` | Corrupt fund/fee commitment | Check the source data |
| `INVALID_TRANSACTION_STATE` | Unequal inputs/outputs; missing genesis input; wrong output 0 | Add inputs/outputs in matching numbers; genesis input first |
| `MISSING_UTXO` | Fund not created yet; no thread; no fee thread for `payBy` | Create the fund; wait for threads; pay in BCH |
| `INSUFFICIENT_FUNDS` | Unminted supply or custody can't cover the units | Use fewer units |
| `UNSUPPORTED_FUND_TYPE` | Registry instance version unknown to this library | Upgrade the library, or pick a version explicitly |
| `NOT_IMPLEMENTED` | Planned fund type | |
| `REGISTRY_REQUEST_FAILED`, `REGISTRY_NOT_FOUND`, `REGISTRY_INVALID_RESPONSE` | Registry unreachable/erroring; unknown record; unexpected payload | Check `getHealth()` and the registry URL |

---

## Performance considerations

1. **Thread randomization**: builders pick random inflow/outflow threads, supply UTXOs and equally cheap fee UTXOs to spread concurrent users.
2. **Custody selection**: redemption spends custody UTXOs largest first, so a redemption needs few inputs.
3. **Transaction size** grows with the number of assets (inputs and outputs per asset, plus 40 bytes of fund encoding per asset).
4. **Compute budget**: each input may spend (41 + its unlocking bytecode length) × 800 operation cost. Inputs whose work grows with the fund faster than their unlocking bytecode run out first:

| Contract function | Largest fund without padding | Why |
| --- | --- | --- |
| PublicFund `broadcast()` | 78 assets | Its budget is fixed (about 563,000); each asset costs about 6,000 |
| TransactionManager `outflow()` | 108 assets | Each asset costs about 48,000; the fund it is passed adds 32,000 of budget per asset |
| TransactionManager `inflow()` | Never runs out | 73.5% of its budget at 189 assets, the largest fund that can be created; it takes no padding |
| FundStartup `start()` | 144 assets | Each asset costs about 60,000; the fund it is passed adds 32,000 of budget per asset |

Pass `padding` (bytes) to `addBroadcast` or `addOutflow`, or `startupPadding` to `addBroadcast`, to buy more: each byte adds 800 to that input's budget, for about 1 satoshi of fee at 1 sat/byte. For example, an 80-asset broadcast with `padding: 100` uses 569,220 of its 644,000 budget. Redeeming from a 144-asset fund takes about 1,000 bytes of `outflow` padding. A standard unlocking bytecode is at most 10,000 bytes, which the fund encoding, padding and the contract's own bytecode share in FundStartup and the TransactionManager. That caps fund creation at 189 assets: FundStartup then needs every byte of padding that fits.

**Measured sizes** (from the test suite):

| Transaction | BCH + 3 assets | BCH + 38 assets |
| --- | --- | --- |
| Create fund | 6,202 bytes | 9,838 bytes |
| Mint (inflow) | 3,731 bytes | 15,281 bytes |
| Redeem (outflow) | 4,613 bytes | 21,413 bytes |

---

## See Also

- [01-SYSTEM_ARCHITECTURE.md](01-SYSTEM_ARCHITECTURE.md): system design overview
- [02-CONTRACT_SPECIFICATIONS.md](02-CONTRACT_SPECIFICATIONS.md): contract details
- [04-INTEGRATION_GUIDE.md](04-INTEGRATION_GUIDE.md): integration examples
- [05-FLOW_DIAGRAMS.md](05-FLOW_DIAGRAMS.md): visual flow diagrams
- [06-SYSTEM_TOKENS.md](06-SYSTEM_TOKENS.md): system token specification
- [09-FEE_TOKENS.md](09-FEE_TOKENS.md): fee token specification
- [11-AUTHORIZATION_TOKEN.md](11-AUTHORIZATION_TOKEN.md): authorization token specification
- [Library README](../fund-tokens-contracts/README.md): installation, migration from 0.1.x, publishing
