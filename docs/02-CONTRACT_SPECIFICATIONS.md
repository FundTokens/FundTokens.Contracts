# FundTokens Contract Specifications

This document provides detailed specifications for each smart contract in the FundTokens system, including CashScript source and validation rules.

**Authorization**: contracts gated by the authorization token (SimpleMinter, FeeMinter, SimpleVault, AuthHeadVault, InstanceVault, PublicFundVault, FeeManager) accept it from any input *except* one locked by the contract's own address: neither the contract's own input nor another UTXO at that address counts. An authorization token sent to one of these contracts cannot authorize its own release, so keep authorization tokens outside the contracts they authorize. The check is one shared function, `hasAuthority()` in [contracts/lib/authority.cash](../fund-tokens-contracts/src/fund-types/token-basket/v1/contracts/lib/authority.cash), imported by each of these contracts.

**Fungible tokens on NFTs**: a minting NFT in a transaction can mint fungible tokens of its category onto any output, including the NFTs it returns or creates. So every contract that returns an NFT to itself (a thread, minting NFT, fee NFT, instance or fund data NFT) keeps its fungible token amount unchanged, and every NFT a contract mints carries none (amount 0).

## System Contracts

### 1. SimpleMinter

**Purpose**: Authorization-controlled minting of system tokens (inflow, outflow, public fund minting tokens)

**Parameters**:
- `authorization` (bytes32) - The authorization token category
- `token` (bytes32) - The token category to mint
- `destination` (bytes) - The locking bytecode to send minted tokens to

**Functions**:

#### `mint()`

Allows an authorized user to mint new tokens to a specified destination.

**Validation**:
- Input UTXO must have `token` category
- Input UTXO must return to itself
- NFT commitment must be preserved
  - Updated serial number
- Its fungible token amount is unchanged
- At least one input not held by this contract must contain the `authorization` token
- Any output with the `token` category must:
  - Carry no fungible tokens
  - Send to the specified `destination`
  - Use a increasing serial number and encode token type

**Usage**: System initialization, scaling w/ additional threads

**Implementation**: See [token-basket/v1/contracts/simple_minter.cash](../fund-tokens-contracts/src/fund-types/token-basket/v1/contracts/simple_minter.cash) for full source code.

---

### 2. FeeMinter

**Purpose**: Authorization-controlled minting of fee tokens with encoded fee details

**Parameters**:
- `authorization` (bytes32) - The authorization token category
- `token` (bytes32) - The fee token category to mint
- `destination` (bytes) - The locking bytecode to send fee tokens to

**Functions**:

#### `mint()`

Allows the owner to mint fee tokens with commitment encoding fee parameters.

**Validation**:
- Input UTXO must have `token` category (fungible minting token)
- Input UTXO must return to itself
- Its fungible token amount is unchanged
- At least one input not held by this contract must contain the `authorization` token
- Any output with the `token` category must:
  - Carry no fungible tokens
  - Send to specified `destination`
  - Have NFT commitment with fee parameters:
    - Bytes [0:1] - Fee type (0x01)
    - Bytes [1:33] - Fee category (0x00 = satoshis, else token category)
    - Bytes [33:41] - Fee amount (int64 LE)
    - Bytes [41:...] - Optional destination override (locking bytecode)

**Fee Commitment Format**:
```
[fee_type (0x01) (1 byte)][fee_category (32 bytes) | fee_amount (8 bytes) | destination_override (0+ bytes)]
```

**Usage**: Flexible fee platform

**Implementation**: See [token-basket/v1/contracts/fee_minter.cash](../fund-tokens-contracts/src/fund-types/token-basket/v1/contracts/fee_minter.cash) for full source code.

---

### 3. SimpleVault

**Purpose**: Custody contract that releases locked UTXOs only with authorization token present

**Parameters**:
- `authToken` (bytes32) - The authorization token category required for release

**Functions**:

#### `release()`

Allows vault release to be spent when the authToken is included in the tx

**Validation**:
- An input not held by this vault must contain the `authToken` category
- NFT token must contain the permission flag

**Usage**: Fee collection destination

**Implementation**: See [token-basket/v1/contracts/simple_vault.cash](../fund-tokens-contracts/src/fund-types/token-basket/v1/contracts/simple_vault.cash) for full source code.

---

### 4. AuthHeadVault

**Purpose**: Auth-head UTXO vault gating authorization token `authorization` for BCMR

**Parameters**:
- `authToken` (bytes32) - The authorization token category

