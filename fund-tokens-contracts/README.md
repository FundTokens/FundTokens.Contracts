# FundTokens Builders

TypeScript library for FundTokens on Bitcoin Cash: transaction builders to create
funds, mint fund tokens and redeem them, plus a client for the FundTokens registry.
It coordinates the many contracts each operation touches, so you only add your own
inputs and outputs.

- **Registry client**: find the current instance (deployed system contracts), discovered funds, and BCMR metadata
- **Fund type resolver**: turn registry data into the right fund type version's builders and contracts
- **Fund creation**: publish a new fund on-chain with a custom basket of BCH and CashTokens
- **Minting and redeeming**: deposit a fund's assets for fund tokens, or redeem fund tokens for the assets
- **Versioned fund types**: every fund type version has its own frozen contracts and builders, so new versions never change existing ones

## Installation

```bash
npm install @fundtokens/builders
```

ESM only, with TypeScript declarations included. Node 18+ or any modern bundler.

## Entry points

| Import | Contents |
| --- | --- |
| `@fundtokens/builders` | Everything below, plus shared errors, constants and output helpers |
| `@fundtokens/builders/registry` | `FundTokensRegistry` and registry types |
| `@fundtokens/builders/token-basket` | Token basket fund type: descriptor, `resolve`, and all versions |
| `@fundtokens/builders/token-basket/v1` | Token basket v1 builders, encoding, fees and contract derivation |
| `@fundtokens/builders/token-basket/v1/artifacts/<name>.json` | Compiled v1 contract artifacts (e.g. `fund.json`) |
| `@fundtokens/builders/weighted-bch-usd[/v1]` | Weighted BCH/USD: **planned**, builders throw `NOT_IMPLEMENTED` |

From the root, fund types are namespaces: `TokenBasket.v1.FundTokenTransactionBuilder`,
`TokenBasket.v1.Fund` (a type), and so on.

## Quick start

### 1. Resolve the instance

```ts
import { FundTokensRegistry, FundTypeResolver, TokenBasket } from '@fundtokens/builders';

const registry = new FundTokensRegistry({ network: 'chipnet' }); // or { url: 'http://localhost:3002' }
const resolver = new FundTypeResolver({ provider });

// The registry says which instance to use; the resolver picks the fund type version that
// operates it and binds it to your provider: parsed parameters, contracts, builder classes.
const tb = resolver.resolve(await registry.getCurrentInstance(TokenBasket));
tb.version;                        // 'v1'
tb.contracts.publicFundVaultContract; // system contracts
tb.FundTokenTransactionBuilder;    // this version's classes, if you construct builders yourself
```

`resolve` throws `UNSUPPORTED_FUND_TYPE` if this library has no matching version
(`FundTypeResolver.supports(instance)` checks first). If you already know the version,
`TokenBasket.v1` has the same classes and functions to use directly.

### 2. Create a fund

```ts
const builder = tb.createPublicFundBuilder();

// The genesis input comes first; its txid becomes the fund's token category.
builder.addInput(genesisUtxo, wallet.signatureTemplate.unlockP2PKH());
await builder.addBroadcast({
    fund: {
        category: genesisUtxo.txid,
        amount: 10n,       // fund tokens per whole fund unit
        satoshis: 1000n,   // BCH backing per unit (0 for none)
        assets: [{ category: tokenCategory, amount: 2n }], // per unit; any order
    },
    // payBy: tokenCategory,  // pay the create fee in a token instead of BCH
});
builder.addInput(fundingUtxo, wallet.signatureTemplate.unlockP2PKH());
// ...add change, then:
await builder.send();
```

If you add outputs before `addBroadcast`, output 0 must be `builder.getAuthHeadOutput()`,
the fund's identity output.

### 3. Mint fund tokens (inflow)

```ts
const builder = tb.createFundTokenBuilder(fund);
await builder.addInflow({ units: 2n }); // 2 whole units = 2 × fund.amount fund tokens

const { category, amount } = builder.fund; // the fund, normalised (bigint amounts, sorted assets)
builder
    .addInputs([bchUtxo, ...assetUtxos], wallet.signatureTemplate.unlockP2PKH())
    .addOutput({ to: wallet.tokenAddress, amount: 1000n, token: { category, amount: 2n * amount } });
// ...add asset and BCH change, then:
await builder.send();
```

