# Fixed Basket v1: Limits

Compute, size and standardness limits that bound v1 funds, with the numbers measured by
the test suite. Re-measure after any contract change (see [Measuring](#measuring)).

## Rules that apply

| Limit | Value | Source |
| --- | --- | --- |
| Operation cost budget per input | (41 + unlocking bytecode length) × 800 | BCH 2025 VM limits |
| Unlocking bytecode | 10,000 bytes (standard) | Relay policy |
| Stack item | 10,000 bytes | Consensus |
| Transaction size | 100,000 bytes (standard) | Relay policy; `MaxStandardTransactionSize` in `core/constants.ts` |
| NFT commitment | 128 bytes | Consensus |

An input's budget depends only on its own unlocking bytecode. Other inputs, NFT commitments
and outputs do not change it.

## Padding

FundStartup `start()`, PublicFund `broadcast()` and TransactionManager `inflow()` /
`outflow()` take an ignored `bytes padding` argument. Each padding byte adds 800 to that
input's budget, for about 1 satoshi of fee at 1 sat/byte. Padding must be an argument: an
unlocking bytecode must be push-only and minimally encoded, and a P2SH script must leave a
clean stack.

Library: `padding` on `addBroadcast` (PublicFund), `addInflow` and `addOutflow`
(TransactionManager); `startupPadding` on `addBroadcast` (FundStartup). `getPadding(bytes)`
builds it; `MaxPaddingBytes` is 10,000.

In FundStartup and the TransactionManager, the fund encoding, padding and the contract's
redeem script share the 10,000-byte unlocking bytecode limit.

## Largest fund per function

| Function | Without padding | Notes |
| --- | --- | --- |
| PublicFund `broadcast()` | 78 assets | Fixed budget of about 563,000; about 6,000 per asset. 80 assets with `padding: 100` uses 569,220 of 644,000 |
| TransactionManager `outflow()` | never runs out (up to 189 assets) | The fund argument adds 32,000 of budget per asset. Releasing one custody UTXO per asset costs about 29,300 per asset, so it always fits. Releasing two costs about 37,450 per asset: measured at 3, 20 and 40 assets, the fixed headroom runs out only near 227 assets, past the 189 FundStartup accepts. More custody UTXOs per asset can need padding, but at 100 assets three per asset already exceeds the standard size |
| TransactionManager `inflow()` | never runs out | 73.5% of its budget at 189 assets |
| FundStartup `start()` | 144 assets | About 60,000 per asset, 32,000 of budget per asset from the fund argument. 189 assets at most (fund encoding + padding fill its unlocking bytecode) |

## Fund size cap

**The protocol has no limit on a fund's asset count.** The contracts accept any fund that
fits in FundStartup's unlocking bytecode: up to 189 assets, created by anyone (with the
library's `validate: false`, or without the library). Every redemption releases every asset,
so a fund of more than 100 assets accepts deposits it cannot redeem in a standard
(100,000-byte) transaction. Its holders can only redeem through a miner willing to include a
non-standard transaction.

Clients are expected to act reasonably and not create or deposit into such funds. The
library does this: it refuses funds of more than `MaxFundAssets` = 100 assets (`validateFund`,
`INVALID_ARGUMENT`) when creating, minting and redeeming. Wallets, registries and other
clients should apply the same cap, or one measured for their own transactions, before
listing a fund or offering deposits.

At 100 assets:

- redeeming two custody UTXOs of every asset into one output per asset needs no padding and
  takes 96,194 bytes (209 inputs, 207 outputs)
- paying each asset out in two outputs exceeds the limit

`addOutflow` (with validation on) estimates the transaction with the fewest caller inputs
and outputs possible (one P2PKH input; one P2PKH output per released asset, plus BCH). If it
cannot fit, it throws `TRANSACTION_TOO_LARGE`, naming the most units that fit
("redeem at most N unit(s) per transaction"). Fewer units release fewer custody UTXOs,
because custody is spent largest first.

## Measured sizes

| Transaction | BCH + 3 assets | BCH + 38 assets |
| --- | --- | --- |
| Create fund | 6,202 bytes | 9,838 bytes |
| Mint (inflow) | 3,731 bytes | 15,281 bytes |
| Redeem (outflow) | 4,613 bytes | 21,413 bytes |

## Measuring

- `tests/stress.moreCompute.test.ts`: the 100-asset fund, broadcast with and without
  padding, multi-UTXO deposits and redemptions, the `TRANSACTION_TOO_LARGE` refusal.
- `tests/stress.test.ts`, `tests/audit.vmDensity.test.ts`, `tests/audit.chunkSize.test.ts`:
  long-running (skipped unless `yarn test:all` or named in a filter).
- `yarn metrics`: each contract function's estimated operation cost.
- To find a function's limit, grow the asset count until `toBeRejected()` reports an
  operation cost failure, then add padding until it is accepted.