**Functions**:

#### `release()`

Authorizes spending when token present and maintains token identity

**Usage**: PublicFund broadcast, BCMR maintenance

**Implementation**: See [token-basket/v1/contracts/authhead_vault.cash](../fund-tokens-contracts/src/fund-types/token-basket/v1/contracts/authhead_vault.cash) for full source code.

---

### 4. InstanceVault

**Purpose**: Public contract parameter vault w/ authorization token for maintenance/vulnerability signaling

The instance is two NFTs created in one transaction: a mutable proof token (`instance` + mutable capability) whose commitment holds the type, lifecycle state, library version, hash and leading data, and an immutable data token holding the rest. See [07-INSTANCE_TOKEN.md](07-INSTANCE_TOKEN.md).

**Parameters**:
- `instance` (bytes32) - The instance token category
- `authorization` (bytes32) - The authorization token category

**Functions**:

#### `burn()`

Permanently retires an instance by verifying its data and burning both instance tokens. The parameters stay recoverable from transaction history.

Validates:
- This input is the proof token and the next input is the data token from this vault
- The concatenated data hashes to the encoded hash
- No output carries an instance token (complete burn)
- An authorization token with bit 0x0080 (burn instance tokens) is present, not held by this vault

**Usage**: Signal that an instance is permanently closed

#### `update()`

Changes the instance's lifecycle state, the system's public signal of whether to use the instance.

Validates:
- An authorization token with bit 0x0040 (update instance state) is present, not held by this vault
- The new state is a defined lifecycle state: 0x01 pre-release, 0x02 main, 0x04 deprecated or 0x08 vulnerable
- Type, library version, hash and data are unchanged, and the data hashes to the encoded hash
- Both tokens return to this vault with their fungible token amounts, the data token unchanged

**Usage**: Mark an instance deprecated or vulnerable (or promote a pre-release)

#### `proof()`

Proves the instance parameters on-chain: both tokens are spent and returned unchanged, and the data hashes to the encoded hash.

Validates:
- This input is the proof token and the next input is the data token from this vault
- Both tokens return to this vault with identical category, commitment and fungible token amount
- The concatenated data hashes to the encoded hash

**Usage**: On-chain proof of the instance's parameters

#### `data()`

Links the data token to the proof token spent just before it.

Validates:
- This input carries the (immutable) instance token
- The previous input has the same locking bytecode and comes from the same transaction

**Usage**: Spent alongside `burn()`, `update()` or `proof()`

**Implementation**: See [token-basket/v1/contracts/instance_vault.cash](../fund-tokens-contracts/src/fund-types/token-basket/v1/contracts/instance_vault.cash) for full source code.

---

## Fund Initialization Contracts

### 4. PublicFundVault

**Purpose**: Public fund details vault w/ authorization token for delisting

**Parameters**:
- `publicFund` (bytes32) - The public fund token category
- `authorization` (bytes32) - The authorization token category

**Functions**:

#### `burn()`

Permanently delists a public fund by aggregating all publicFund commitment data, verifying the hash, confirming authorization (requires bit 0x0100), and burning all tokens, ending its data stream.

Validates:
- All publicFund inputs are collected sequentially
- Concatenated commitment data hashes to expected value
- Authorization token with bit 0x0100 (delist public fund permission) is present
- No publicFund tokens remain in any output (enforced burn)

**Usage**: Delist a public fund, allow rebalancing of commitment chains

#### `proof()`

Proves fund composition on-chain by validating that all consecutive publicFund UTXOs are forwarded without modification and aggregated commitment data matches expected hash. Establishes an immutable proof chain.

Validates:
- Each publicFund input returns to matching output (no tampering)
- Input/output locking bytecode and token categories match
- NFT commitments and fungible token amounts are identical
- Concatenated commitment data hashes to expected value
- The proof covers only the consecutive publicFund inputs starting at this input; publicFund inputs elsewhere in the transaction are not checked

**Usage**: Transaction proofs, prove fund state at specific block height

#### `data()`

Validates commitment data continuity in the proof chain by ensuring this UTXO was created from the previous input and links proof UTXOs together.

Validates:
- This input has publicFund token
- Previous input has identical locking bytecode
- Previous input has identical token category

**Usage**: Appending data for transaction proof chains

**Implementation**: See [token-basket/v1/contracts/public_vault.cash](../fund-tokens-contracts/src/fund-types/token-basket/v1/contracts/public_vault.cash) for full source code.