### 4. Redeem fund tokens (outflow)

```ts
const builder = tb.createFundTokenBuilder(fund);
await builder.addOutflow({ units: 1n });

builder
    .addInputs([bchUtxo, fundTokenUtxo], wallet.signatureTemplate.unlockP2PKH())
    .addOutputs(builder.fund.assets.map(a => ({ to: wallet.tokenAddress, amount: 1000n, token: { category: a.category, amount: a.amount } })));
// ...add an output for the released BCH (fund.satoshis per unit) and change, then:
await builder.send();
```

## Key concepts

**Units.** `addInflow` / `addOutflow` take `units`, meaning whole fund units. One unit is
`fund.amount` fund tokens, backed by `fund.satoshis` BCH and `asset.amount` of each asset.

**Input/output alignment.** Contracts find their outputs by index, so `addInflow`,
`addOutflow` and `addBroadcast` need equal input and output counts when called.
Add your own inputs and outputs before or after, in matching numbers. The builders
throw `INVALID_TRANSACTION_STATE` otherwise.

**Validation.** Funds, parameters and amounts are validated before anything is
built: categories must be 32-byte hex, amounts must be in range, and a fund must
have some backing, with no duplicate or self-referencing assets. Amounts can be
`bigint`, safe integers or decimal strings, so registry JSON can be passed straight
in. `validate: false` skips the value checks. It exists only for building
deliberately invalid transactions, for example to show that the contracts reject them.

**Fees.** The cheapest fee thread payable in `payBy` (default BCH) is chosen, and
ties are spread randomly across threads to reduce collisions between concurrent
users. `getAvailableFees` lists the cheapest option per payment category.

**Errors.** Everything throws `FundTokensError` (registry calls throw its subclass
`RegistryError`, which adds `url` and `status`). Branch on `error.code`:

| Code | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | A supplied value is malformed or out of range; the message names the field |
| `INVALID_ENCODING` | A fund, fee or commitment encoding could not be decoded |
| `INVALID_TRANSACTION_STATE` | The builder's current inputs/outputs don't meet the operation's preconditions |
| `MISSING_UTXO` | A contract UTXO the transaction needs doesn't exist (e.g. the fund isn't created yet) |
| `INSUFFICIENT_FUNDS` | Contract UTXOs can't cover the request (e.g. custody holds too little to redeem) |
| `UNSUPPORTED_FUND_TYPE` | No usable fund type version matches a registry instance |
| `NOT_IMPLEMENTED` | A planned feature (e.g. Weighted BCH/USD builders) |
| `REGISTRY_REQUEST_FAILED` / `REGISTRY_NOT_FOUND` / `REGISTRY_INVALID_RESPONSE` | Registry unreachable or erroring / no such record / unexpected response |

```ts
import { isFundTokensError } from '@fundtokens/builders';

try {
    await builder.addOutflow({ units });
} catch (error) {
    if (isFundTokensError(error, 'INSUFFICIENT_FUNDS')) { /* offer fewer units */ }
    throw error;
}
```

**Logging.** Builders are silent by default. Pass `logger: console`, or any object
with `debug`, `info`, `warn` and `error` methods, to trace what they add.

## Registry client

```ts
const registry = new FundTokensRegistry({ network: 'chipnet', timeoutMs: 10_000, cacheTtlMs: 60_000 });

await registry.getHealth();                        // { ready, httpStatus, status, sync, ... }; never throws
await registry.getInstances({ type: TokenBasket }); // every instance of a fund type
await registry.getCurrentInstance('fixed-basket');  // registry type, library key or descriptor
await registry.getInstance(1);                      // undefined if unknown
await registry.getFunds({ limit: 50, offset: 0 });  // one page
for await (const fund of registry.iterateFunds()) { /* every fund */ }
await registry.getFund(category);                   // with authchain and identity history; undefined if unknown
await registry.getMetadataRegistry();               // the BCMR document
```

Instance listings are cached for `cacheTtlMs`, and concurrent calls share one
request. Results are copies, so they're safe to mutate. Fund amounts come back as
decimal strings; `FundTypeResolver.resolveFund` parses them with the right version.

## Fund type resolver

`FundTypeResolver` turns registry data into the fund type version that operates it,
bound to a network provider. Registry results feed straight in; so does any object
with the same fields.

