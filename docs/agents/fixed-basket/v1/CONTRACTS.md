# Fixed Basket v1: Contract Rules

Every contract and function in `fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts/`,
with every check it makes. Notation is in the [agent README](../../README.md#notation).
Transaction layouts are in [TRANSACTIONS.md](TRANSACTIONS.md), byte layouts in
[ENCODINGS.md](ENCODINGS.md).

## Cross-cutting rules

**Authorization (`hasAuthority`)**. [lib/authority.cash](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts/lib/authority.cash)
is imported by SimpleMinter, FeeMinter, SimpleVault, AuthHeadVault, InstanceVault,
PublicFundVault and FeeManager. `hasAuthority(authorization, permission)` is true when some
input:

- has `tokenCategory == authorization` exactly (an immutable NFT; a mutable or minting
  authorization NFT never counts), and
- is not locked by the calling input's locking bytecode (neither the caller nor another UTXO
  at the same address counts), and
- has `commitment[1..3] & permission == permission`.

The commitment's type byte is not checked. A commitment shorter than 3 bytes fails the
script (fail closed). Permission bits are in [ENCODINGS.md](ENCODINGS.md#authorization-token).

**Fungible tokens on NFTs**. A minting NFT in the transaction can add fungible tokens of its
category to any output. So every NFT a contract returns to itself keeps its fungible token
amount, and every NFT a contract mints must carry amount 0.

**Return checks never cover satoshi value**. A returned contract UTXO may come back with a
different value (standardness still requires dust). This is by design: the satoshis on
threads, minting NFTs, fee UTXOs, the FundManager supply and other returned UTXOs are
operational dust, not custody, and whoever spends one may recreate it at the dust minimum
(the builders always do) and keep any excess. BCH backing is custody, and is accounted
exactly by the TransactionManager (BCH custody outputs and change). Don't fund contract
UTXOs above dust.

**Function ordering in the artifact**. CashScript selects functions by index in declaration
order. The unlocker names below are the function names.

---

## System contracts

Deployed once per instance. SimpleMinter, FeeMinter and InstanceVault are maintenance
contracts not derived by the library; the others come from `deriveSystemContracts`
([contracts.ts](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts.ts)).

### SimpleMinter

`SimpleMinter(bytes32 authorization, bytes32 token, bytes destination)`. Holds a
`token + 0x02` minting NFT of type 0x00 (a serial counter) and mints type-0x01 minting NFTs
of `token` to `destination`. Used to seed the inflow, outflow and public fund minting threads.

`mint()`:

- `hasAuthority(authorization, 0x0001)`
- `in[a].commitment = 0x00 · serial` (serial is a VM number)
- Every output `i != a` whose category starts with `token`:
  - `lockingBytecode == destination`
  - `tokenCategory == in[a].tokenCategory` (`token + 0x02`: minted NFTs are minting NFTs)
  - `tokenAmount == 0`
  - `commitment == 0x01 · (serial + k)`, `k` counting minted outputs in output order from 0
- `out[a].commitment == 0x00 · (serial + minted count)`
- `out[a]` has the same locking bytecode, category `token + 0x02` and fungible amount as `in[a]`

### FeeMinter

`FeeMinter(bytes32 authorization, bytes32 token, bytes next)`. Holds a fee-category minting
NFT and mints fee NFTs to `next` (the FeeManager for that fee).

`mint()`:

- `hasAuthority(authorization, 0x0010)`
- Every output `i != a` whose category starts with `token`:
  - `lockingBytecode == next`, `tokenCategory == token` (immutable), `tokenAmount == 0`
  - commitment type is 0x01 or 0x02 (never 0x00):
    - 0x01: the 32-byte fee category is present, and the 8-byte amount (VM number) is > 0. A
      trailing destination is optional and not checked
    - 0x02: nothing follows the type byte
- `in[a].tokenCategory == token + 0x02` and `out[a]` returns to itself (category, locking
  bytecode, commitment, fungible amount)

### SimpleVault

`SimpleVault(bytes32 authToken)`. Gated custody; the library uses one as the fee vault (fee
payments' default destination).

- `release()`: `hasAuthority(authToken, 0x0002)`. Nothing else is checked: outputs are free.
- `verify()`: `in[a - 1].lockingBytecode == in[a].lockingBytecode`. One `release()` can
  authorize a run of vault UTXOs that follow it.

### AuthHeadVault

`AuthHeadVault(bytes32 authToken)`. Holds each public fund's identity (authhead) output,
which fund creation sends here as output 0.

- `update()`: `hasAuthority(authToken, 0x0004)`; `a == 0`; `out[0]` has `in[0]`'s locking
  bytecode and no token. One identity per transaction.
- `burn()`: `hasAuthority(authToken, 0x0008)`; `out[0]` is an OP_RETURN (`0x6a…`) with no
  token. Several identities may be burned in one transaction.

### InstanceVault

`InstanceVault(bytes32 instance, bytes32 authorization)`. Holds the instance NFT pair: a
mutable proof NFT (`instance + 0x01`) and an immutable data NFT (`instance`), created in one
transaction. Layout in [ENCODINGS.md](ENCODINGS.md#instance-nfts).

`update()` changes the lifecycle state:

- `in.length >= a + 2`; `in[a].tokenCategory == instance + 0x01`
- `hasAuthority(authorization, 0x0040)`
- input state `!= 0x08`: **vulnerable is terminal** (`'A vulnerable instance cannot change state'`)
- output type byte == input type byte; output state ∈ {0x01, 0x02, 0x04, 0x08}; everything
  after the state byte (version, hash, data) unchanged
- data NFT at `a + 1`: same locking bytecode as `in[a]`; returned at `out[a + 1]` with the
  same locking bytecode, category, commitment and fungible amount
- `hash256(data in proof NFT ‖ data NFT commitment) == hash`
- `out[a]`: same locking bytecode, category and fungible amount as `in[a]`

`burn()`:

- `in[a].tokenCategory == instance + 0x01`
- state ∈ {0x04 deprecated, 0x08 vulnerable} (`'Only a deprecated or vulnerable instance can be burned'`)
- data NFT at `a + 1` has `in[a]`'s locking bytecode; the hash verifies
- no output has a category starting with `instance`
- `hasAuthority(authorization, 0x0080)`

`proof()`: `in.length >= a + 2`, `in[a].tokenCategory == instance + 0x01`, the same data NFT
and hash checks as `update()`, and `out[a]` returns `in[a]` unchanged, commitment included.
No authorization and no state check: a vulnerable instance can still be proven.

`data()`: `in[a].tokenCategory == instance`; `in[a - 1]` has the same locking bytecode and
the same outpoint transaction hash.

### PublicFundVault

`PublicFundVault(bytes32 publicFund, bytes32 authorization)`. Holds each public fund's data
chunks: immutable `publicFund` NFTs whose commitments concatenate to the fund commitment
([ENCODINGS.md](ENCODINGS.md#fund-commitment)).

`proof()`:

- `in[a].tokenCategory == publicFund`
- for each consecutive input `i = a, a + 1, …` with category `publicFund`: `out[i]` has the
  same locking bytecode, category, commitment and fungible amount
- the concatenated commitments are `0x02 · hash · fund` with `hash256(fund) == hash`
- `publicFund` inputs elsewhere in the transaction are not checked

`data()`: `in[a].tokenCategory == publicFund`; `in[a - 1]` has the same locking bytecode,
category and outpoint transaction hash.

`burn()` (delist):

- `in[a].tokenCategory == publicFund`
- `hasAuthority(authorization, 0x0100)`
- no output carries the `publicFund` category, whatever its capability (the first 32 bytes
  of each token-bearing output's category are compared)
- the consecutive `publicFund` inputs from `a` concatenate to a valid fund commitment

---

## Fund creation contracts

### FundStartup

`FundStartup(bytes32 fee, bytes32 inflowToken, bytes32 outflowToken)`. `fee` is the hash of
the **create** FeeManager. Holds tokenless UTXOs. Runs once per fund creation, and again for
every additional pair of threads.

`start(bytes fund, bytes padding)`: `fund` is the fund encoding
([ENCODINGS.md](ENCODINGS.md#fund-encoding)); `padding` is ignored (buys compute, see
[LIMITS.md](LIMITS.md)).

- `out[s + 5]` (category `inflowToken`) and `out[s + 6]` (category `outflowToken`) carry
  commitment `0x02 · fundCategory · hash256(fund)`
- fund amount (8 bytes) > 0
- with assets: satoshis (7 bytes) in [0, 2,100,000,000,000,000]; without: in [1, 2,100,000,000,000,000]
- each asset amount > 0; asset categories strictly ascending (compared as little-endian
  integers of the internal-order bytes, which is ascending order of the displayed hex)
- `in[s + 1].tokenCategory == inflowToken + 0x02`; `in[s + 2].tokenCategory == outflowToken + 0x02`
- `in[s + 3]` is locked by `P2SH32(fee)` and `out[s + 3]` has the same locking bytecode
  (the fee returned, so it ran `pay()`)
- outside outputs `s … s + 6`, no output has a category starting with `inflowToken` or `outflowToken`
- no input has category exactly `inflowToken` or `outflowToken` (no live thread is spent)
- `in[s]` is tokenless and `out[s]` returns to the same locking bytecode, tokenless

Not checked here: that asset categories differ from BCH (all zeros) or from the fund's own
category. The library rejects both (`validateFund`).

### FundInflowMint and FundOutflowMint

`FundInflowMint(bytes32 startupContract, bytes32 inflowToken, bytes32 outflowToken, bytes32 fee, bytes managerContract, bytes fundContract, bytes assetContract)`,
and FundOutflowMint with the same parameters. `startupContract` is the FundStartup hash, `fee`
the **execute** FeeManager hash, and the three `bytes` are contract templates (bytecode
without parameters). Each holds a type-0x01 minting NFT and mints one thread per call to the
fund's TransactionManager.

FundInflowMint `mint()`, run at `s + 1`:

- `in[a - 1]` is locked by `P2SH32(startupContract)`
- `in[a + 1].tokenCategory == outflowToken + 0x02`
- `in[a].tokenCategory == inflowToken + 0x02`; `out[a]` returns to itself
- `out[a + 4]` (= `s + 5`): commitment `0x02 · fundCategory · fundHash`, category `inflowToken`,
  amount 0, locked by the TransactionManager derived from the commitment
  ([TRANSACTIONS.md](TRANSACTIONS.md#contract-addresses))

FundOutflowMint `mint()`, run at `s + 2`: the same, with `in[a - 2]` the startup,
`in[a - 1].tokenCategory == inflowToken + 0x02`, and the outflow thread at `out[a + 4]`
(= `s + 6`). **Both threads go to the TransactionManager**, not to the FundManager.

The templates for the derived address are read from the mint contract's own
`activeBytecode`, so the TransactionManager is bound to the same templates.

### PublicFund

`PublicFund(bytes authHeadDestination, bytes publicFundDestination, bytes32 token, bytes32 startupContract, bytes fundContract, bytes32 inflowToken, bytes32 outflowToken)`.
`token` is the public fund category. Holds a type-0x01 `token + 0x02` minting NFT.

`broadcast(bytes padding)`, run at `p = s + 4`. `padding` is ignored.

- `in[0].outpointIndex == 0` and `in[0]` is tokenless (the genesis input; its outpoint
  transaction hash becomes the fund category)
- `out[0]` is locked by `authHeadDestination`, tokenless
- `in[p - 4]` is locked by `P2SH32(startupContract)`
- data chunks: outputs from `p + 5` while their category is exactly `token`:
  - locked by `publicFundDestination`, amount 0
  - every chunk but the last has the first chunk's length; the last may be shorter
  - concatenated: `0x02 · fundHash · fund` with `hash256(fund) == fundHash`
- the fund's category (`fund[0..32]`) == `in[0].outpointTransactionHash`
- `out[p + 1]` and `out[p + 2]` commitments == `0x02 · fundCategory · fundHash`
- `out[p + 3]` is the FundManager bound to the TransactionManager at `out[p + 1]`'s locking
  bytecode, holds the fund category with amount exactly 2⁶³−1 (the whole supply)
- outside outputs `0` and `s … end of chunks`, no output has a category starting with the
  fund category or `token`
- `in[p].tokenCategory == token + 0x02`; `out[p + 4]` returns `in[p]` (locking bytecode,
  category, commitment, fungible amount)

PublicFund checks the fund only through its hash and category. FundStartup, at `s`, checks
its contents.

---

## Per-fund contracts

Each fund has one TransactionManager, one FundManager and one AssetManager per reserve
(BCH first if the fund holds BCH, then each asset in ascending category order). Their
addresses are derived from the fund, see [TRANSACTIONS.md](TRANSACTIONS.md#contract-addresses).

### TransactionManager

`TransactionManager(bytes32 fee, bytes32 inflowToken, bytes32 outflowToken, bytes32 fundCategory, bytes32 fundHash, bytes fundContract, bytes assetContract)`.
`fee` is the execute FeeManager hash. Holds the fund's inflow and outflow threads.

`inflow(bytes fund, bytes padding)`, minting:

- `hash256(fund) == fundHash`; `fund[0..32] == fundCategory`
- `in[a]`: category `inflowToken`, commitment `0x02 · fundCategory · fundHash`
- `in[a + 1]` is locked by `P2SH32(fee)` and `out[a + 1]` has the same locking bytecode
  (`'Fee must not close'`)
- FundManager inputs: the run from `a + 2` locked by the FundManager; each tokenless or
  holding `fundCategory`
- FundManager outputs: the run from `a + 3` locked by the FundManager; each tokenless or
  holding `fundCategory`
- released = inputs − outputs; `released % fundAmount == 0`; `units = released / fundAmount > 0`
- custody outputs start right after the FundManager outputs, one per reserve:
  - BCH (if satoshis > 0): the BCH AssetManager, value exactly `units × satoshis`, tokenless
  - each asset in order: its AssetManager, category exactly the asset's, amount exactly
    `units × amount`
- `out[a]` returns `in[a]`

`outflow(bytes fund, bytes padding)`, redeeming:

- the same fund, thread (`outflowToken`) and fee checks
- FundManager inputs: the run from `a + 2` (zero or more), each tokenless or holding
  `fundCategory`; FundManager outputs: the run from `a + 3` (at least one), each holding
  `fundCategory`
- collected = outputs − inputs; `collected % fundAmount == 0`; `units = collected / fundAmount > 0`
- reserve inputs start right after the FundManager inputs, one contiguous run per reserve in
  reserve order (at least one UTXO each):
  - BCH: tokenless UTXOs of the BCH AssetManager
  - assets: UTXOs of that asset's AssetManager holding exactly its category
- change outputs start right after the FundManager outputs, in the same reserve order, zero
  or more per reserve. BCH change: the run of outputs locked by the BCH AssetManager, each
  required tokenless (token-bearing BCH custody could never be released). Asset change: the
  run of outputs locked by that asset's AssetManager, each required to hold exactly its
  category (custody in another category could never be released)
- any of these runs may end the transaction
- per reserve: inputs − change == `units × satoshis` (BCH) or `units × amount` (asset)
- `out[a]` returns `in[a]`

`padding` is ignored by both functions.

### FundManager

`FundManager(bytes32 inflowToken, bytes32 outflowToken, bytes fundCategory, bytes fundHash, bytes transactionManager)`.
Holds the unminted fund token supply. `transactionManager` is the fund's TransactionManager
locking bytecode.

`mint()`:

- the leader: `in[a - 2]` is locked by `transactionManager`, category `inflowToken`, commitment
  `0x02 · fundCategory · fundHash`. Then `out[a + 1]` is locked by this contract and holds the
  fund category or no token
- a follower: `in[a - 1]` is locked by this contract (and holds the fund category, if any token)
- one of the two must hold

`redeem()`: the same with `outflowToken`; the leader's `out[a + 1]` must hold the fund category.

Amounts are the TransactionManager's job.

### AssetManager

`AssetManager(bytes32 outflowToken, bytes32 fundHash, bytes32 assetCategory, bytes transactionManager, bytes linkedAssetManager)`.
Holds one reserve. `assetCategory` is all zeros for BCH. `linkedAssetManager` is the locking
bytecode of the reserve before it in reserve order, empty for the first.

`release()`:

- BCH reserve: `in[a]` tokenless; asset reserve: `in[a].tokenCategory == assetCategory`
- linked if `in[a - 1]` is locked by this contract, or by `linkedAssetManager` (when non-empty)
- otherwise (the first reserve input of the operation), scanning back from `a - 1`:
  - the input with category `outflowToken` must be locked by `transactionManager` with
    commitment bytes `33..65 == fundHash`
  - every input passed on the way is locked by the same contract as the first one passed
    (the FundManager run), except the one right after the thread (the fee)
  - the thread must be found

Amounts are the TransactionManager's job. No inflow function: deposits are plain outputs
to the AssetManager.

### FeeManager

`FeeManager(bytes32 authToken, bytes defaultDestination, bytes32 feeToken, int defaultValue)`.
Two instances per system: create (fund creation and threads) and execute (mint and
redeem). `defaultDestination` is the fee vault's locking bytecode. Holds tokenless UTXOs
(the default fee) and fee NFTs ([ENCODINGS.md](ENCODINGS.md#fee-nfts)).

`pay()`, payment at `out[a + 1]`:

- `out[a]` returns `in[a]` (locking bytecode, category, commitment, fungible amount)
- `in[a]` holds a `feeToken` NFT (category exactly `feeToken`):
  - type must be 0x01 or 0x02
  - 0x01 (enforced): `out[a + 1]` locked by the encoded destination, or `defaultDestination`
    when none is encoded. BCH category (all zeros): value exactly the amount, tokenless.
    Otherwise: category exactly the encoded one, amount exactly the encoded amount
  - 0x02 (voluntary): either `out[a + 1]` is locked by `defaultDestination` and holds a
    32-byte category (fungible tokens or an immutable NFT) or is tokenless with value > 0,
    or it is an OP_RETURN, tokenless, value 0
- otherwise (no fee NFT): `out[a + 1]` locked by `defaultDestination`, value exactly
  `defaultValue`, tokenless

No branch lets the payment carry a minting or mutable NFT. In a fund creation the payment
(`s + 4`) sits inside the FundStartup and PublicFund scan windows, where the genesis input
could otherwise mint a minting NFT of the new fund's category onto it
(`tests/audit.feeSlotMinting.test.ts`).

`close()`:

- no output carries the `feeToken` category, whatever its capability (the first 32 bytes of
  each token-bearing output's category are compared)
- no output is locked by this contract, so a FeeManager input whose output returns to it
  must have run `pay()` (FundStartup and the TransactionManager rely on this)
- `hasAuthority(authToken, 0x0020)`

---

## Contract behaviours to know

Facts about v1 that are easy to miss when changing builders or reviewing:

- **Threads for any fund**. FundStartup, FundInflowMint and FundOutflowMint run without
  PublicFund, so anyone paying the create fee can add an inflow/outflow thread pair for any
  valid fund encoding. Fund creation is the same transaction plus PublicFund. The library has
  no builder for adding threads alone.
- **Startup trusts asset categories**. It does not reject an all-zero (BCH) asset category or
  the fund's own category; `validateFund` does. Neither checks that an asset exists, has
  fungible supply, or isn't a system category.
- **No asset cap**. The protocol accepts funds of any asset count that fits in FundStartup's
  unlocking bytecode (189). Funds over 100 assets can't be redeemed in a standard
  transaction; clients are expected not to create or deposit into them
  ([LIMITS.md](LIMITS.md#fund-size-cap)).
- **Bounded loops**. The TransactionManager's loops over runs of inputs or outputs stop at the
  last one, so a run may end the transaction. CashScript evaluates both sides of `&&`, so they
  read `in[i % length]` / `out[i % length]` (always in range) beside the `i < length` check,
  rather than branching or keeping a flag per element. The exception is `outflow()`'s
  FundManager *input* loop: custody inputs must follow it, so if it reaches the last input the
  redemption fails either way (`tests/audit.outflowBounds.test.ts`, AUD-015).
- **No revocation**. An authorization NFT is valid until burned; there is no revocation list.
- **Custody accepts what is sent**. Anything sent to an AssetManager's address (e.g. an
  immutable NFT of the asset category) is held; only `release()` paths spend it.
