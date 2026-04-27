# FundTokens Contract Specifications

This document provides detailed specifications for each smart contract in the FundTokens system, including CashScript source and validation rules.

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
- At least one input must contain the `authorization`
- Any output with the `token` category must:
  - Send to the specified `destination`
  - Maintain the token category and commitment
  - Have empty NFT commitment to destination

**Usage**: System initialization, adding new threads

**Implementation**: See [contracts/simple_minter.cash](../fund-tokens-contracts/contracts/simple_minter.cash) for full source code.

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
- At least one input must contain the `authorization`
- Any output with the `token` category must:
  - Send to specified `destination`
  - Have NFT commitment with fee parameters:
    - Bytes [0:32] - Fee category (0x00 = satoshis, else token category)
    - Bytes [32:40] - Fee amount (int64 LE)
    - Bytes [40:...] - Optional destination override (locking bytecode)

**Fee Commitment Format**:
```
[fee_category (32 bytes) | fee_amount (8 bytes) | destination_override (0+ bytes)]
```

**Usage**: Dynamic fees

**Implementation**: See [contracts/fee_minter.cash](../fund-tokens-contracts/contracts/fee_minter.cash) for full source code.

---

### 3. SimpleVault

**Purpose**: Custody contract that releases funds only with authorization token present

**Parameters**:
- `authToken` (bytes32) - The authorization token category required for release

**Functions**:

#### `release()`

Allows input to be spent only when authorization token is present in transaction inputs.

**Validation**:
- At least one input must contain the `authToken` category
- No other checks - contract is purely authorization-gated

**Usage**: Fee collection destination

**Implementation**: See [contracts/simple_vault.cash](../fund-tokens-contracts/contracts/simple_vault.cash) for full source code.

---

### 4. AuthHeadVault

**Purpose**: Auth-head UTXO vault gating authorization token `authorization` for BCMR

**Parameters**:
- `authToken` (bytes32) - The authorization token category

**Functions**:

#### `release()`

Identical to SimpleVault - authorizes spending when token present and maintains no token authhead

**Usage**: PublicFund broadcast, BCMR maintenance

**Implementation**: See [contracts/authhead_vault.cash](../fund-tokens-contracts/contracts/authhead_vault.cash) for full source code.

---

### 4. PublicFundVault

**Purpose**: Public fund details vault w/ authorization token for closing

**Parameters**:
- `publicFund` (bytes32) - The public fund token category
- `authorization` (bytes32) - The authorization token category

**Functions**:

#### `close(bytes hash)`

Permanently closes a public fund data stream by aggregating all publicFund commitment data, verifying the hash, confirming authorization (requires bit 0x08), and burning all tokens.

Validates:
- All publicFund inputs are collected sequentially
- Concatenated commitment data hashes to expected value
- Authorization token with bit 0x08 (fund closure permission) is present
- No publicFund tokens remain in any output (enforced burn)

**Usage**: Signal fund closure, allow rebalancing of commitment chains

#### `prove(bytes hash)`

Proves fund composition on-chain by validating that all consecutive publicFund UTXOs are forwarded without modification and aggregated commitment data matches expected hash. Establishes an immutable proof chain.

Validates:
- Each publicFund input returns to matching output (no tampering)
- Input/output locking bytecode and token categories match
- NFT commitments are identical
- Concatenated commitment data hashes to expected value
- No other publicFund proofs exist in same transaction

**Usage**: Transaction proofs, prove fund state at specific block height

#### `data()`

Validates commitment data continuity in the proof chain by ensuring this UTXO was created from the previous input and links proof UTXOs together.

Validates:
- This input has publicFund token
- Previous input has identical locking bytecode
- Previous input has identical token category

**Usage**: Appending data for transaction proof chains

**Implementation**: See [contracts/public_vault.cash](../fund-tokens-contracts/contracts/public_vault.cash) for full source code.

---

## Fund Initialization Contracts

### 6. FundStartup

**Purpose**: Validates fund parameters and mints inflow/outflow threads for a new fund

**Parameters**:
- `fee` (bytes32) - Fee contract hash to verify payment
- `inflowToken` (bytes32) - Inflow token category to mint
- `outflowToken` (bytes32) - Outflow token category to mint

**Functions**:

#### `start(bytes fund)`

Initializes a fund by validating parameters and minting thread tokens.

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

**Output Commitment Format**:
```
fund_category (32 bytes) | hash256(fund) (32 bytes)
```

**Usage**: Validate fund details and send new threads to fund's transaction manager

**Implementation**: See [contracts/startup.cash](../fund-tokens-contracts/contracts/startup.cash) for full source code.

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

#### `broadcast(bytes fund)`

Broadcasts fund parameters in chunks via transaction outputs.

**Validation**:
1. First input must have vout==0 and no token (genesis input)
2. First output must route to authHeadDestination w/ no token
3. Previous input of this contract UTXO must be startup contract
4. Public fund UTXO returns to itself with same public fund token
5. Fund parameters validated:
   - Fund category non-empty
   - Fund category matches genesis transaction hash
   - Fund amount > 0
   - Satoshis validation (tiered by asset presence):
     - If fund has assets: satoshis can be 0 to 21M BTC
     - If fund has NO assets: satoshis must be 1 to 21M BTC (cannot be 0)
   - If assets present: sorted by category ascending
6. Output [activeInputIndex + 3] must be the new fund contract with proper parameters
7. Outputs [activeInputIndex + 5 onwards] chunk the fund in 128-byte segments

**Usage**: Ensure FundToken created properly and broadcast fund's details

