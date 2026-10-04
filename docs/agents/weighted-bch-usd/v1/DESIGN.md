# Weighted BCH/USD v1: Design

**Status: design, under review, no contracts yet.** This is the specification the v1
contracts and builders will be written from. When the contracts exist, it is split into the
usual `CONTRACTS.md`, `TRANSACTIONS.md`, `ENCODINGS.md` and `LIMITS.md`, and the contracts
become the source of truth.

Notation follows the [agent README](../../README.md#notation). Values are integers; `/` is
floor division unless marked `ceil`.

## What it is

A fund holding **BCH and one USD-pegged CashToken** (e.g. ParityUSD) at a **target
weight**, rebalanced back to the target when the weight drifts **outside a tolerance band**.
Example: 50% BCH / 50% PUSD, rebalanced when BCH is above 55% or below 45% of the fund's value.

Every number that defines that behaviour is a field of the fund definition (BCH weight,
band, rebalance reward, USD token, shard limit), so one set of contracts serves any
weighting.

## Requirements

| # | Requirement | Where it is met |
| --- | --- | --- |
| R1 | Simple asset-based ETF holding BCH and a USD token at target weights; mint and redeem with both, less a fixed fee | [Fund model](#fund-model), [mint](#mint-in-kind), [redeem](#redeem-in-kind) |
| R2 | Rebalance toward the target on a trigger | [Rebalance](#rebalance) |
| R3 | Every parameter is a variable of the fund (weight, band, reward, token) | [Fund definition](#fund-definition) |
| R4 | Multi-threaded for scaling; a sync event keeps threads in step | [Shards](#shards), [the sync rule](#the-sync-rule) |
| R5 | Shards can be added and removed later, without spam | [Resizing](#resizing) |
| R6 | Prices come from a fixed pricing contract checking one or more sources, oracles.cash first; the sources can be upgraded | [Price feed](#price-feed) |
| R7 | Sources that disagree too much halt trading | [Aggregation and halting](#aggregation-and-halting) |
| R8 | The token-basket fee system | [Fees](#fees) |
| R9 | The rebalancer earns a configurable reward (> Cauldron's 0.3%) that can't drain the fund; rebalances pay no protocol fee | [Reward and drain bounds](#reward-and-drain-bounds) |

## Key decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | **Mint and redeem in kind**: deposit or receive the current per-unit basket of BCH and USD, like an ETF's creation and redemption units, plus a **fixed execute fee per transaction** | Minting and redeeming need no price, so they can't be manipulated through the oracle and keep working when trading halts. The fee is the token-basket execute fee: fixed, not a share of the amount |
| D2 | **Sharded custody**: each thread (shard) holds its own BCH and USD reserves and counts its own outstanding units | A contract can read its whole reserve from two UTXOs, so the per-unit basket is just `reserve / units`. Mints and redeems are constant size per shard (no custody chains as in token basket), and each shard serves one user at a time, in parallel |
| D3 | **Rebalances and resizes are sync events**: one transaction spends every active shard of the fund | Shards whose baskets differ can be arbitraged (mint in the cheap one, redeem in the dear one) at holders' expense. Acting on all of them together keeps every shard's per-unit basket identical and every shard's shard count current |
| D4 | **The contract computes the trade**: it chooses how much to buy or sell to land exactly on the target weight | The rebalancer chooses nothing but whether to act, so it can't overtrade, undertrade or move shards apart |
| D5 | **The reward is a price spread**: the rebalancer trades at the feed price less (or plus) `rewardBps` | The reward is proportional to the trade, which the band bounds, and needs no separate payout |
| D6 | **One fixed price feed per instance**, permissionless to update, strictly newer prices only, every source must agree | Shared by every fund on the instance. Monotonic timestamps stop replays; disagreement fails the update, which halts rebalancing. The feed contract itself can't be replaced |
| D7 | **Only the oracle sources can be upgraded**, timelocked behind an authorization permission | A bad price is the main way to drain a rebalancing fund. The delay gives holders time to see a pending change and redeem (in kind, which never halts) |
| D8 | **Every shard is created at genesis**, up to the fund's `maxShards`; shards beyond the active count are parked | New shard NFTs would need a minting NFT of the fund category. With none, no shard can ever be forged. Adding a shard activates a parked one; removing one parks it again |
| D9 | **Anyone may add a shard by paying its seed; only the steward may remove one** | The seed is a permanent donation to holders, and `maxShards` bounds the total: a built-in spam cost. Removing costs nothing and could be used to grief, so it needs a permission |
| D10 | **Reuse token-basket v1's system contracts**: fees, fee minting, fee vault, public listing, identity vault, instance vault, authorization | Same fee system, listing and maintenance as token basket. Each version keeps its own frozen copy |

## Fund model

A fund defines a **unit**: `amount` fund tokens. A unit's backing (its **basket**) is a
share of a shard's reserves, not a fixed amount as in token basket:

```
bchPerUnit = shardSats / shardUnits      usdPerUnit = shardUsd / shardUnits
```

Every active shard has the same per-unit basket (the [sync rule](#the-sync-rule)), so a fund
token is worth the same everywhere. The basket changes only when the fund rebalances.

### Value and weight

Prices are **USD cents per BCH** (`p`, as the oracles.cash USD oracle signs them).
`usdScale` is 10^decimals of the USD token, so a reserve's value in USD-token base units ×
10¹⁰ is:

```
P  = p · usdScale
VB = sats · P              (BCH value)
VU = usd · 10¹⁰            (USD value)
weight = VB · 10000 / (VB + VU)     in basis points
```

Working in ×10¹⁰ units keeps every comparison division-free. BCH VM integers are
arbitrary precision (2025 upgrade), so products of 64-bit values don't overflow.

## Fund definition

Passed to the creation and shard contracts, hashed into the fund hash
(`hash256(definition)`). Integers are little-endian VM numbers.

```
fundCategory (32) · amount (8) · usdCategory (32) · usdScale (8) ·
targetBps (2) · toleranceBps (2) · rewardBps (2) · maxShards (1) ·
lockedUnits (8) · unitSats (8) · unitUsd (8)
```

111 bytes.

| Field | Meaning | Rule (FundStartup) |
| --- | --- | --- |
| `fundCategory` | Fund token category: the genesis transaction's id | Equals `in[0]`'s outpoint hash, and `in[0]` spends output 0 |
| `amount` | Fund tokens per unit | 1 … 2⁶³−1 |
| `usdCategory` | The USD-pegged token | Not all zeros, not `fundCategory` |
| `usdScale` | 10^decimals of the USD token (PUSD with 2 decimals: 100) | ≥ 1 |
| `targetBps` | Target BCH weight | 1 … 9999 |
| `toleranceBps` | Band around the target before a rebalance is allowed, in absolute weight points (500 around 5000 is 45%–55%) | 1 … 5000 |
| `rewardBps` | Rebalancer's price spread | 0 … 1000. Library default 35 (0.35%) |
| `maxShards` | Shards created at genesis: the most that can ever be active | 1 … 16 (to be confirmed by measurement, see [limits](#limits)) |
| `lockedUnits` | Units an active shard is seeded with and never releases | ≥ 1 |
| `unitSats`, `unitUsd` | The opening basket per unit | `unitSats ≥ 1`, `unitUsd ≥ 0`, `lockedUnits · unitSats ≥ 1000` (shard dust) |

The 50/50 example: `targetBps 5000`, `toleranceBps 500`, `rewardBps 35`.

## Shards

A shard is a pair of UTXOs created together and always spent and recreated together, at
adjacent indices:

| UTXO | Contract | Holds |
| --- | --- | --- |
| Shard | ShardManager (per fund) | The shard's **BCH reserve** (its whole value), its unminted **fund tokens**, and a **mutable NFT of the fund category** carrying the shard state |
| Reserve | ReserveVault (per fund) | The shard's **USD reserve** (fungible `usdCategory` tokens, or none when it holds no USD) and a fixed dust value |

**Shard state** (the fund-category mutable NFT's commitment):

```
0x01 · index (1) · count (1) · units (8) · epoch (4)
```

| Field | Meaning |
| --- | --- |
| `index` | 0 … `maxShards`−1, fixed at genesis |
| `count` | Active shards in the fund (active shards are indices 0 … `count`−1). Equal in every active shard |
| `units` | Units outstanding against this shard, `lockedUnits` included. 0 for a parked shard, otherwise never below `lockedUnits` |
| `epoch` | Price timestamp of the fund's last rebalance (0 at creation). Equal in every active shard |

**Active and parked.** A shard is **active** when `units > 0`, **parked** when
`units == 0`. A parked shard holds only dust (and its fund tokens): no reserves, no basket.
It can't mint, redeem or rebalance; only [resizing](#resizing) touches it.

**Pairing.** A reserve belongs to the shard created just before it in the same
transaction: `in[r].outpointTransactionHash == in[s].outpointTransactionHash` and
`in[r].outpointIndex == in[s].outpointIndex + 1`, with `r = s + 1`. Every operation
recreates the pair at adjacent outputs, so the pairing carries forward. All of a fund's
reserves share one ReserveVault address.

**Identity.** Mutable NFTs of the fund category exist only as shards: FundStartup checks
the genesis creates exactly `maxShards` of them at the ShardManager, and no minting NFT, so
no more can ever be made. The ShardManager never lets one leave or split. So "a mutable
fund-category NFT" identifies a shard, and the ReserveVault needs no other link to the
ShardManager.

**Supply.** Genesis mints the whole supply into the shards: each holds
`(2⁶³−1) / maxShards` fund tokens. Minting releases tokens from a shard; redeeming returns
them to a shard (not necessarily the same one). A shard's token balance is just its
unreleased supply: the accounting uses `units`.

**Locked units.** Each active shard is seeded with `lockedUnits` units of the current
basket, paid by whoever activates it, whose fund tokens are never released. An active
shard can never empty, so its per-unit basket is always defined. This is the "dead shares"
guard used by AMMs.

### The sync rule

**Every active shard of a fund has the same per-unit basket**, up to rounding in the
fund's favour, **and the same `count` and `epoch`**:

- Creation seeds every active shard identically.
- Mint and redeem move a shard's reserves in exact proportion to its units, so its
  per-unit basket doesn't change (rounding up on deposits and down on withdrawals only ever
  raises it).
- A rebalance applies the same price and the same formula to every active shard, in one
  transaction. Each shard checks that every other active shard rebalanced with it (their
  `epoch` is set to the new price timestamp, which only `rebalance()` can do).
- Adding a shard seeds it at the current basket; removing one merges its reserves and units
  into another active shard (same basket, so the merge preserves it). Both spend every active
  shard and update its `count`.

There is no rebalancing of a subset of shards, so no active shard is ever ahead of another.
`count` and `epoch` let anyone check that a fund's shards are in sync.

## Operations

### Fees

Mint and redeem pay the instance's **execute fee** through the execute FeeManager, exactly
as in token basket: the default fixed BCH amount to the fee vault, or a fee NFT's encoded
amount (in BCH or a token such as the USD token). It's **one fee per transaction**, however
many shards it uses ([layout](#mint-and-redeem)). The builders can pay it from the redeemed
BCH, so a redemption receives its basket less the fee. Fund creation pays the **create
fee**. Rebalancing and resizing pay no protocol fee.

### Mint (in kind)

Through one or more active shards, `Δ` whole units at each. Shard state before: `sats`,
`usd`, `units`.

| Rule | |
| --- | --- |
| Active | `units > 0` |
| Fund tokens released | `in[a].tokenAmount − out[a].tokenAmount == Δ · amount`, `Δ > 0` |
| BCH deposited | `out[a].value − in[a].value == ceil(sats · Δ / units)` |
| USD deposited | `usd(out[a+1]) − usd(in[a+1]) == ceil(usd · Δ / units)`, where `usd(x)` is `x`'s `usdCategory` amount, or 0 when tokenless |
| State | `units' = units + Δ`; `index`, `count`, `epoch` unchanged |
| Fee chain | `in[a+2]` is another active shard of this fund, or the execute FeeManager returned at `a + 2` |

### Redeem (in kind)

| Rule | |
| --- | --- |
| Active | `units > 0` |
| Fund tokens returned | `out[a].tokenAmount − in[a].tokenAmount == Δ · amount`, `Δ > 0` |
| BCH released | `in[a].value − out[a].value == sats · Δ / units` |
| USD released | `usd(in[a+1]) − usd(out[a+1]) == usd · Δ / units` |
| State | `units' = units − Δ ≥ lockedUnits`; `index`, `count`, `epoch` unchanged |
| Fee chain | As mint |

Deposits and withdrawals are exact, not minimums: an overpayment would lift one shard's
basket above the others. A redemption larger than one shard's free units uses several
shards in one transaction, chained to a single fee. A transaction may mix mints and redeems
across shards.

### Rebalance

Anyone may rebalance a fund whose weight, at a price posted **in the same transaction**,
is outside `targetBps ± toleranceBps`. Every active shard runs `rebalance()`; each one:

1. Reads the price feed: `in[0]` holds the feed state NFT (`price + 0x01`), and `out[0]`'s
   state has a strictly newer timestamp `t'` than `in[0]`'s (the feed ran `update()` in
   this transaction). The price `p` is `out[0]`'s.
2. Checks every active shard is here and rebalancing: for `j` in 0 … `count`−1, `in[b + 2j]`
   is shard `j` of this fund, and `out[b + 2j]`'s state has `epoch == t'`, where
   `b = a − 2 · index`.
3. Checks the trigger and computes the trade from its own reserves (below).
4. Checks its outputs: `sats' = sats ∓ x`, `usd' = usd ± y` exactly; `units`, `index`,
   `count`, the fund token amount and the reserve's dust unchanged; `epoch' = t'`.

With `T = targetBps`, `L = toleranceBps`, `R = rewardBps`, `P = p · usdScale`,
`VB = sats · P`, `VU = usd · 10¹⁰`, `V = VB + VU`, `B = 10000`:

**BCH overweight** (`VB · B > (T + L) · V`): the fund sells `x` sats and receives `y` USD,
priced `R` below the feed:

```
x = B · (sats · P · (B − T) − T · usd · 10¹⁰) / (P · (B² − T · R))
y = ceil(x · P · (B − R) / (10¹⁰ · B))
```

**BCH underweight** (`VB · B < (T − L) · V`): the fund buys `x` sats and pays `y` USD,
priced `R` above the feed:

```
x = B · (T · usd · 10¹⁰ − sats · P · (B − T)) / (P · (B² + T · R))
y = x · P · (B + R) / (10¹⁰ · B)
```

Both solve "after the trade, BCH is exactly `T` of the fund's value at price `p`", with
the spread included. Rounding favours the fund. Within the band, `rebalance()` fails.

**Worked example** (50/50, band 500, reward 35, 1 BCH + $400, PUSD with 2 decimals):

| BCH price | Weight before | Trade | Weight after | Rebalancer earns |
| --- | --- | --- | --- | --- |
| $500 | 55.55% | fund sells 0.10017530 BCH for $49.92 | 49.99% | $0.17 (0.019% of NAV) |
| $320 | 44.44% | fund buys 0.12478163 BCH for $40.06 | 49.99% | $0.13 (0.018% of NAV) |
| $440 | 52.38% | none: inside the band | | |

### Reward and drain bounds

- The reward is `R` times the traded value, and the contract sizes the trade to just reach
  the target, so it's roughly `R · |weight − T| · NAV`. At the band's edge that is
  `R · L · NAV`: 0.35% × 5% ≈ 0.018% of NAV per rebalance.
- A rebalance needs the weight outside the band at a **newer** price than any posted
  before. Rebalancing again needs the price to move a band's worth further. Prices can't
  go back in time, so prices can't be replayed to ping-pong the fund.
- The rebalancer chooses no amounts: the contract computes `x` and `y`.
- A rebalance pays the rebalancer's miner fee from the reward, and no protocol fee. A fund
  too small for the reward to cover the miner fee doesn't get rebalanced until it grows
  (its weight drifts, nothing is lost). Library guidance: rebalance when the reward exceeds
  the miner fee.
- `rewardBps ≤ 1000` caps the worst case (a configuration error) at 10% of a trade.

### Resizing

Both spend every active shard (`in[b + 2j]`, `j` < `count`) plus the shard being changed,
and set every active shard's `count'` to the new count. Indices stay contiguous: only the
next parked shard can be added, only the highest active one removed.

**Add a shard** (`grow()`, anyone): activates parked shard `count`, at `b + 2 · count`.

- The new shard is seeded at the current basket, read from shard 0:
  `sats = ceil(lockedUnits · sats₀ / units₀)`, `usd = ceil(lockedUnits · usd₀ / units₀)`,
  `units = lockedUnits`, `epoch` = the fund's `epoch`. The caller pays the seed.
- `count + 1 ≤ maxShards`.
- No other shard's reserves, units or tokens change.

Anti-spam: each added shard costs a permanent seed, donated to holders, and at most
`maxShards` can ever be active. More shards only make rebalances and resizes larger, and
`maxShards` bounds that.

**Remove a shard** (`shrink()`, authorization `0x0400`): parks shard `count − 1` (needs
`count ≥ 2`), merging it into active shard `m` (`m < count − 1`):

- Shard `m` gains all of the removed shard's BCH and USD reserves and its `units`.
- The removed shard keeps its fund tokens, holds 1,000 sats of dust paid by the steward
  (not taken from the reserve), and its state becomes `units = 0`, `count = count − 1`. Its
  reserve keeps its dust and becomes tokenless.
- Both shards have the same basket, so the merge preserves it.

A removal can't be used to drain: every unit and every satoshi of reserve stays in the fund.
At worst a steward removes shards to throttle a fund; holders can still mint and redeem
through the shards left, and anyone can add them back by paying seeds.

## Price feed

One PriceFeed per instance, shared by every fund, fixed for the instance's life. It holds
the feed **state NFT** (mutable, `price` category):

```
0x01 · timestamp (4) · price (8) · sourcesHash (32) · [pending]
pending: sourcesHash (32) · since (4)
```

| Field | Meaning |
| --- | --- |
| `timestamp` | Price time: the oldest source message's timestamp. Strictly increases |
| `price` | USD cents per BCH |
| `sourcesHash` | `hash256(pubkey₀ · pubkey₁ · …)`: the source oracles' 33-byte public keys |
| `pending` | A proposed source set, absent when none; `since` = `timestamp` when proposed |

The state NFT never leaves the PriceFeed, so shards trust the `price` category: a
mutable `price` NFT is the feed. Shards read `0x01 · timestamp · price` from it.

### Sources: oracles.cash messages

A General Protocols price oracle signs 16-byte messages:

```
messageTimestamp (4) · messageSequence (4) · priceSequence (4) · price (4)
```

All signed 32-bit little-endian (`priceSequence > 0` marks a price message; negative values
are metadata). The signature is Schnorr over `sha256(message)`, which is exactly what
`checkDataSig(sig, message, pubkey)` verifies. For the USD oracle `price` is USD cents per
BCH (to confirm against the oracle's metadata before deployment).

Every source must sign this format in this unit: the feed contract is fixed, so a source
with another format can't be added. Upgrades change which oracles sign, not how they're read.

### Update (anyone)

`update(sources, messages, signatures)`, with `K = sources.length / 33` and 1 ≤ `K` ≤ 3:

- `hash256(sources) == sourcesHash`: every configured source, in order.
- For each `k`: `checkDataSig(sig_k, msg_k, pubkey_k)`, `msg_k` is 16 bytes,
  `priceSequence_k > 0`, `price_k > 0`.
- Message timestamps lie within `maxSkew` seconds of each other. One fresh message can't
  be paired with a stale one.
- `timestamp' = min(messageTimestamp_k) > timestamp`.
- **Agreement**: `(max price − min price) · 10000 ≤ maxSpreadBps · min price`.
- `price'` = the median (`K` = 1 or 3) or the mean (`K` = 2) of the prices.
- The state NFT returns to itself with only `timestamp` and `price` changed.

### Aggregation and halting

If the sources disagree by more than `maxSpreadBps`, or any configured source has no
message, `update()` fails. Rebalancing requires an update in the same transaction, so
**rebalancing halts** until the sources agree again or the maintainer replaces one.
**Mint, redeem and resizing keep working**, since they use no price (D1). Holders can
always exit.

### Source upgrades (authorization `0x0200`, timelocked)

- `propose(sources)`: sets `pending` to `hash256(sources)` with `since = timestamp`;
  `sources` is 1 to 3 public keys. Needs `0x0200`.
- `cancel()`: clears `pending`. Needs `0x0200`.
- `activate()`, anyone, once **either** `timestamp ≥ since + upgradeDelay` (oracle time
  has moved on), **or** the state UTXO is at least `upgradeDelayBlocks` old (`this.age`,
  so a feed whose oracles went silent can still be repaired). Replaces `sourcesHash` and
  clears `pending`.

The script can't read the clock, and a transaction's locktime only bounds time from below.
So the delay is measured in oracle time, with block age as the fallback; a proposer can't
backdate either. While a change is pending it's public on-chain, and holders who distrust
it can redeem in kind before it activates.

PriceFeed parameters (instance-level): `price`, `authorization`, `maxSpreadBps`,
`maxSkew`, `upgradeDelay` (seconds), `upgradeDelayBlocks`.

### Residual oracle risk

BCH script can't bound a price's age from above. A rebalancer may submit any signed
message newer than the last posted one, so with no other updates it can pick, within that
window, the message that suits it best. Mitigations:

- Rebalances need the weight outside the band at the chosen price, and are sized to the
  target at that price, so stale-price gains are bounded by the trade (≈ the band).
- Competing rebalancers act as soon as the band is crossed, and any keeper can post newer
  prices cheaply, which closes the window. The maintainer should run a keeper.
- Every configured source must sign a message within `maxSkew` of the others.

## Contracts

### Per fund

| Contract | Parameters (declaration order) | Functions |
| --- | --- | --- |
| ShardManager | execute fee hash, `price`, `authorization`, ReserveVault locking bytecode, `fundCategory`, `fundHash` | `mint(fund, padding)`, `redeem(fund, padding)`, `rebalance(fund, padding)`, `grow(fund, padding)`, `shrink(fund, padding)` |
| ReserveVault | `fundCategory` | `release()`: `in[a−1]` is a shard (`fundCategory + 0x01`) paired with this UTXO by outpoint, and `out[a]` returns to this vault |

The ShardManager checks everything about the reserve's output (category `usdCategory` or
tokenless when it holds no USD, ReserveVault address, amount, dust value unchanged). The
ReserveVault only proves it moves with its shard.

### Per instance

| Contract | Source | Change from token-basket v1 |
| --- | --- | --- |
| FundStartup | new | Validates the definition, genesis, shards and reserves (below) |
| PublicFund | adapted | Publishes the definition to the PublicFundVault and the identity to the AuthHeadVault. No supply minting (the shards hold it), no thread minting |
| PriceFeed | new | [Price feed](#price-feed) |
| FeeManager, FeeMinter, SimpleVault, SimpleMinter, AuthHeadVault, PublicFundVault, InstanceVault, `lib/authority.cash` | copied | Unchanged |

No inflow/outflow thread categories and no FundInflowMint, FundOutflowMint, FundManager or
AssetManager: shards are fund-category NFTs and hold the supply themselves.

**FundStartup `start(fund, padding)`** checks:

- `in[0]` spends output 0 of `fundCategory`'s transaction (this is the genesis, so no fund
  token existed before).
- Every [definition rule](#fund-definition).
- The opening active count `n` (from shard 0's state) is 1 … `maxShards`.
- For each `k < maxShards`: `out[s + 4 + 2k]` is at the ShardManager address and carries
  `fundCategory + 0x01` and `(2⁶³−1) / maxShards` fund tokens; `out[s + 5 + 2k]` is at the
  ReserveVault. Pairing holds because both are outputs of this transaction at adjacent indices.
  - Active (`k < n`): state `0x01 · k · n · lockedUnits · 0`, `lockedUnits · unitSats`
    sats, reserve holding `lockedUnits · unitUsd` of `usdCategory` (tokenless if 0).
  - Parked (`k ≥ n`): state `0x01 · k · n · 0 · 0`, dust only, tokenless reserve.
- No other output carries a `fundCategory` token (no minting NFT, no stray supply).
- The create FeeManager at `s + 1` is paid.

## Transaction layouts

The library uses `s = 1`, and places `a` and `b` itself. It adds the contract side when the
builder has equal input and output counts.

**Creation**

| Index | Input | Output |
| --- | --- | --- |
| 0 | Genesis (outpoint index 0, tokenless) | Identity to AuthHeadVault |
| `s` | FundStartup `start` | Returned |
| `s + 1` | Create FeeManager `pay` | Returned |
| `s + 2` | PublicFund (`publicFund + 0x02`) `broadcast` | Fee payment |
| `s + 3` | Funder (BCH, USD for the seeds) | PublicFund returned |
| `s + 4 + 2k` | | Shard `k` (`k < maxShards`) |
| `s + 5 + 2k` | | Reserve `k` |
| after | | Definition chunks to PublicFundVault, then change |

### Mint and redeem

`m` shards chained to one fee (`m ≥ 1`, any active shards, any order):

| Index | Input | Output |
| --- | --- | --- |
| `a + 2i` | Shard `mint` / `redeem` | Shard |
| `a + 2i + 1` | Reserve `release` | Reserve |
| `a + 2m` | Execute FeeManager `pay` | Returned |
| `a + 2m + 1` | User | Fee payment |

**Rebalance**

| Index | Input | Output |
| --- | --- | --- |
| 0 | PriceFeed `update` | PriceFeed (new price) |
| `b + 2j` | Shard `j` `rebalance` (`j < count`) | Shard `j` |
| `b + 2j + 1` | Reserve `j` `release` | Reserve `j` |
| after | Rebalancer (USD or BCH for the trade) | Rebalancer (BCH or USD out) |

Several funds can rebalance on one price update, each at its own `b`.

**Resize**

| Index | Input | Output |
| --- | --- | --- |
| `b + 2j` | Shard `j` `grow` / `shrink` (`j ≤ count` to add, `j < count` to remove) | Shard `j` |
| `b + 2j + 1` | Reserve `j` `release` | Reserve `j` |
| after | Seed funder (add) or authorization token holder (remove) | Change |

## System parameters

```ts
interface SystemParameters {
    publicFund: string;
    authorization: string;
    price: {
        category: string;
        maxSpreadBps: number;      // e.g. 200 (2%)
        maxSkew: number;           // seconds, e.g. 300
        upgradeDelay: number;      // seconds of oracle time, e.g. 7 days
        upgradeDelayBlocks: number;// fallback, e.g. 1008 (~7 days)
    };
    fees: { create: { nft: string; value: bigint }; execute: { nft: string; value: bigint } };
}
```

Authorization permissions: token-basket v1's `0x0001` … `0x0100` unchanged (`0x0001`
now only mints public fund minting NFTs, as there are no thread categories), plus:

| Bit | Contract | Permission |
| --- | --- | --- |
| 0x0200 | PriceFeed | Propose and cancel a source change |
| 0x0400 | ShardManager | Remove a shard |
| 0xF800 | | Reserved |

## Security notes

| Threat | Defence |
| --- | --- |
| Arbitrage between shards | The sync rule: identical baskets, all-shard rebalances and resizes, exact in-kind amounts |
| Draining by repeated rebalances | Band trigger, contract-sized trades, monotonic prices; see [drain bounds](#reward-and-drain-bounds) |
| Malicious price | Every source must agree within `maxSpreadBps`; source changes timelocked and public; the feed contract is fixed; mint and redeem use no price |
| Stale price cherry-picking | Bounded by trade size; keepers and competing rebalancers ([residual risk](#residual-oracle-risk)) |
| Reserve swapped between shards | Outpoint pairing |
| Forged shard or inflated supply | Every shard NFT is made at genesis, with no minting NFT and a fixed supply, checked by FundStartup |
| Shard spam | Each added shard costs a permanent seed; `maxShards` bounds the total; removal needs a permission |
| Removal as theft | A merge keeps every unit and every satoshi of reserve in the fund |
| Shard emptied, basket undefined | `lockedUnits` on every active shard |
| Donations skewing a basket | Shard and reserve UTXOs only change through their contracts; sats on the reserve are pinned |
| Rebalance mixed with mint, redeem or resize | One function per shard input; every shard checks every other's `epoch` (rebalance) or `count` (resize) |
| Skipping the fee on a multi-shard operation | Each shard checks the next input is another shard or the fee; the chain must end at a fee |

## Limits

To be measured once the contracts compile. A rebalance or resize spends two inputs per
active shard (plus the feed for a rebalance), and each ShardManager input carries the
111-byte definition. The `maxShards ≤ 16` cap is provisional, chosen so a full rebalance
fits the 100,000-byte standard limit. Mint and redeem cost the same per shard whatever the
fund's size. Each parked shard costs its creator two dust UTXOs at genesis.

## Decisions taken

| Question | Decision |
| --- | --- |
| Mint and redeem | In kind, with BCH and USD, less a fixed execute fee |
| The band | Absolute weight points: `5000 ± 500` is 45%–55% |
| Shard count | Adjustable after creation, up to `maxShards` set at genesis; anyone adds (paying the seed), the steward removes |
| Upgrades | Oracle sources only, timelocked; the price contract is fixed |
| Rebalance fee | None |

## Open questions

1. **Upgrade delay values**: e.g. 7 days of oracle time, 1008 blocks as the fallback.
2. **`maxShards` cap**: 16 is provisional until a full rebalance is measured.
3. **Deployment facts to confirm**: the PUSD category and decimals; the oracles.cash USD
   oracle public key and price unit.

## Implementation plan

1. PriceFeed and its tests (oracle messages signed in tests with libauth's Schnorr).
2. ShardManager and ReserveVault: mint, redeem, the fee chain, rebalance math (property
   tests against the formulas above), resizing, the sync rule.
3. FundStartup, PublicFund, copied system contracts; creation tests and audit-style
   rejection tests (paired with accepted controls).
4. Builders: definition encoding and validation, contract derivation, creation, mint and
   redeem, rebalance, resize, price posting, oracles.cash client.
5. Measure limits; split this document into the standard agent docs; human docs.
