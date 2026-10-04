# Integration Guide & Examples

Step-by-step examples for integrating FundTokens into an application with
`@fundtokens/builders`. The examples use the token basket fund type (v1); other fund types
resolve the same way and differ in their builders. For the full API, see the
[Library API](LIBRARY_API.md) and the [token basket v1 builders](fund-types/token-basket/v1/BUILDERS.md).

## Table of Contents

1. [Setup](#setup)
2. [Creating a Fund](#creating-a-fund)
3. [Minting Fund Tokens](#minting-fund-tokens-inflow)
4. [Redeeming Fund Tokens](#redeeming-fund-tokens-outflow)
5. [Discovering Funds](#discovering-funds)
6. [Error Handling](#error-handling)
7. [Testing](#testing)
8. [Best Practices](#best-practices)

---

## Setup

```bash
npm install @fundtokens/builders cashscript
```

Every operation needs a network provider and the instance (the deployed system
contracts) you are working with. The registry says which instance to use, and
`FundTypeResolver` turns it into the fund type version that operates it, bound to your
provider:

```ts
import { ElectrumNetworkProvider, Network } from 'cashscript';
import { FundTokensRegistry, FundTypeResolver, TokenBasket } from '@fundtokens/builders';

const provider = new ElectrumNetworkProvider(Network.CHIPNET);
const registry = new FundTokensRegistry({ network: 'chipnet' });
const resolver = new FundTypeResolver({ provider });

const tb = resolver.resolve(await registry.getCurrentInstance(TokenBasket));
const { system } = tb; // parsed parameters; tb.contracts holds the system contracts
```

`resolve` throws `UNSUPPORTED_FUND_TYPE` when this library has no version for the
instance; upgrade the library in that case. The examples below use `tb`, the resolved
instance.

Once more fund types exist, check which one you resolved before using its builders:

```ts
const instance = resolver.resolve(registryInstance);
if (instance.key === 'token-basket' && instance.version === 'v1') {
    // instance is a TokenBasket.v1.TokenBasketInstance
}
```

## Creating a Fund

A fund is defined by its token category (the txid of a genesis UTXO you control), how
many fund tokens make up one whole unit, and what backs each unit:

```ts
async function createFund({ wallet, genesisUtxo, fundingUtxo }) {
    const builder = tb.createPublicFundBuilder();
    const unlock = wallet.signatureTemplate.unlockP2PKH();

    // 1. The genesis input first: output 0 of a transaction, holding no tokens.
    builder.addInput(genesisUtxo, unlock);

    // 2. The contract side. Assets may be in any order; they are sorted for you.
    await builder.addBroadcast({
        fund: {
            category: genesisUtxo.txid,
            amount: 10n,        // 10 fund tokens = 1 unit
            satoshis: 1000n,    // each unit is backed by 1,000 sats…
            assets: [
                { category: xyzCategory, amount: 2n }, // …2 XYZ…
                { category: defCategory, amount: 5n }, // …and 5 DEF
            ],
        },
        // payBy: someTokenCategory, // pay the create fee in a token (if a fee thread accepts it)
    });

    // 3. Pay the create fee and any change.
    builder
        .addInput(fundingUtxo, unlock)
        .addBchChangeOutputIfNeeded({ to: wallet.address, feeRate: 1 });

    const { txid } = await builder.send();
    return txid;
}
```

The transaction mints the fund's full token supply into its fund contract, mints its
inflow and outflow threads, and publishes the fund definition on-chain. The registry
indexes it once confirmed.

## Minting Fund Tokens (Inflow)

A user deposits the backing for some number of units and receives
`units × fund.amount` fund tokens:

```ts
async function mint({ wallet, fund, units }) {
    const builder = tb.createFundTokenBuilder(fund);
    const unlock = wallet.signatureTemplate.unlockP2PKH();

    // 1. The contract side: thread, fee, fund supply, and custody outputs.
    await builder.addInflow({ units });

    // 2. The user's side: the assets being deposited and BCH for the fee and backing.
    const { assets, satoshis, amount, category } = builder.fund; // normalised fund
    const utxos = await provider.getUtxos(wallet.tokenAddress);
    for (const asset of assets) {
        const utxo = utxos.find(u => u.token?.category === asset.category && u.token.amount >= asset.amount * units);
        if (!utxo) throw new Error(`Not enough ${asset.category}`);
        builder.addInput(utxo, unlock);
        const change = utxo.token!.amount - asset.amount * units;
        if (change > 0n) {
            builder.addOutput({ to: wallet.tokenAddress, amount: 1000n, token: { category: asset.category, amount: change } });
        }
    }
    const bch = utxos.find(u => !u.token && u.satoshis >= satoshis * units + system.fees.execute.value + 10_000n);
    builder.addInput(bch!, unlock);

    // 3. The minted fund tokens, then BCH change.
    builder
        .addOutput({ to: wallet.tokenAddress, amount: 1000n, token: { category, amount: units * amount } })
        .addBchChangeOutputIfNeeded({ to: wallet.address, feeRate: 1 });

    return (await builder.send()).txid;
}
```

The contract side and the user side can be added in either order, as long as input
and output counts are equal each time `addInflow` is called.

## Redeeming Fund Tokens (Outflow)

A user returns `units × fund.amount` fund tokens and receives each unit's backing:

```ts
async function redeem({ wallet, fund, units }) {
    const builder = tb.createFundTokenBuilder(fund);
    const unlock = wallet.signatureTemplate.unlockP2PKH();
    const { assets, satoshis, amount, category } = builder.fund;

    // 1. The contract side: thread, fee, fund collection, custody releases (+ change back to custody).
    await builder.addOutflow({ units });

    // 2. The user's fund tokens and BCH for the fee.
    const utxos = await provider.getUtxos(wallet.tokenAddress);
    const tokens = utxos.find(u => u.token?.category === category && u.token.amount >= units * amount)!;
    const bch = utxos.find(u => !u.token && u.satoshis >= system.fees.execute.value + 10_000n)!;
    builder.addInputs([tokens, bch], unlock);

    // 3. What the user receives: each asset, the BCH backing, and fund token change.
    builder.addOutputs(assets.map(a => ({
        to: wallet.tokenAddress,
        amount: 1000n,
        token: { category: a.category, amount: a.amount * units },
    })));
    if (satoshis > 0n) {
        builder.addOutput({ to: wallet.address, amount: satoshis * units });
    }
    const tokenChange = tokens.token!.amount - units * amount;
    if (tokenChange > 0n) {
        builder.addOutput({ to: wallet.tokenAddress, amount: 1000n, token: { category, amount: tokenChange } });
    }
    builder.addBchChangeOutputIfNeeded({ to: wallet.address, feeRate: 1 });

    return (await builder.send()).txid;
}
```

## Discovering Funds

Each fund record names the instance it belongs to; `resolveFund` resolves the two
together, parsing the fund with the right version:

```ts
const instances = await registry.getInstances();

for await (const record of registry.iterateFunds()) {
    const instance = instances.find(i => i.id === record.instanceId);
    if (!instance || !FundTypeResolver.supports(instance)) continue; // e.g. an older contract version

    const { fund, contracts, createBuilder } = resolver.resolveFund(record, instance);
    console.log(record.category, fund.assets.length, 'assets', contracts.fundContract.tokenAddress);
}

const detail = await registry.getFund(category);                  // undefined if unknown
console.log(detail?.identityHistory.at(-1)?.identity);            // latest BCMR identity
```

## Error Handling

Every error is a `FundTokensError` with a stable `code`:

```ts
import { isFundTokensError } from '@fundtokens/builders';

try {
    await mint({ wallet, fund, units: 100n });
} catch (error) {
    if (isFundTokensError(error, 'INVALID_ARGUMENT')) {
        // A value was out of range, e.g. the BCH locked would be below dust; the message says the minimum
    } else if (isFundTokensError(error, 'MISSING_UTXO')) {
        // The fund isn't created (or confirmed) yet, or no fee thread accepts payBy: retry, or pay in BCH
    } else if (isFundTokensError(error, 'INSUFFICIENT_FUNDS')) {
        // Supply (mint) or custody (redeem) can't cover the units requested
    } else if (isFundTokensError(error, 'INVALID_TRANSACTION_STATE')) {
        // Inputs and outputs weren't equal when addInflow/addOutflow/addBroadcast ran
    }
    throw error;
}
```

Fee options can be inspected before choosing `payBy`:

```ts
const { feeContract } = tb.getFundContracts(fund);
const fees = await TokenBasket.v1.getAvailableFees({ feeContract, fee: tb.system.fees.execute });
// { '<category>': { category, amount } }; the all-zero BitcoinCategory key means BCH
```

## Testing

Parts of an integration that don't need a network can be unit tested directly:

```ts
import { describe, expect, it } from 'vitest';
import { MockNetworkProvider } from 'cashscript';
import { FundTypeResolver } from '@fundtokens/builders';

describe('my fund', () => {
    it('is valid and has stable contracts', () => {
        const tb = new FundTypeResolver({ provider: new MockNetworkProvider() }).resolve(myInstance);
        const { fundContract } = tb.getFundContracts(tb.parseFund(myFundDefinition));
        expect(fundContract.tokenAddress).toMatchSnapshot();
    });
});
```

A full mint or redeem on a `MockNetworkProvider` needs an initialised instance: its
control tokens, threads and fee UTXOs. The library repository's test fixtures show how
to create one: `bootstrapInstance` and `createFund` in
[tests/support/bootstrap.ts](../fund-tokens-contracts/src/fund-types/token-basket/v1/tests/support/bootstrap.ts).
They aren't part of the published package. Otherwise, test against chipnet.

## Best Practices

1. **Use the registry's version.** Resolve instances with `FundTypeResolver` rather than hard-coding a version, so a future `v2` instance isn't built with `v1` contracts.
2. **Think in units.** `units` counts whole fund units; the fund tokens involved are `units × fund.amount`.
3. **Keep inputs and outputs aligned.** Call `addInflow` / `addOutflow` / `addBroadcast` when input and output counts are equal.
4. **Handle errors by `code`**, not by message.
5. **Don't turn off validation** in production; `validate: false` exists to test that the contracts reject bad transactions.
6. **Mind dust.** Give token outputs at least 1,000 satoshis. A fund with a small `satoshis` value needs enough units per mint for the locked BCH to clear dust; the builder says how many.
7. **Test on chipnet** before mainnet.

---

## See Also

- [Overview](OVERVIEW.md): concepts and lifecycle
- [Library API](LIBRARY_API.md): registry, resolver, errors
- [Token basket v1](fund-types/token-basket/v1/README.md): contracts, [system tokens](fund-types/token-basket/v1/TOKENS.md), [builders](fund-types/token-basket/v1/BUILDERS.md)