**Implementation**: See [contracts/public.cash](../fund-tokens-contracts/contracts/public.cash) for full source code.

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
3. Input UTXO returns to itself
4. Following input must have outflow token with capability "minting"
5. Output must contain inflow token (nft minting)
6. Output [activeInputIndex + 4] is the new manager contract

**Usage**: Hold inflow token and mint for a new fund

**Implementation**: See [contracts/mint_inflow.cash](../fund-tokens-contracts/contracts/mint_inflow.cash) for full source code.

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
4. Input UTXO returns to itself with outflow token
5. Output [activeInputIndex + 4] receives outflow token (NFT minting)
6. Output [activeInputIndex + 4] is the new Fund contract with proper parameters
7. Fund contract address calculated by hashing:
   - hash256(assetContractParam + fundContractParam + 0x20 + fundHash + 0x20 + fundCategory + 0x20 + outflowToken + 0x20 + inflowToken + 0x20 + fee + managerContract)
   - Uses same parameters as Asset contract but different token output
8. Fund contract receives outflow token to control redemption operations

**Usage**: Hold outflow token and mint for a new fund

**Implementation**: See [contracts/mint_outflow.cash](../fund-tokens-contracts/contracts/mint_outflow.cash) for full source code.

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
- `fundContract` (bytes) - Fund contract bytecode for hashing
- `assetContract` (bytes) - Asset contract bytecode for hashing

**Functions**:

#### `inflow(bytes fund)`

Validates an inflow (minting) transaction.

**Validation**:
1. Input at [activeInputIndex - 1] must be the fund contract
2. Input UTXO has inflow token with matching fund commitment
3. Input UTXO returns to itself with inflow token
4. Fund hash matches parameter
5. Input at [activeInputIndex + 1] is fee contract
6. Calculates fund tokens released: `(input - output) / fund_amount`
7. Must be multiple of fund amount
8. All outputs match fund contract requirements

**Usage**: Inflow transaction initiation, fund token minting

#### `outflow(bytes fund)`

Validates an outflow (redemption) transaction.

**Validation**:
Similar structure to `inflow()` but:
- Uses outflow token instead of inflow
- Fund tokens increases (input < output)
- Assets released to user instead of acquired
- Multiple input UTXOs of a single asset can be included

**Usage**: Outflow transaction initiation, fund token redeeming

**Implementation**: See [contracts/manager.cash](../fund-tokens-contracts/contracts/manager.cash) for full source code.

---

### 11. FundManager

**Purpose**: Holds fund tokens and calculates release amounts

**Parameters**:
- `inflowToken` (bytes32) - Inflow token category (threading)
- `outflowToken` (bytes32) - Outflow token category (threading)
- `fundCategory` (bytes32) - Fund token category
- `fundHash` (bytes32) - Fund commitment hash

**Functions**:

#### `mint()`

Releases fund tokens during inflow (minting) transaction.

**Validation**:
1. Input at [activeInputIndex - 1] must have inflow token (manager)
2. Input UTXO returns to itself with fund tokens
3. If output has tokens: must be fund token, same category
4. If fund tokens are emptied then return to contract output w/ no tokens

**Usage**: Inflow transaction, release tokens

#### `redeem()`

Collects fund tokens during outflow (redeeming) transaction.

**Validation**:
1. Input at [activeInputIndex - 1] must have outflow token (redemption signal)
2. Input UTXO returns to itself with fund tokens
3. Fund tokens must increase (output amount > input amount)
4. If output has tokens: must be fund token, same category
5. If fund tokens are collected, return to contract output with tokens
6. Token increase must correspond to assets released in outflow

**Usage**: Outflow transaction, collect tokens

**Implementation**: See [contracts/fund.cash](../fund-tokens-contracts/contracts/fund.cash) for full source code.

---

### 12. AssetManager

**Purpose**: Holds and releases individual fund assets

**Parameters**:
- `outflowToken` (bytes32) - Outflow token category (threading signal)
- `fundHash` (bytes32) - Fund commitment hash (validation)
- `assetCategory` (bytes32) - The specific asset category this contract holds

**Functions**:

#### `release()`

Releases held assets during outflow (redemption) transaction.

**Validation**:
1. At least one input must have outflow token with matching fund hash
2. If asset is satoshis (assetCategory == 0x00...): input must have no token
3. Otherwise: input must have the specified asset category token

**Usage**: Release token assets

**Implementation**: See [contracts/asset.cash](../fund-tokens-contracts/contracts/asset.cash) for full source code.

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
1. Input UTXO returns to itself with same category/commitment
2. If input has feeToken:
   - Parse commitment: [category (32) | amount (8) | destination (var)]
   - If category == 0x00: output value matches amount
   - Else: output token category/amount matches
   - Destination: use parsed or default
3. Else (no fee token):
   - Output value = defaultValue
   - Output destination = default destination

**Usage**: Prove fee payment

#### `close()`

Allows authorized user to burn remaining fee tokens.

**Validation**:
1. At least one input must have authToken
2. No output can have feeToken (burned)

**Usage**: End dynamic fee

**Implementation**: See [contracts/fee.cash](../fund-tokens-contracts/contracts/fee.cash) for full source code.

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

- [01-SYSTEM_ARCHITECTURE.md](01-SYSTEM_ARCHITECTURE.md) - High-level overview
- [03-TRANSACTION_BUILDER_API.md](03-TRANSACTION_BUILDER_API.md) - Integration API
- [04-INTEGRATION_GUIDE.md](04-INTEGRATION_GUIDE.md) - Usage examples
- [05-FLOW_DIAGRAMS.md](05-FLOW_DIAGRAMS.md) - Visual flows
