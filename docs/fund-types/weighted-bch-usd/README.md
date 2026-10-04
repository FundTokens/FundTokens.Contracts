# Weighted BCH/USD

**In design.** A fund holding BCH and a USD-pegged token (e.g. ParityUSD) at a target
weight, rebalanced back to the target when it drifts too far. A simple asset-based ETF.

Example: 50% BCH / 50% PUSD, rebalanced when BCH is above 55% or below 45% of the fund's
value. The weight, the band, the rebalance reward, the USD token and the most threads the
fund can use are all set per fund.

## How it works

- **Mint and redeem in kind.** A fund token is a share of the fund's BCH and USD. Minting
  deposits the current mix of both; redeeming returns it. Each mint or redemption
  transaction pays a fixed fee, like an ETF's creation and redemption fee. No price is
  involved, so minting and redeeming always work, even when prices are unavailable.
- **Threads (shards).** The fund is split into shards. Each holds its own share of the
  reserves and serves one user at a time, so more shards serve more users at once. Every
  shard always holds the same mix per fund token. Anyone can add a shard, up to the fund's
  limit, by paying a small seed that stays in the fund; the steward can remove one, merging
  its holdings into another shard.
- **Rebalancing.** When the weight leaves the band, anyone can rebalance: they trade with
  the fund at the oracle price, with a small discount as their reward (default 0.35%,
  configurable). The contracts size the trade to land exactly on the target, and every
  shard rebalances in the same transaction, which keeps the shards in sync. Rebalances pay
  no protocol fee.
- **Prices.** A shared price contract checks signed prices from one or more oracles
  (oracles.cash first). If they disagree by too much, rebalancing halts until they agree.
  The price contract is fixed; the steward can change which oracles it uses, but only after
  a public delay, so holders can see a change coming and redeem first.
- **Fees.** The same create and execute fees as token basket.
- **Wallets.** Fund tokens are ordinary CashTokens, named and sized by the fund's BCMR
  metadata. Each shard's state is a small NFT the fund's contracts hold. Its BCMR
  description lets explorers and indexers show what each shard did last (mint, redeem,
  rebalance, grow or shrink) and its BCH reserve.

| | |
| --- | --- |
| Library key / registry type | `weighted-bch-usd` / `weighted-bch-usd` |
| Library namespace | `WeightedBchUsd` (`@fundtokens/builders/weighted-bch-usd`) |

## Versions

| Version | Status | Docs |
| --- | --- | --- |
| v1 | in design: the builders and `createInstance` throw `NOT_IMPLEMENTED`; `FundTypeResolver.supports()` returns false | [Design](../../agents/weighted-bch-usd/v1/DESIGN.md) |