---

### 6. FundStartup

**Purpose**: Validates fund parameters and mints inflow/outflow threads for a new fund

**Parameters**:
- `fee` (bytes32) - Fee contract hash to verify payment
- `inflowToken` (bytes32) - Inflow token category to mint
- `outflowToken` (bytes32) - Outflow token category to mint

**Functions**:

#### `start(bytes fund, bytes padding)`

Initializes a fund by validating parameters and minting thread tokens. `padding` is ignored. An input's operation cost budget is (41 + its unlocking bytecode length) × 800, so each byte of padding buys 800 more: how a fund too large for the default budget pays for the compute it needs (see [Performance considerations](03-TRANSACTION_BUILDER_API.md#performance-considerations)).

**Fund Parameter Format** (passed as bytes):
```
[
  fund_category (32 bytes) |
  fund_amount (8 bytes) |
  satoshis (8 bytes) |
  [asset_category_1 (32 bytes) | asset_amount_1 (8 bytes)] x N
]
```

**Validation**:
1. Input UTXO must return to itself
2. Fund amount must be > 0
3. Satoshis must be within Bitcoin supply range (0 to 2,100,000,000,000,000 satoshis)
   - **Note**: PublicFund contract enforces stricter limits based on asset composition:
     - If fund has assets: satoshis can be 0 to 21M BTC
     - If fund has NO assets: satoshis must be 1 to 21M BTC (cannot be 0)
4. Assets must be sorted by category in ascending hexadecimal order
5. Each asset amount must be > 0
6. Input at [this.activeInputIndex + 1] must be a inflow token with capability "minting"
7. Input at [this.activeInputIndex + 2] must be a outflow token with capability "minting"
8. Input at [this.activeInputIndex + 3] must be the fee contract
9. Outputs must include:
   - [this.activeInputIndex + 5]: Inflow token minted with fund commitment
   - [this.activeInputIndex + 6]: Outflow token minted with fund commitment
10. No other outputs can mint inflow/outflow tokens
11. No input carries a live inflow/outflow thread: only the minting tokens may be spent, so a thread-creation transaction cannot also run a TransactionManager operation and every thread it creates is new

**Output Commitment Format**:
```
fund_category (32 bytes) | hash256(fund) (32 bytes)
```

**Usage**: Validate fund details and send new threads to fund's transaction manager

**Implementation**: See [token-basket/v1/contracts/startup.cash](../fund-tokens-contracts/src/fund-types/token-basket/v1/contracts/startup.cash) for full source code.

---

### 7. PublicFund

**Purpose**: Broadcasts fund details on-chain in 128-byte chunks for discovery and archival

**Parameters**:
- `authHeadDestination` (bytes) - Locking bytecode to send authHead output
- `publicFundDestination` (bytes) - Locking bytecode to send fund data chunks
- `token` (bytes32) - Public fund token category
- `startupContract` (bytes32) - Startup contract hash for validation
- `fundContract` (bytes) - Fund contract bytecode
- `inflowToken` (bytes32) - Inflow token category
- `outflowToken` (bytes32) - Outflow token category

**Functions**:

#### `broadcast(bytes padding)`

Broadcasts fund parameters in chunks via transaction outputs. `padding` is ignored. An input's operation cost budget is (41 + its unlocking bytecode length) × 800, so each byte of padding buys 800 more: how a fund too large for the default budget pays for the compute it needs (see [Performance considerations](03-TRANSACTION_BUILDER_API.md#performance-considerations)).

**Validation**:
1. First input must have vout==0 and no token (genesis input)
2. First output must route to authHeadDestination w/ no token
3. Previous input of this contract UTXO must be startup contract
4. Public fund UTXO returns to itself with same public fund token, commitment and fungible token amount; the fund data chunks it mints carry no fungible tokens
5. Fund parameters validated:
   - Fund category non-empty
   - Fund category matches genesis transaction hash
   - Fund amount > 0
   - Satoshis validation (tiered by asset presence):
     - If fund has assets: satoshis can be 0 to 21M BTC
     - If fund has NO assets: satoshis must be 1 to 21M BTC (cannot be 0)
   - If assets present: sorted by category ascending
6. Output [activeInputIndex + 3] must be the new fund contract (FundManager) holding the whole fund token supply. Its address is bound to the fund's TransactionManager, read from the minted inflow thread at output [activeInputIndex + 1] (whose address FundInflowMint enforces)
7. Outputs [activeInputIndex + 5 onwards] chunk the fund in 128-byte segments

