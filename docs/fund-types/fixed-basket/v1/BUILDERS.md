# Fixed Basket v1: Builder API

The v1 part of `@fundtokens/builders`: `FixedBasket.v1`, or
`@fundtokens/builders/fixed-basket/v1`. Shared API (registry, resolver, errors): see the
[Library API](../../../LIBRARY_API.md). Walkthrough: [integration guide](../../../INTEGRATION_GUIDE.md).

Source: [src/fund-types/fixed-basket/v1](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1)

## FixedBasketInstance

What `FundTypeResolver.resolve()` returns for a v1 instance (also `createInstance({ provider, parameters })`).

| Member | Description |
| --- | --- |
| `key`, `version` | `'fixed-basket'`, `'v1'` |
| `provider`, `system`, `contracts` | The bound provider, parsed `SystemParameters`, and `SystemContracts` |
| `PublicFundTransactionBuilder`, `FundTokenTransactionBuilder` | This version's builder classes |
| `createPublicFundBuilder(options?)` | A `PublicFundTransactionBuilder` bound to the provider and parameters |
| `createFundTokenBuilder(fund, options?)` | A `FundTokenTransactionBuilder` for `fund` |
| `getFundContracts(fund)` | `FundContracts` for `fund` |
| `parseFund(input)`, `decodeFundCommitment(hex)` | Fund parsing and on-chain decoding |
| `forFund(input)` | `{ fund, contracts, createBuilder(options?) }` |

## System parameters

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
built: categories are lowercased; fee values (number, bigint or decimal string) become
bigint. It throws `INVALID_ARGUMENT` naming the bad field. The builders call it for you.

## Funds

```ts
interface Fund {
    category: string;        // fund token category = genesis txid
    amount: bigint;          // fund tokens per unit
    satoshis: bigint;        // BCH backing per unit (0 = none)
    assets: { category: string; amount: bigint }[]; // per unit; ascending category order
}
```

| Function | Purpose |
| --- | --- |
| `parseFund(input)` | `normalizeFund` then `validateFund`: the usual way to accept a fund |
| `normalizeFund(input)` | Shape only: bigint amounts (bigint, safe integer or decimal string), lowercase categories, assets sorted; `satoshis` defaults to 0, `assets` to `[]` |
| `validateFund(fund)` | Value rules below; throws `INVALID_ARGUMENT` |
| `MaxFundAssets` | 100 |