```ts
const resolver = new FundTypeResolver({ provider });

// Instances
FundTypeResolver.supports(instance);   // false for unknown types and unsupported or planned versions
const tb = resolver.resolve(instance); // a TokenBasket.v1.TokenBasketInstance today
tb.key; tb.version;                    // 'token-basket', 'v1'; narrow on these as more types are added
tb.system;                             // parsed parameters (bigint fees)
tb.contracts;                          // system contracts
tb.PublicFundTransactionBuilder;       // this version's builder classes
tb.FundTokenTransactionBuilder;
tb.createPublicFundBuilder();          // builders bound to the provider and parameters
tb.createFundTokenBuilder(fund);
tb.getFundContracts(fund);
tb.parseFund(record.fund);
tb.decodeFundCommitment(hex);

// Funds: a registry fund record and the instance it belongs to
const record = (await registry.getFund(category))!;
const { fund, contracts, createBuilder, instance } =
    resolver.resolveFund(record, (await registry.getInstance(record.instanceId))!);

// Every usable instance
const usable = (await registry.getInstances()).filter(FundTypeResolver.supports).map(i => resolver.resolve(i));
```

`resolve` throws `UNSUPPORTED_FUND_TYPE` for instances it can't operate and
`INVALID_ARGUMENT` for malformed parameters. `resolveFund` also throws
`INVALID_ARGUMENT` when the record's `instanceId` doesn't match the instance.

## Fund types and versions

| Fund type | Registry type | Versions |
| --- | --- | --- |
| `TokenBasket`: fixed basket of BCH and CashTokens | `fixed-basket` | `v1` (supported) |
| `WeightedBchUsd`: BCH and a USD token in target weights | `weighted-bch-usd` | `v1` (planned) |

A version's contracts are frozen when it's released. A contract change ships as a
new version with its own copy of the contracts, builders and tests, so funds on an
older version keep working with the builders that match them.

`FundTypeResolver` (and `TokenBasket.resolve`) match the registry instance's `version` against
each version's `id` (`'v1'`). The contract version is independent of the npm package
version, so **instances should record the contract version id (`v1`) as their registry
`version`.**

## Migrating from 0.1.x

| 0.1.x | 0.2 |
| --- | --- |
| `import { FundTokenTransactionBuilder } from '@fundtokens/builders'` | `TokenBasket.v1.FundTokenTransactionBuilder`, or import from `@fundtokens/builders/token-basket/v1` |
| `getFundHex`, `decodeFund`, `encodeFee`, … at the root | Same names under `TokenBasket.v1` |
| `addInflow({ amount })` / `addOutflow({ amount })` | `addInflow({ units })` / `addOutflow({ units })`; same meaning |
| `system: { ...system, fee: system.fees.execute }` | `system`; the execute fee is always used |
| `addBroadcast` resolved to `undefined` | Resolves to the builder, for chaining |
| `registry.getCurrent(type)` returned parameters | `registry.getCurrentInstance(type)` returns the instance; parse `instance.parameters` with its version |
| `registry.getInstance({ id, hash })` | `registry.getInstance(id)`; the registry no longer keys instances by hash |
| `SystemTransactionBuilder` | Removed; system maintenance is not part of this library |
| `lib/art/*.json` | `@fundtokens/builders/token-basket/v1/artifacts/*.json`, or typed via `TokenBasket.v1.artifacts.fundManager` etc. |
| Plain `Error`s | `FundTokensError` with a `code` |
| Logged to `console` by default | Silent by default; pass `logger: console` |

Behaviour changes worth knowing:

- `getBestFee` now really picks the cheapest fee. Before, its sort was broken and it took whichever fee UTXO came first.
- NFT outputs now carry the exact dust their size requires. Commitment outputs were previously overfunded, e.g. 1461 instead of 1065 satoshis for a 128-byte commitment.
- Redemption selects custody UTXOs largest-first and throws `INSUFFICIENT_FUNDS` when they can't cover the request, rather than building a transaction the contracts reject.
- Minting throws `INVALID_ARGUMENT` when the BCH it would lock is below the dust minimum, and says how many units are needed.
- Voluntary or malformed fee threads are skipped instead of making fee selection fail.

## Development