**Usage**: Ensure FundToken created properly and broadcast fund's details

**Implementation**: See [token-basket/v1/contracts/public.cash](../fund-tokens-contracts/src/fund-types/token-basket/v1/contracts/public.cash) for full source code.

---

### 8. FundInflowMint

**Purpose**: Creates fund-specific execution contracts for a fund thread

**Parameters**:
- `validator` (bytes32) - Validator contract (TransactionManager) hash
- `inflowToken` (bytes32) - Inflow token category
- `outflowToken` (bytes32) - Outflow token category
- `fee` (bytes32) - Fee contract hash
- `managerContract` (bytes) - Fund manager contract bytecode
- `fundContract` (bytes) - Fund contract bytecode
- `assetContract` (bytes) - Asset contract bytecode

**Functions**:

#### `mint()`

Mints inflow threads to a fund's transaction manager

**Validation** (mintInflow):
1. Previous input must be validator contract
2. Input UTXO must contain inflow token with capability "minting"
3. Input UTXO returns to itself with the same commitment and fungible token amount
4. Following input must have outflow token with capability "minting"
5. Output must contain inflow token (nft minting), with no fungible tokens
6. Output [activeInputIndex + 4] is the new manager contract

**Usage**: Hold inflow token and mint for a new fund

**Implementation**: See [token-basket/v1/contracts/mint_inflow.cash](../fund-tokens-contracts/src/fund-types/token-basket/v1/contracts/mint_inflow.cash) for full source code.

---

### 9. FundOutflowMint

**Purpose**: Creates fund-specific execution contracts for a fund thread

**Parameters**:
- `validator` (bytes32) - Validator contract (TransactionManager) hash
- `inflowToken` (bytes32) - Inflow token category
- `outflowToken` (bytes32) - Outflow token category
- `fee` (bytes32) - Fee contract hash
- `managerContract` (bytes) - Fund manager contract bytecode
- `fundContract` (bytes) - Fund contract bytecode
- `assetContract` (bytes) - Asset contract bytecode

**Functions**:

#### `mint()`

Mints outflow threads to a fund's transaction manager

**Validation** (mintOutflow):
1. Input at [activeInputIndex - 2] must be validator contract (sequence control)
2. Input at [activeInputIndex - 1] must have inflow token with capability "minting" (sequence signal)
3. Input UTXO must contain outflow token with capability "minting"
4. Input UTXO returns to itself with outflow token, the same commitment and fungible token amount
5. Output [activeInputIndex + 4] receives outflow token (NFT minting), with no fungible tokens
6. Output [activeInputIndex + 4] is the new Fund contract with proper parameters
7. Fund contract address calculated by hashing:
   - hash256(assetContractParam + fundContractParam + 0x20 + fundHash + 0x20 + fundCategory + 0x20 + outflowToken + 0x20 + inflowToken + 0x20 + fee + managerContract)
   - Uses same parameters as Asset contract but different token output
8. Fund contract receives outflow token to control redemption operations

**Usage**: Hold outflow token and mint for a new fund

**Implementation**: See [token-basket/v1/contracts/mint_outflow.cash](../fund-tokens-contracts/src/fund-types/token-basket/v1/contracts/mint_outflow.cash) for full source code.

---

## Per-Fund Execution Contracts

### 10. TransactionManager

**Purpose**: Coordinates inflow/outflow transactions and validates contract threading

**Parameters**:
- `fee` (bytes32) - Fee contract hash
- `inflowToken` (bytes32) - Inflow token category
- `outflowToken` (bytes32) - Outflow token category
- `fundCategory` (bytes32) - Unique token category for this fund
- `fundHash` (bytes32) - Hash of fund commitment
- `fundContract` (bytes) - Fund contract bytecode template for hashing
- `assetContract` (bytes) - Asset contract bytecode template for hashing

The fund's FundManager and AssetManager addresses are derived at run time from these templates plus this contract's own locking bytecode (they are bound to it, see below), so the TransactionManager itself depends only on templates.

**Functions**:

#### `inflow(bytes fund, bytes padding)`

Validates an inflow (minting) transaction. The operation is laid out from this input (`a`): fee at `a + 1`, FundManager inputs from `a + 2`, FundManager outputs from `a + 3`, then the custody outputs. `padding` is ignored. An input's operation cost budget is (41 + its unlocking bytecode length) × 800, so each byte of padding buys 800 more: how a fund too large for the default budget pays for the compute it needs (see [Performance considerations](03-TRANSACTION_BUILDER_API.md#performance-considerations)).

