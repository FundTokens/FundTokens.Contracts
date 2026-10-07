# Fixed Basket v1: Transaction Layouts

Input and output positions for every v1 operation. The contracts find each other by index,
so these layouts are part of the protocol. Rules behind each position are in
[CONTRACTS.md](CONTRACTS.md); notation in the [agent README](../../README.md#notation).

The library builders add the contract side when the builder has **equal input and output
counts**, so contract inputs and their returned outputs share indices. The caller adds its
own inputs and outputs before or after, in matching numbers.

## Contract addresses

Every contract is P2SH32: locking bytecode `OP_HASH256 <hash256(redeem script)> OP_EQUAL`.
The redeem script is the constructor arguments pushed in **reverse declaration order**,
then the contract template (the artifact's bytecode). `push32(x)` is `0x20 · x`; a 35-byte
P2SH32 locking bytecode is pushed as `0x23 · x`; an empty push is `0x00`.

### System contracts (`deriveSystemContracts`)

| Contract | Arguments (declaration order) |
| --- | --- |
| Fee vault (SimpleVault) | `authorization` |
| Create / execute FeeManager | `authorization`, fee vault locking bytecode, `fees.create.nft` / `fees.execute.nft`, `fees.create.value` / `fees.execute.value` |
| FundStartup | hash of the create FeeManager, `inflow`, `outflow` |
| FundInflowMint, FundOutflowMint | FundStartup hash, `inflow`, `outflow`, execute FeeManager hash, TransactionManager / FundManager / AssetManager templates |
| AuthHeadVault | `authorization` |
| PublicFundVault | `publicFund`, `authorization` |
| PublicFund | AuthHeadVault and PublicFundVault locking bytecodes, `publicFund`, FundStartup hash, FundManager template, `inflow`, `outflow` |

Categories are passed in internal byte order. SimpleMinter, FeeMinter and InstanceVault
are deployed by the maintainer and not derived by the library.

### Per-fund contracts (`deriveFundContracts`)

| Contract | Redeem script the contracts rebuild |
| --- | --- |
| TransactionManager | `push(assetTemplate) · push(fundTemplate) · push32(fundHash) · push32(fundCategory) · push32(outflow) · push32(inflow) · push32(executeFeeHash) · managerTemplate` |
| FundManager | `0x23 · managerLockingBytecode · push32(fundHash) · push32(fundCategory) · push32(outflow) · push32(inflow) · fundTemplate` |
| AssetManager | `push(linked) · 0x23 · managerLockingBytecode · push32(assetCategory) · push32(fundHash) · push32(outflow) · assetTemplate` |

- FundInflowMint and FundOutflowMint rebuild the TransactionManager script, taking the two
  template pushes from the start of their own `activeBytecode`.
- PublicFund and the TransactionManager rebuild the FundManager script.
- The TransactionManager rebuilds every AssetManager script. Reserves are ordered BCH first
  (category all zeros, only when `satoshis > 0`), then assets by ascending category. The
  first reserve's `linked` is empty (`0x00`); each later one pushes the previous reserve's
  locking bytecode (`0x23 · …`).

---

## Fund creation

`PublicFundTransactionBuilder.addBroadcast`. The genesis input must be input 0 and the
identity output must be output 0, so the library's layout has `s = 1`; `p = s + 4`.

| Index | Input (unlocker) | Output |
| --- | --- | --- |
| 0 | Genesis: outpoint index 0, tokenless; its txid is the fund category (P2PKH) | Identity (authhead) to AuthHeadVault, tokenless |
| `s` | FundStartup UTXO, tokenless: `start(fund, padding)` | FundStartup UTXO returned |
| `s + 1` | Inflow minting NFT (`inflow + 0x02`, type 0x01): FundInflowMint `mint()` | Returned |
| `s + 2` | Outflow minting NFT: FundOutflowMint `mint()` | Returned |
| `s + 3` | Create fee UTXO: FeeManager `pay()` | Returned |
| `s + 4` = `p` | Public fund minting NFT (`publicFund + 0x02`): PublicFund `broadcast(padding)` | Fee payment |
| `s + 5` | Caller's inputs (BCH for the fee, `payBy` tokens) | Inflow thread to the TransactionManager |
| `s + 6` | | Outflow thread to the TransactionManager |
| `s + 7` | | Whole fund supply (2⁶³−1) to the FundManager |
| `s + 8` | | Public fund minting NFT returned |
| `s + 9 …` | | Fund commitment chunks to PublicFundVault (immutable `publicFund` NFTs) |
| after | | Caller's change |

Thread commitments: `0x02 · fundCategory · fundHash`. Chunks: the fund commitment split
into 128-byte pieces (the consensus commitment limit), in order.

### Adding threads to an existing fund

The same transaction from `s` to `s + 6` without PublicFund (no genesis, identity, supply
or chunks), paying the create fee. Creates one more inflow and outflow thread for the fund.
The contracts allow it; the library has no builder for it.

---

## Mint (inflow)

`FundTokenTransactionBuilder.addInflow({ units })`. `a` is the thread input (0 when the
builder is empty).

| Index | Input (unlocker) | Output |
| --- | --- | --- |
| `a` | Inflow thread: TransactionManager `inflow(fund, padding)` | Thread returned |
| `a + 1` | Execute fee UTXO: FeeManager `pay()` | Fee UTXO returned |
| `a + 2 …` | FundManager supply UTXOs: first `mint()` (leader), rest `mint()` (followers) | Fee payment |
| `a + 3 …` | | FundManager outputs (the library returns one per supply input: the first keeps the remaining supply, the rest are emptied to dust) |
| then | Caller's inputs: the deposit (BCH and each asset) and fee BCH | Custody: one output per reserve, BCH AssetManager first (`units × satoshis`), then each asset's AssetManager (`units × amount`) |
| then | | Caller's outputs: `units × fund.amount` fund tokens, change |

Released fund tokens = FundManager inputs − FundManager outputs = `units × fund.amount`.

## Redeem (outflow)

`FundTokenTransactionBuilder.addOutflow({ units })`.

| Index | Input (unlocker) | Output |
| --- | --- | --- |
| `a` | Outflow thread: TransactionManager `outflow(fund, padding)` | Thread returned |
| `a + 1` | Execute fee UTXO: FeeManager `pay()` | Fee UTXO returned |
| `a + 2` | One FundManager UTXO: `redeem()` (the library's choice; the contract allows zero or more) | Fee payment |
| `a + 3` | Reserve inputs: each reserve as one contiguous run, in reserve order, all `release()` | FundManager UTXO with its tokens + `units × fund.amount` |
| then | | Change back to custody, in reserve order (zero or more per reserve) |
| then | Caller's inputs: the fund tokens redeemed, fee BCH | Caller's outputs: the released BCH and assets, change |

Released per reserve = its inputs − its change = `units × satoshis` or `units × amount`.
The library releases custody UTXOs largest first, never leaves BCH change below dust, and
refuses a redemption that cannot fit a standard transaction ([LIMITS.md](LIMITS.md)). It
skips custody and FundManager UTXOs the contracts cannot spend: another category, or a mutable
or minting NFT of their own (the contracts compare the bare 32-byte category).

---

## Proofs

Anyone can run these; outputs return the NFTs unchanged at the same indices.

| Operation | Inputs | Outputs |
| --- | --- | --- |
| Instance proof | `a`: proof NFT, InstanceVault `proof()`; `a + 1`: data NFT, `data()` | `a`, `a + 1`: both returned |
| Public fund proof | `a`: first chunk, PublicFundVault `proof()`; `a + 1 …`: the following chunks (same creating transaction), `data()` | `a …`: each chunk returned at its index |

## Maintenance

Each needs an authorization NFT with the permission shown, in an input not locked by the
contract it authorizes ([ENCODINGS.md](ENCODINGS.md#authorization-token)).

| Operation | Permission | Layout |
| --- | --- | --- |
| Mint system minting threads: SimpleMinter `mint()` | 0x0001 | `in[a]`: counter NFT; `out[a]`: counter returned with serial advanced; minted NFTs at any other outputs, serials in output order |
| Release from a SimpleVault (e.g. the fee vault): `release()`, then `verify()` for each following vault UTXO | 0x0002 | Outputs unrestricted |
| Update an identity: AuthHeadVault `update()` | 0x0004 | `in[0]` / `out[0]`: the identity, tokenless |
| Burn identities: AuthHeadVault `burn()` | 0x0008 | `out[0]`: OP_RETURN, tokenless |
| Mint fee NFTs: FeeMinter `mint()` | 0x0010 | `in[a]` / `out[a]`: minting NFT returned; fee NFTs to the FeeManager at any other outputs |
| Close fee UTXOs: FeeManager `close()` | 0x0020 | No output to the FeeManager or holding the fee category |
| Change instance state: InstanceVault `update()` + `data()` | 0x0040 | Proof and data NFTs at `a`, `a + 1`, returned at the same indices |
| Burn the instance: InstanceVault `burn()` + `data()` | 0x0080 | No output holds the instance category |
| Delist a public fund: PublicFundVault `burn()` on the first chunk, `data()` on the rest | 0x0100 | No output holds the `publicFund` category |
