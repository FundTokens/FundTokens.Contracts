# Fixed Basket v1: Encodings

Byte layouts of everything v1 reads from data: the fund encoding and every NFT commitment.
`·` is concatenation. Categories are 32 bytes in internal byte order (reversed from the
displayed hex). Integers are little-endian and read by the contracts as VM numbers, so the
top bit of the last byte must be clear. An NFT commitment holds at most 128 bytes (BCH
consensus).

## Fund encoding

Passed to `FundStartup.start()` and `TransactionManager.inflow()` / `outflow()`, and
hashed into the fund hash. Library: `getFundHex` / `getFundBin`, `decodeFund`.

```
fundCategory (32) · amount (8) · satoshis (7) · [assetCategory (32) · assetAmount (8)] × N
```

47 + 40·N bytes.

| Field | Meaning | Contract rule |
| --- | --- | --- |
| `fundCategory` | The fund token category: the genesis transaction's id | Equals the genesis outpoint hash at creation |
| `amount` | Fund tokens per unit | 1 … 2⁶³−1 |
| `satoshis` | BCH per unit | 0 … 2.1×10¹⁵ with assets, 1 … 2.1×10¹⁵ without |
| `assetCategory` | Asset token category | Strictly ascending by displayed hex |
| `assetAmount` | Asset tokens per unit | 1 … 2⁶³−1 |

**Fund hash**: `hash256(fund encoding)`, kept in internal order (the library's `hashFund`
returns it unreversed).

**Asset order**: ascending as 256-bit big-endian integers of the displayed hex. The contract
compares `int(category · 0x00)` of the internal-order bytes, which is the same order.
Library: `categoryAscending`, `sortAssets`. The library also rejects (the contracts do not)
an all-zero asset category, the fund's own category and more than `MaxFundAssets` (100) assets.

## Fund commitment

Published by PublicFund in the PublicFundVault. Library: `getFundCommitment`,
`decodeFundCommitment`.

```
0x02 · fundHash (32) · fund encoding
```

80 + 40·N bytes, split in order across immutable `publicFund` NFTs. Every chunk but the
last has the first chunk's length; the library uses 128-byte chunks. Only the first chunk
starts with the type byte.

## Thread commitment

The inflow and outflow threads (immutable NFTs of the `inflow` / `outflow` categories)
held by the fund's TransactionManager:

```
0x02 · fundCategory (32) · fundHash (32)
```

## System token types

The first commitment byte is the token type. Serial numbers are VM numbers.

### Inflow, outflow and public fund tokens

| Type | Capability | Commitment | Held by | Role |
| --- | --- | --- | --- | --- |
| 0x00 | Minting | `0x00 · serial` | SimpleMinter | Counter: mints type-0x01 minting NFTs with consecutive serials |
| 0x01 | Minting | `0x01 · serial` | FundInflowMint / FundOutflowMint / PublicFund | Mints threads (inflow/outflow) or fund data chunks (public fund) |
| 0x02 | None | Thread commitment (inflow/outflow) or a fund commitment chunk (public fund) | TransactionManager / PublicFundVault | A fund's thread, or its published definition |

### Fee NFTs

Fee category NFTs. The create and execute fees each have their own category.

| Type | Capability | Commitment | Held by | Role |
| --- | --- | --- | --- | --- |
| 0x00 | Minting | `0x00 · serial` (not checked) | FeeMinter | Mints fee NFTs |
| 0x01 | None | `0x01 · feeCategory (32) · feeAmount (8) · [destination]` | FeeManager | Enforced fee |
| 0x02 | None | `0x02` | FeeManager | Voluntary fee |

- `feeCategory`: all zeros for BCH (then `feeAmount` is satoshis), else the token category
  paid (then `feeAmount` is a token amount, paid exactly).
- `feeAmount` > 0 (FeeMinter).
- `destination`: optional locking bytecode receiving the fee; the FeeManager's default (the
  fee vault) when absent.
- Library: `encodeFee({ category?, amount, destination? })`, `decodeFee`.

A FeeManager UTXO with no fee NFT is a default fee: `defaultValue` satoshis to the default
destination.

### Authorization token

```
authType (1) · permissions (2) · serial
```

| Type | Capability | Role |
| --- | --- | --- |
| 0x00 | Minting | Mints authorization NFTs (commitment `0x00 · serial`) |
| 0x01 | None | Held by a person or service |
| 0x02 | Mutable or none | Held by a contract |

Only an immutable authorization NFT can authorize: `hasAuthority` matches the category
exactly. The type byte itself is not checked.

`permissions` is two bytes, compared as written: permission `0x0040` is stored `00 40`. A
token may hold several bits (bitwise OR).

| Bit | Contract | Permission |
| --- | --- | --- |
| 0x0001 | SimpleMinter | Mint system minting threads |
| 0x0002 | SimpleVault | Release vault UTXOs (e.g. collected fees) |
| 0x0004 | AuthHeadVault | Update a fund identity (BCMR) |
| 0x0008 | AuthHeadVault | Burn fund identities |
| 0x0010 | FeeMinter | Mint fee NFTs |
| 0x0020 | FeeManager | Close fee UTXOs |
| 0x0040 | InstanceVault | Change the instance's lifecycle state |
| 0x0080 | InstanceVault | Burn a deprecated or vulnerable instance |
| 0x0100 | PublicFundVault | Delist a public fund |
| 0xFE00 | | Reserved |

Examples: `0x00C0` is every InstanceVault permission; `0x01FF` is every permission.

## Instance NFTs

Two NFTs of the `instance` category in the InstanceVault, created in one transaction:

```
proof NFT (mutable):  type (1) = 0x00 · state (1) · version (2) · hash (32) · data, first part
data NFT (immutable): data, rest
```

`hash = hash256(data)` over the whole data, both parts concatenated. With 128-byte
commitments the proof NFT carries the first 92 bytes of data and the data NFT the other 116.

| State | Name | Meaning |
| --- | --- | --- |
| 0x01 | Pre-release | Early access |
| 0x02 | Main | The instance to use for new funds |
| 0x04 | Deprecated | Retired: no new funds, existing funds keep working |
| 0x08 | Vulnerable | Retired for a vulnerability: redeem holdings. Terminal: never changes again |

The registry reports the same states as `status`: `'pre'`, `'main'`, `'dep'`, `'vul'`.

### Instance data

`data` is the instance's system parameters (`SystemParameters`), serialized as the
protocol contracts take them: in `SystemParameters` order, categories as 32 bytes in
internal byte order (as passed to the contract constructors), fee values as 8-byte
little-endian integers (like every other v1 amount). 208 bytes:

```
inflow (32) · outflow (32) · publicFund (32) · authorization (32) ·
fees.create.nft (32) · fees.create.value (8) · fees.execute.nft (32) · fees.execute.value (8)
```

| Field | Used by |
| --- | --- |
| `inflow`, `outflow` | FundStartup, FundInflowMint, FundOutflowMint, PublicFund, every TransactionManager and FundManager; AssetManagers take `outflow` only |
| `publicFund` | PublicFund, PublicFundVault |
| `authorization` | Every authorization-gated contract and the fee vault |
| `fees.create.nft`, `fees.create.value` | The create FeeManager (`feeToken`, `defaultValue`) |
| `fees.execute.nft`, `fees.execute.value` | The execute FeeManager |

Fee values cover the full range `parseSystemParameters` accepts (0 to 2⁶³−1).

The contracts only hash `data`; the deployment tooling writes it. Everything else an
instance's contracts are built from (their templates, and the addresses derived from them)
follows from these parameters and the contract version.