**Validation**:
1. `hash256(fund)` matches `fundHash`; this input carries the inflow thread with the fund's commitment (`0x02 + fundCategory + fundHash`)
2. Input and output `a + 1` are the execute FeeManager (the fee returns to itself, so it ran `pay()`)
3. Each counted FundManager input and output is tokenless or holds the fund token
4. Fund tokens released (`input - output`) must be a whole multiple of the fund amount and more than zero; this is the number of units deposited
5. Custody outputs follow the FundManager outputs: satoshis first (if the fund is BCH-backed), then each asset in ascending category order. Each must be at its AssetManager address, the satoshi output tokenless and each asset output in the asset's category, holding exactly `units × amount`
6. The thread returns to this contract with the same category, commitment and fungible token amount

**Usage**: Inflow transaction initiation, fund token minting

#### `outflow(bytes fund, bytes padding)`

Validates an outflow (redemption) transaction, laid out like `inflow()`.

**Validation**:
1. Same checks on `fund`, the outflow thread and the fee as `inflow()`; `padding` is likewise ignored
2. Each counted FundManager input and output holds only the fund token; fund tokens collected (`output - input`) must be a whole multiple of the fund amount and more than zero
3. Reserve inputs must follow the FundManager inputs with no gap: satoshis first, then each asset in ascending category order, each as one contiguous run of that AssetManager's UTXOs (several UTXOs of one asset may be spent)
4. Change may return to each AssetManager right after the FundManager outputs, in the same order; per reserve, released (`inputs - change`) must equal `units × amount`
5. The thread returns to this contract with the same category, commitment and fungible token amount

**Usage**: Outflow transaction initiation, fund token redeeming

**Implementation**: See [token-basket/v1/contracts/manager.cash](../fund-tokens-contracts/src/fund-types/token-basket/v1/contracts/manager.cash) for full source code.

---

### 11. FundManager

**Purpose**: Holds fund tokens and calculates release amounts

**Parameters**:
- `inflowToken` (bytes32) - Inflow token category (threading)
- `outflowToken` (bytes32) - Outflow token category (threading)
- `fundCategory` (bytes32) - Fund token category
- `fundHash` (bytes32) - Fund commitment hash
- `transactionManager` (bytes) - Locking bytecode of the fund's TransactionManager

**Functions**:

#### `mint()`

Releases fund tokens during inflow (minting) transaction. Amounts are enforced by the TransactionManager.

**Validation**:
1. Either the input at [activeInputIndex - 2] is the fund's inflow thread, spent from `transactionManager` with the fund's commitment, or the previous input is this FundManager (and holds the fund token, if any)
2. When linked to the thread: the next output returns to this contract, holding the fund token or no token (if the supply is emptied)

**Usage**: Inflow transaction, release tokens

#### `redeem()`

Collects fund tokens during outflow (redeeming) transaction. Amounts are enforced by the TransactionManager.

**Validation**:
1. Either the input at [activeInputIndex - 2] is the fund's outflow thread, spent from `transactionManager` with the fund's commitment, or the previous input is this FundManager (and holds the fund token, if any)
2. When linked to the thread: the next output returns to this contract holding the fund token

**Usage**: Outflow transaction, collect tokens

**Implementation**: See [token-basket/v1/contracts/fund.cash](../fund-tokens-contracts/src/fund-types/token-basket/v1/contracts/fund.cash) for full source code.

---

### 12. AssetManager

**Purpose**: Holds and releases individual fund assets

**Parameters**:
- `outflowToken` (bytes32) - Outflow token category (threading signal)
- `fundHash` (bytes32) - Fund commitment hash (validation)
- `assetCategory` (bytes32) - The specific asset category this contract holds (all zeros for satoshis)
- `transactionManager` (bytes) - Locking bytecode of the fund's TransactionManager
- `linkedAsset` (bytes) - Locking bytecode of the AssetManager redeemed just before this one (satoshis first, then assets by ascending category); empty for the first

**Functions**:

#### `release()`

Releases held assets during outflow (redemption) transaction. Amounts are enforced by the TransactionManager.

**Validation**:
1. If asset is satoshis (assetCategory == 0x00...): input must have no token
2. Otherwise: input must have the specified asset category token
3. The previous input is this AssetManager or `linkedAsset` (both run `release()` themselves), or else this is the first reserve of the operation: scanning back past the FundManager and fee inputs must reach the fund's outflow thread, spent from `transactionManager`