Validation rules (the contracts' rules, plus checks for unusable funds):

- `amount` from 1 to 2⁶³−1; each asset `amount` from 1 to 2⁶³−1
- `satoshis` from 0 to 2,100,000,000,000,000 (21M BCH); at least one of `satoshis > 0` or one asset
- at most `MaxFundAssets` assets
- no duplicate assets, no asset with the BCH (all-zero) category, no asset that is the fund's own token

## PublicFundTransactionBuilder

Creates funds. Extends CashScript's `TransactionBuilder`.

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
| `addBroadcast({ fund, payBy?, validate?, padding?, startupPadding? })` | Adds the contract side of creating `fund`; resolves to the builder |

`addBroadcast` requires:

- input 0 is the genesis input: output index 0 of its transaction, holding no tokens. Its txid
  is the fund's category (checked)
- if outputs were added first, output 0 is `getAuthHeadOutput()`; otherwise it is added for you
- equal input and output counts, counting the identity output

It adds the FundStartup, both thread minting, create fee and PublicFund inputs; returns them;
pays the fee; mints the fund's threads, its whole supply and its published definition. The
caller adds BCH (or `payBy` tokens) for the create fee, and change. Nothing is added unless
every check and lookup succeeds. Exact layout:
[TRANSACTIONS.md](../../../agents/fixed-basket/v1/TRANSACTIONS.md#fund-creation).

`padding` and `startupPadding` (bytes, default 0) buy PublicFund and FundStartup more compute
for funds of more than 78 assets ([limits](../../../agents/fixed-basket/v1/LIMITS.md)).

## FundTokenTransactionBuilder

Mints and redeems a fund's tokens. Extends `TransactionBuilder`.

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
| `contracts` / `getContracts()` | `FundContracts`: `managerContract` (TransactionManager), `fundContract` (FundManager), `assetContracts` (one AssetManager per asset, ascending), `satoshiAssetContract` (when `satoshis > 0`), `feeContract` (execute fee), `feeVaultContract` |
| `addInflow({ units, payBy?, padding? })` | Adds the contract side of minting `units` units |
| `addOutflow({ units, payBy?, padding? })` | Adds the contract side of redeeming `units` units |

Both need equal input and output counts when called. `padding` (bytes, default 0) buys the
TransactionManager more compute.

**`addInflow`** adds the fund's inflow thread, an execute fee UTXO and enough FundManager
supply to cover `units × fund.amount` (picked randomly to spread concurrent users), plus
outputs locking `units × satoshis` BCH and `units × asset.amount` of each asset into
custody. The caller adds inputs with those assets and the fee's BCH, an output receiving
`units × fund.amount` fund tokens, and change.

**`addOutflow`** adds the fund's outflow thread, an execute fee UTXO and a FundManager UTXO
that collects the redeemed tokens, and releases custody UTXOs largest first to cover the
backing, returning change to custody (BCH change never below dust). The caller adds inputs
with `units × fund.amount` fund tokens and the fee's BCH, outputs receiving the released BCH
and assets, and change. With validation on, it refuses a redemption that cannot fit in a
standard transaction (`TRANSACTION_TOO_LARGE`) and names the most units that fit.

**Errors**: `INVALID_TRANSACTION_STATE` (misaligned inputs/outputs), `INVALID_ARGUMENT`
(bad `units`, amounts overflowing 2⁶³−1, BCH locked below dust with the minimum units
named, too many assets), `MISSING_UTXO` (no thread: the fund isn't created; no fee thread for
`payBy`), `INSUFFICIENT_FUNDS` (supply or custody can't cover the request),
`TRANSACTION_TOO_LARGE`.

## Encoding

| Function | Description |
| --- | --- |
| `getFundHex(fund)` / `getFundBin(fund)` | The fund encoding the contracts read (47 bytes + 40 per asset). Assets are sorted first |
| `hashFund(fund)` | hash256 of the encoding, hex |
| `getFundCommitment(fund)` | `02 · hash · encoding`, the published definition |
| `decodeFund(hex)` / `decodeFundCommitment(hex)` | Inverses; the latter verifies the hash. Throw `INVALID_ENCODING` |
| `categoryAscending`, `sortAssets` | The contracts' asset order |
| `getPadding(bytes)`, `MaxPaddingBytes` | Padding argument bytes (0 to 10,000) |

Encoding does not validate: validate first (the builders do). Layouts:
[ENCODINGS.md](../../../agents/fixed-basket/v1/ENCODINGS.md).

## Fees

| Function | Description |
| --- | --- |
| `encodeFee({ category?, amount, destination? })` | Enforced fee NFT commitment; `category` defaults to BCH |
| `decodeFee({ hex, network? \| prefix? })` | Inverse; `network` picks the destination address prefix |
| `getBestFee({ feeContract, feeVaultContract, fee, payBy? })` | The cheapest fee UTXO payable in `payBy` (default BCH), ties broken randomly, with its two outputs |
| `getAvailableFees({ feeContract, fee })` | Cheapest amount per payment category |

Default fee UTXOs (no NFT) cost `fee.value` in BCH. Voluntary and malformed fee NFTs are skipped.

## Contracts and artifacts

| Export | Description |
| --- | --- |
| `deriveSystemContracts(provider, system)` | `SystemContracts`, without network access |
| `deriveFundContracts(provider, system, fund)` | `FundContracts` |
| `artifacts` | Typed artifacts by contract name: `transactionManager`, `fundManager`, `assetManager`, `feeManager`, `fundStartup`, `fundInflowMint`, `fundOutflowMint`, `publicFund`, `publicFundVault`, `authHeadVault`, `simpleVault`, `simpleMinter`, `feeMinter`, `instanceVault` |

Contracts are typed by artifact (e.g. `TransactionManagerContract`), so constructor arguments
and `unlock.*()` calls are type-checked.

## Measured sizes

| Transaction | BCH + 3 assets | BCH + 38 assets |
| --- | --- | --- |
| Create fund | 6,202 bytes | 9,838 bytes |
| Mint | 3,731 bytes | 15,281 bytes |
| Redeem | 4,613 bytes | 21,413 bytes |

Compute and size limits for large funds: [LIMITS.md](../../../agents/fixed-basket/v1/LIMITS.md).
