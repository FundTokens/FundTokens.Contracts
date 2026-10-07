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
| PublicFund `broadcast()` | 81 assets | Fixed budget of 559,200 (its unlocking bytecode does not grow with the fund); about 6,000 per asset, in steps as each 128-byte data chunk is added. 81 assets uses 545,636; 82 runs out |
| TransactionManager `outflow()` | depends on custody fragmentation | The fund argument adds 32,000 of budget per asset. Releasing one custody UTXO per asset costs 27,000 to 30,000 per asset (rising slowly with fund size), and each further custody UTXO about 4,400 (token) or 3,300 (BCH). One or two per asset fits at every fund size the protocol accepts; heavily fragmented custody of a fund with few reserves can need padding ([below](#custody-fragmentation)) |
| TransactionManager `inflow()` | never runs out | 73.5% of its budget at 189 assets |
| FundStartup `start()` | 144 assets | About 60,000 per asset, 32,000 of budget per asset from the fund argument. 189 assets at most (fund encoding + padding fill its unlocking bytecode) |

## Custody fragmentation

Every deposit leaves one custody UTXO per reserve, and a redemption releases custody UTXOs
largest first, so a redemption can release several UTXOs of every reserve. Each released
custody UTXO costs the TransactionManager about 4,400 of operation cost (token reserve) or
3,300 (BCH) and the transaction about 330 to 370 bytes, while the TransactionManager's budget
grows only with the fund's asset count. Which limit is reached first:

| Redemption | Largest measured standard | TransactionManager | Padding |
| --- | --- | --- | --- |
| 4 custody UTXOs per reserve | 60 assets: 252 inputs, 99,139 bytes | 2,457,764 of 3,179,200 | none |
| 5 per reserve | 45 assets: 239 inputs, 92,486 bytes | 2,020,855 of 2,699,200 | none |
| 6 per reserve | 40 assets: 256 inputs, 97,905 bytes | 1,974,037 of 2,539,200 | none |
| BCH only, many custody UTXOs | 270 custody UTXOs, 92,453 bytes | 999,786 of 1,257,600 | none |
| BCH and one token, many per reserve | 120 per reserve, 86,833 bytes | 1,049,756 of 1,290,400 | none |
| **One token, many custody UTXOs** | 280 custody UTXOs, 95,893 bytes | runs out past about 264 | **88 bytes at 280** |

So padding is needed only when a fund with few reserves (in practice, a single token reserve)
redeems more than about 264 custody UTXOs at once: its budget runs out while the transaction
is still standard (about 290 custody UTXOs fit in 100,000 bytes). With several reserves, or
BCH, the standard size is reached first. `addOutflow` does not add padding by itself: pass
`padding` (a few hundred bytes covers any standard redemption of such a fund), or redeem
fewer units, which releases fewer custody UTXOs.

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
- `tests/stress.custodyUtxos.test.ts`: redemptions releasing 4 to 6 custody UTXOs per
  reserve, and the single-token fund that needs padding (logs sizes, costs and the padding).
- `tests/stress.test.ts`, `tests/stress.custodyUtxos.test.ts`, `tests/audit.vmDensity.test.ts`,
  `tests/audit.chunkSize.test.ts`: long-running (skipped unless `yarn test:all` or named in a
  filter).
- `operationCost(tx, inputIndex)` in `test-utils/consensus.ts`: an input's cost and budget,
  evaluated with libauth (much faster than cashscript's `getVmResourceUsage()` on large
  transactions).
- `yarn metrics`: each contract function's estimated operation cost.
- To find a function's limit, grow the asset count until `toBeRejected()` reports an
  operation cost failure, then add padding until it is accepted.