**Usage**: Release token assets

**Implementation**: See [token-basket/v1/contracts/asset.cash](../fund-tokens-contracts/src/fund-types/token-basket/v1/contracts/asset.cash) for full source code.

---

### 13. FeeManager

**Purpose**: Validates and routes fee payments

**Parameters**:
- `authToken` (bytes32) - Authorization token for close operation
- `destination` (bytes) - Default fee destination locking bytecode
- `feeToken` (bytes32) - Fee token category (NFT)
- `defaultValue` (int) - Default fee amount in satoshis

**Functions**:

#### `pay()`

Routes fee payment during transaction execution.

**Validation**:
1. Input UTXO returns to itself with same category/commitment and fungible token amount
2. If input has feeToken with an enforced fee (type 0x01):
   - Parse commitment: [type (1) | category (32) | amount (8) | destination (var)]
   - If category == 0x00: output value matches amount, with no token
   - Else: output token category/amount matches
   - Destination: use parsed or default
3. If input has feeToken with a voluntary fee (type 0x02), the fee output either:
   - Goes to the default destination with BCH alone (value > 0) or a token without NFT capability (fungible tokens or an immutable NFT), or
   - Is an OP_RETURN with no BCH and no token (no payment)
4. Else (no fee token):
   - Output value = defaultValue, with no token
   - Output destination = default destination

The fee output never carries a minting or mutable NFT. In a fund creation it sits inside the FundStartup and PublicFund anti-minting windows, and the genesis input could otherwise mint a minting NFT of the new fund's category onto it.

**Usage**: Prove fee payment

#### `close()`

Allows authorized user to close fee threads, burning any fee tokens.

**Validation**:
1. An input not held by this contract must have authToken with the close fee permission (0x0020)
2. No output can have feeToken (burned)
3. No output can return to this contract, so a FeeManager input that does return must have run `pay()` (FundStartup and the TransactionManager rely on this)

**Usage**: End a fee thread. To consolidate fee UTXOs, close them, then pay a new default fee UTXO to the contract in a separate transaction

**Implementation**: See [token-basket/v1/contracts/fee.cash](../fund-tokens-contracts/src/fund-types/token-basket/v1/contracts/fee.cash) for full source code.

---

## Contract State Transitions

### Inflow Transaction (Minting)

```
Manager (inflow token) + Fund (fund tokens) + Fee
  ↓
Manager validates: inflow token + fund commitment + token release amount
Fund validates: returns with output, fund tokens if with tokens
Fee validates: payment routing
  ↓
Manager → Manager (returns with inflow token)
Fund → Fund (returns with fewer tokens)
Fee → Fee (returns with fee token intact)
User → Asset 1 (deposits satoshis/tokens)
User → Asset 2 (deposits satoshis/tokens)
User → Asset N (deposits satoshis/tokens)
User → User (receives fund tokens)
```

### Outflow Transaction (Redemption)

```
Fund (fund tokens) + Manager (outflow token) + Fee + Assets
  ↓
Manager validates: outflow token + fund commitment + token collection amount
Fund validates: returns with fund tokens, more than the input
Fee validates: payment routing
Asset contracts validate: outflow token present
  ↓
Manager → Manager (returns with outflow token)
Fund → Fund (returns with more tokens)
Fee → Fee (returns with fee token intact)
Asset 1 → Asset (empty if all released)
Asset 2 → Asset (empty if all released)
Asset N → Asset (empty if all released)
User → User (receives redeemed assets)
```

---

## See Also

- [01-SYSTEM_ARCHITECTURE.md](01-SYSTEM_ARCHITECTURE.md) - System design overview
- [03-TRANSACTION_BUILDER_API.md](03-TRANSACTION_BUILDER_API.md) - Transaction API
- [04-INTEGRATION_GUIDE.md](04-INTEGRATION_GUIDE.md) - Integration examples
- [05-FLOW_DIAGRAMS.md](05-FLOW_DIAGRAMS.md) - Visual flow diagrams
- [06-SYSTEM_TOKENS.md](06-SYSTEM_TOKENS.md) - System token specification
- [07-FEE_TOKEN.md](07-FEE_TOKEN.md) - Fee token specification
- [08-AUTHORIZATION_TOKEN.md](08-AUTHORIZATION_TOKEN.md) - Authorization token specification