```
fund-tokens-contracts/
├─ src/
│  ├─ core/                    shared errors, validation, outputs (fund-type independent)
│  ├─ registry/                FundTokensRegistry (+ tests/)
│  └─ fund-types/
│     ├─ token-basket/
│     │  └─ v1/
│     │     ├─ contracts/      CashScript sources (frozen once released)
│     │     ├─ artifacts/      generated: <name>.json, typed <name>.ts, index.ts
│     │     ├─ tests/          contract, integration and unit tests (+ support/ fixtures)
│     │     └─ *.ts            builders, encoding, fees, contract derivation
│     └─ weighted-bch-usd/v1/  planned stub
├─ test-utils/                 wallet and vitest setup shared by tests
├─ scripts/                    build-contracts, copy-artifacts
└─ metrics/                    contract operation cost report
```

The project uses Yarn 4, pinned by `packageManager` in `package.json`. Corepack (bundled
with Node) runs that version whenever you type `yarn`; run `corepack enable` once if
`yarn` isn't found.

| Script | Does |
| --- | --- |
| `yarn build:contracts` | Compiles every version's `.cash` into JSON and typed artifacts plus an index. Committed JSON is kept when its bytecode is unchanged |
| `yarn check:contracts` | Fails if any committed artifact doesn't match its source |
| `yarn typecheck` | Type-checks tests, scripts and metrics, then the library under stricter settings |
| `yarn test` | Runs the tests (vitest), skipping the long-running ones listed in `vitest.config.ts` |
| `yarn test:all` | Runs every test, long-running ones included (same as `yarn test --mode all`) |
| `yarn build` | Compiles the library to `dist/` and copies the JSON artifacts |
| `yarn verify` | All of the above (with `test:all`), in the order CI should run them |
| `yarn metrics` | Prints each contract's estimated VM operation cost |

Tests that need distinct token categories should use `randomCategory()` from
`test-utils/random.ts`. cashscript's `randomToken().category` only has 10,000
possible values, so several draws can collide.

Run the registry tests against a real registry too (read-only):

```bash
FUNDTOKENS_REGISTRY_URL=http://localhost:3002 yarn test src/registry
```

### Adding a fund type version

1. Copy the latest version directory (e.g. `token-basket/v1` to `token-basket/v2`), then change the contracts and builders there only.
2. Run `yarn build:contracts`.
3. Set `id` in `v2/index.ts` and `version` in `v2/instance.ts`, register `v2` in `token-basket/index.ts` (`versions`, `latest`), and add `./token-basket/v2` exports to `package.json`. `FundTypeResolver` picks it up from there.
4. Keep `v1` untouched: its contracts, builders and tests go on serving existing funds.

A new fund type follows the `weighted-bch-usd` stub: a directory with an `index.ts`
descriptor whose versions export `createInstance`, listed in `src/fund-types/catalog.ts`,
added to `ResolvedInstance` in `src/fund-types/FundTypeResolver.ts`, and in the
`package.json` exports.

## Publishing

The package ships `dist/` (compiled library and declarations, with the contract
artifacts as JSON and typed modules), plus this README, `LICENSE` and
`package.json`. It does not ship tests, contract sources, scripts or metrics.

1. From `fund-tokens-contracts/`, install and verify:
   ```bash
   yarn install --immutable
   yarn verify
   ```
2. Bump `version` in `package.json` (release candidates look like `0.2.0-rc2`) and commit.
3. Check exactly what will ship. `npm pack` runs the build first (`prepack`):
   ```bash
   npm pack --dry-run
   ```
4. Publish. `prepublishOnly` re-checks artifacts, types and tests. npm 11 requires
   `--tag` for prerelease versions; earlier RCs were published as `latest`:
   ```bash
   npm publish --access public --tag latest   # a release candidate, as before
   npm publish --access public --tag next     # or: an RC that shouldn't become the default install
   npm publish --access public                # a final release (no -rc suffix)
   ```
5. Tag the commit, e.g. `git tag builders-v0.2.0-rc2 && git push origin builders-v0.2.0-rc2`.

## Security model

- Non-custodial: funds are held in contract UTXOs controlled only by code
- Parameters are immutable: fund details are hashed and committed to tokens
- Contracts are isolated: each has a single, verified responsibility
- Validation is atomic: multi-contract checks run within one transaction

## License

Copyright (c) 2026 FoldingCash LLC, doing business as Fun(d)Tokens. All rights reserved.
