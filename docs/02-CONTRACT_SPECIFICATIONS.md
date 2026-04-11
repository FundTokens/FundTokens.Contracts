# FundTokens Contract Specifications

This document provides detailed specifications for each smart contract in the FundTokens system, including CashScript source and validation rules.

## System Contracts

### 1. SimpleMinter

**Purpose**: Owner-controlled minting of system tokens (inflow, outflow, public fund tokens)

**Location**: [contracts/simple_minter.cash](../fund-tokens-contracts/contracts/simple_minter.cash)

**Parameters**:
- `ownerToken` (bytes32) - The owner authorization token category
- `token` (bytes32) - The token category to mint
- `destination` (bytes) - The locking bytecode to send minted tokens to

**Functions**:

#### `mint()`

Allows the owner to mint new tokens to a specified destination.

**Validation**:
- Input UTXO must have `token` category
- Input UTXO must return to itself (OP_CODESEPARATOR)
- NFT commitment must be preserved
- At least one input must contain the `ownerToken` (authorization)
- Any output with the `token` category must:
  - Send to the specified `destination`
  - Maintain the token category and CFT commitment
  - Have empty NFT commitment (fungible)

**Usage**: System initialization, adding new threads

**CashScript**:
```cashscript
pragma cashscript ~0.13.0;

contract SimpleMinter(bytes32 ownerToken, bytes32 token, bytes destination)
{
    function mint() {
        // This contract must return to itself
        require(tx.inputs[this.activeInputIndex].lockingBytecode == 
                tx.outputs[this.activeInputIndex].lockingBytecode);
        // Must be minting the specified token
        require(tx.inputs[this.activeInputIndex].tokenCategory.slice(0, 32) == token);
        // Return the same token to self
        require(tx.inputs[this.activeInputIndex].tokenCategory == 
                tx.outputs[this.activeInputIndex].tokenCategory);
        // Preserve NFT commitment
        require(tx.inputs[this.activeInputIndex].nftCommitment == 
                tx.outputs[this.activeInputIndex].nftCommitment);

        // Check for owner authorization in ANY input
        bool ownerSeen = false;
        int inputIndex = 0;
        do {
            if(tx.inputs[inputIndex].tokenCategory == ownerToken) {
                ownerSeen = true;
            }
            inputIndex = inputIndex + 1;
        } while(inputIndex < tx.inputs.length && !ownerSeen);
        require(ownerSeen, "unauthorized user");

        // Verify any minted tokens go to destination
        int outputIndex = 0;
        do {
            if(outputIndex != this.activeInputIndex && tx.outputs[outputIndex].tokenCategory != 0x) {
                if(tx.outputs[outputIndex].tokenCategory.slice(0, 32) == token) {
                    require(tx.outputs[outputIndex].lockingBytecode == destination);
                    require(tx.outputs[outputIndex].tokenCategory == 
                            tx.inputs[this.activeInputIndex].tokenCategory);
                    require(tx.outputs[outputIndex].nftCommitment == 0x);
                }
            }
            outputIndex = outputIndex + 1;
        } while(outputIndex < tx.outputs.length);
    }
}
```

---

### 2. FeeMinter

**Purpose**: Owner-controlled minting of fee tokens with encoded fee details

**Location**: [contracts/fee_minter.cash](../fund-tokens-contracts/contracts/fee_minter.cash)

**Parameters**:
- `ownerToken` (bytes32) - The owner authorization token category
- `token` (bytes32) - The fee token category to mint
- `destination` (bytes) - The locking bytecode to send fee tokens to

**Functions**:

#### `mint()`

Allows the owner to mint fee tokens with commitment encoding fee parameters.

**Validation**:
- Input UTXO must have `token` category (fungible minting token)
- Input UTXO must return to itself
- At least one input must contain the `ownerToken` (authorization)
- Any output with the `token` category must:
  - Send to specified `destination`
  - Have NFT commitment with fee parameters:
    - Bytes [0:32] - Fee category (0x00 = satoshis, else token category)
    - Bytes [32:40] - Fee amount (uint64 LE)
    - Bytes [40:...] - Optional destination override (locking bytecode)

**Fee Commitment Format**:
```
[fee_category (32 bytes) | fee_amount (8 bytes) | destination_override (0+ bytes)]
```

**CashScript**:
```cashscript
pragma cashscript ~0.13.0;

contract FeeMinter(bytes32 ownerToken, bytes32 token, bytes destination)
{
    function mint() {
        // Minting token category check
        require(tx.inputs[this.activeInputIndex].tokenCategory.slice(0, 32) == token);

        // Return to self
        require(tx.inputs[this.activeInputIndex].lockingBytecode == 
                tx.outputs[this.activeInputIndex].lockingBytecode);
        require(tx.inputs[this.activeInputIndex].tokenCategory == 
                tx.outputs[this.activeInputIndex].tokenCategory);
        // Preserve NFT commitment
        require(tx.inputs[this.activeInputIndex].nftCommitment == 
                tx.outputs[this.activeInputIndex].nftCommitment);

        // Check for owner authorization
        bool ownerSeen = false;
        int inputIndex = 0;
        do {
            if(tx.inputs[inputIndex].tokenCategory == ownerToken) {
                ownerSeen = true;
            }
            inputIndex = inputIndex + 1;
        } while(inputIndex < tx.inputs.length && !ownerSeen);
        require(ownerSeen, "unauthorized user");

        // Verify fee tokens sent to destination with proper commitment
        int outputIndex = 0;
        do {
            if(outputIndex != this.activeInputIndex && tx.outputs[outputIndex].tokenCategory != 0x) {
                if(tx.outputs[outputIndex].tokenCategory.slice(0, 32) == token) {
                    require(tx.outputs[outputIndex].lockingBytecode == destination);
                    require(tx.outputs[outputIndex].tokenCategory == token);

                    // Commitment must be present and encode fee details
                    require(tx.outputs[outputIndex].nftCommitment.length > 0, 
                            "must provide a commitment");
                    bytes fee_category, bytes fee_next1 = 
                        tx.outputs[outputIndex].nftCommitment.split(32);
                    require(fee_category != 0x); // Category must be specified
                    bytes fee_amount, bytes fee_destination = fee_next1.split(8);
                    require(int(fee_amount) > 0); // Amount must be positive
                }
            }
            outputIndex = outputIndex + 1;
        } while(outputIndex < tx.outputs.length);
    }
}
```

---

### 3. SimpleVault

**Purpose**: Custody contract that releases funds only with authorization token present

**Location**: [contracts/simple_vault.cash](../fund-tokens-contracts/contracts/simple_vault.cash)

**Parameters**:
- `authToken` (bytes32) - The authorization token category required for release

**Functions**:

#### `release()`

Allows funds to be spent only when authorization token is present in transaction inputs.

**Validation**:
- At least one input must contain the `authToken` category
- No other checks - contract is purely authorization-gated

**Usage**: Custodying owner token, fee collection destination

**CashScript**:
```cashscript
pragma cashscript ~0.13.0;

contract SimpleVault(bytes32 authToken)
{
    function release() {
        // Check for authorization in ANY input
        bool authorized = false;
        int inputIndex = 0;
        do {
            if(tx.inputs[inputIndex].tokenCategory == authToken) {
                authorized = true;
            }
            inputIndex = inputIndex + 1;
        } while(inputIndex < tx.inputs.length && !authorized);
        require(authorized, "unauthorized user");
    }
}
```

---

### 4. AuthHeadVault

**Purpose**: Vault gating authorization token `authHead` - authorizes fund creation

**Location**: [contracts/authhead_vault.cash](../fund-tokens-contracts/contracts/authhead_vault.cash)

**Parameters**:
- `authHeadToken` (bytes32) - The authorization token category

**Functions**:

#### `release()`

Identical to SimpleVault - authorizes spending when authHead token present.

**Usage**: PublicFund broadcast authorization, fund creation validation

---

## Fund Initialization Contracts

### 5. FundStartup

**Purpose**: Validates fund parameters and mints inflow/outflow threads for a new fund

**Location**: [contracts/startup.cash](../fund-tokens-contracts/contracts/startup.cash)

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
3. Satoshis must be valid: 0 or between 1,000-21,000,000 BTC
4. Assets must be sorted by category in ascending order
5. Each asset amount must be > 0
6. Input at [this.activeInputIndex + 1] must contain inflow token with capability "send"
7. Input at [this.activeInputIndex + 2] must contain outflow token with capability "send"
8. Input at [this.activeInputIndex + 3] must be the fee contract
9. Outputs must include:
   - [this.activeInputIndex + 5]: Inflow token minted with fund commitment
   - [this.activeInputIndex + 6]: Outflow token minted with fund commitment
10. No other outputs can mint inflow/outflow tokens

**Output Commitment Format**:
```
fund_category (32 bytes) | hash256(fund) (32 bytes)
```

**CashScript Excerpt**:
```cashscript
pragma cashscript ~0.13.0;

contract FundStartup(bytes32 fee, bytes32 inflowToken, bytes32 outflowToken)
{
    function start(bytes fund) {
        // Startup UTXO returns to itself
        require(tx.inputs[this.activeInputIndex].lockingBytecode == 
                tx.outputs[this.activeInputIndex].lockingBytecode);
        require(tx.inputs[this.activeInputIndex].tokenCategory == 
                tx.outputs[this.activeInputIndex].tokenCategory);
        require(tx.inputs[this.activeInputIndex].nftCommitment == 
                tx.outputs[this.activeInputIndex].nftCommitment);

        // Parse fund parameters from commitment
        bytes nft_fundCategory, bytes nft_next1 = fund.split(32);
        bytes nft_fundAmount, bytes nft_next2 = nft_next1.split(8);
        require(int(nft_fundAmount) > 0);
        bytes nft_satoshis, bytes nft_assets = nft_next2.split(8);
        require(within(int(nft_satoshis), 0, 2100000000000000));

        // Validate asset sorting and amounts
        bytes lastAssetCategory = 0x;
        while(nft_assets.length > 0) {
            bytes nft_assetCategory, bytes nft_next3 = nft_assets.split(32);
            bytes nft_assetAmount, bytes nft_next4 = nft_next3.split(8);
            require(int(nft_assetAmount) > 0);

            if(lastAssetCategory != 0x) {
                require(int(lastAssetCategory + 0x00) < int(nft_assetCategory + 0x00));
            }

            nft_assets = nft_next4;
            lastAssetCategory = nft_assetCategory;
        }

        // Verify inflow/outflow input tokens
        require(tx.inputs[this.activeInputIndex + 1].tokenCategory == 
                bytes(inflowToken + 0x02));
        require(tx.inputs[this.activeInputIndex + 2].tokenCategory == 
                bytes(outflowToken + 0x02));

        // Verify fee contract input
        require(tx.inputs[this.activeInputIndex + 3].lockingBytecode == 
                new LockingBytecodeP2SH32(fee));

        // Verify inflow token output with commitment
        require(tx.outputs[this.activeInputIndex + 5].tokenCategory == inflowToken);
        require(tx.outputs[this.activeInputIndex + 5].nftCommitment == 
                bytes(nft_fundCategory + hash256(fund)));

        // Verify outflow token output with commitment
        require(tx.outputs[this.activeInputIndex + 6].tokenCategory == outflowToken);
        require(tx.outputs[this.activeInputIndex + 6].nftCommitment == 
                bytes(nft_fundCategory + hash256(fund)));

        // Ensure no other outputs mint inflow/outflow tokens
        int outputIndex = 0;
        do {
            if(!within(outputIndex, this.activeInputIndex, this.activeInputIndex + 7)) {
                if(tx.outputs[outputIndex].tokenCategory != 0x) {
                    require(tx.outputs[outputIndex].tokenCategory.slice(0, 32) != inflowToken);
                    require(tx.outputs[outputIndex].tokenCategory.slice(0, 32) != outflowToken);
                }
            }
            outputIndex = outputIndex + 1;
        } while(outputIndex < tx.outputs.length);
    }
}
```

---

### 6. PublicFund

**Purpose**: Broadcasts fund details on-chain in 128-byte chunks for discovery and archival

**Location**: [contracts/public.cash](../fund-tokens-contracts/contracts/public.cash)

**Parameters**:
- `authHeadDestination` (bytes) - Locking bytecode to send authHead output
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
2. First output must route to authHeadDestination
3. Previous input must be startup contract
4. Public fund UTXO returns to itself with same public fund token
5. Fund parameters validated:
   - Fund category non-zero
   - Fund category matches genesis transaction hash
   - Fund amount > 0
   - Satoshis valid (0 or 1,000-21,000,000 BTC)
   - If assets present: sorted by category ascending
6. Outputs [activeInputIndex + 5 onwards] chunk the fund in 128-byte segments
7. Output [activeInputIndex + 3] must be the new fund contract with proper parameters

**CashScript Excerpt** (condensed):
```cashscript
function broadcast(bytes fund) {
    require(tx.inputs[0].outpointIndex == 0);
    require(tx.inputs[0].tokenCategory == 0x);

    require(tx.outputs[0].lockingBytecode == authHeadDestination);
    require(tx.outputs[0].tokenCategory == 0x);

    require(tx.inputs[this.activeInputIndex - 4].lockingBytecode == 
            new LockingBytecodeP2SH32(startupContract));

    // Public fund UTXO returns to self
    require(tx.inputs[this.activeInputIndex].tokenCategory == bytes(token + 0x02));
    require(tx.inputs[this.activeInputIndex].lockingBytecode == 
            tx.outputs[this.activeInputIndex + 4].lockingBytecode);

    // Parse and validate fund commitment
    bytes nft_fundCategory, bytes nft_next1 = fund.split(32);
    require(nft_fundCategory != 0x);
    require(nft_fundCategory == tx.inputs[0].outpointTransactionHash);
    bytes nft_fundAmount, bytes nft_next2 = nft_next1.split(8);
    require(int(nft_fundAmount) > 0);
    bytes nft_satoshis, bytes nft_assets = nft_next2.split(8);

    // [Asset sorting validation...]

    // Verify fund contract output
    require(tx.outputs[this.activeInputIndex + 3].lockingBytecode == 
            new LockingBytecodeP2SH32(hash256(...)));

    // Chunk fund data into outputs
    int lastOutput = this.activeInputIndex + 5;
    bytes fundRemaining = fund;
    do {
        int chunkSize = min(128, fundRemaining.length);
        bytes part, bytes fundNext = fundRemaining.split(chunkSize);
        require(tx.outputs[lastOutput].nftCommitment == part);
        lastOutput = lastOutput + 1;
        fundRemaining = fundNext;
    } while(fundRemaining.length > 0);
}
```

---

## Fund Execution Contracts

### 7. FundMint

**Purpose**: Creates fund-specific execution contracts for a fund thread

**Location**: [contracts/mint.cash](../fund-tokens-contracts/contracts/mint.cash)

**Parameters**:
- `validator` (bytes32) - Validator contract (TransactionManager) hash
- `inflowToken` (bytes32) - Inflow token category
- `outflowToken` (bytes32) - Outflow token category
- `fee` (bytes32) - Fee contract hash
- `managerContract` (bytes) - Fund manager contract bytecode
- `fundContract` (bytes) - Fund contract bytecode
- `assetContract` (bytes) - Asset contract bytecode

**Functions**:

#### `mintInflow()` / `mintOutflow()`

Mints the manager, fund, and asset contracts for a new fund thread.

**Validation** (mintInflow):
1. Previous input must be validator contract
2. Input UTXO must contain inflow token with capability "send"
3. Input UTXO returns to itself
4. Following input must have outflow token with capability "send"
5. Output must contain inflow token (fungible minting)
6. Output [activeInputIndex + 4] is the new manager contract

**CashScript Excerpt**:
```cashscript
pragma cashscript ~0.13.0;

contract FundMint(bytes32 validator, bytes32 inflowToken, bytes32 outflowToken, 
                  bytes32 fee, bytes managerContract, bytes fundContract, bytes assetContract)
{
    function mintInflow() {
        require(tx.inputs[this.activeInputIndex - 1].lockingBytecode == 
                new LockingBytecodeP2SH32(validator));

        // Inflow token input
        require(tx.inputs[this.activeInputIndex].lockingBytecode == 
                tx.outputs[this.activeInputIndex].lockingBytecode);
        require(tx.inputs[this.activeInputIndex].tokenCategory == (inflowToken + 0x02));
        require(tx.inputs[this.activeInputIndex].tokenCategory == 
                tx.outputs[this.activeInputIndex].tokenCategory);

        // Outflow token input
        require(tx.inputs[this.activeInputIndex + 1].tokenCategory == (outflowToken + 0x02));

        // Extract fund details from outputs
        bytes fundCategory, bytes fundHash = 
            tx.outputs[this.activeInputIndex + 4].nftCommitment.split(32);

        // [Create manager contract instance...]
        require(tx.outputs[this.activeInputIndex + 4].lockingBytecode == 
                new LockingBytecodeP2SH32(hash256(...)));
    }
}
```

---

## Per-Fund Execution Contracts

### 8. FundManager (TransactionManager)

**Purpose**: Coordinates inflow/outflow transactions and validates contract threading

**Location**: [contracts/manager.cash](../fund-tokens-contracts/contracts/manager.cash)

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

**CashScript Excerpt**:
```cashscript
function inflow(bytes fund) {
    // Verify inflow token for signal
    require(tx.inputs[this.activeInputIndex].tokenCategory == inflowToken);
    // Return to self
    require(tx.inputs[this.activeInputIndex].lockingBytecode == 
            tx.outputs[this.activeInputIndex].lockingBytecode);
    require(tx.inputs[this.activeInputIndex].tokenCategory == 
            tx.outputs[this.activeInputIndex].tokenCategory);
    require(tx.inputs[this.activeInputIndex].nftCommitment == 
            tx.outputs[this.activeInputIndex].nftCommitment);
    require(tx.inputs[this.activeInputIndex].nftCommitment == 
            bytes(fundCategory + fundHash));
    require(hash256(fund) == fundHash);

    // Fund contract is next input
    int fundInputIndex = this.activeInputIndex + 1;
    require(tx.inputs[fundInputIndex].lockingBytecode == 
            new LockingBytecodeP2SH32(hash256(...)));

    // Parse fund details
    bytes nft_fundCategory, bytes nft_next1 = fund.split(32);
    require(nft_fundCategory == fundCategory);
    bytes nft_fundAmount, bytes nft_next2 = nft_next1.split(8);
    int fundAmount = int(nft_fundAmount);

    // Calculate fund tokens released
    int fundReleasedAmount = tx.inputs[fundInputIndex].tokenAmount - 
                              tx.outputs[fundInputIndex].tokenAmount;
    require(fundReleasedAmount % fundAmount == 0);
    fundReleasedAmount = fundReleasedAmount / fundAmount;

    // Fee verification
    require(tx.inputs[fundInputIndex + 1].lockingBytecode == 
            new LockingBytecodeP2SH32(fee));
    // [Asset validation...]
}
```

#### `redeem(bytes fund)`

Validates an outflow (redemption) transaction.

Similar structure to `inflow()` but:
- Uses outflow token instead of inflow
- Fund tokens decreased (input > output)
- Assets released to user instead of acquired

---

### 9. Fund

**Purpose**: Holds fund tokens and calculates release amounts

**Location**: [contracts/fund.cash](../fund-tokens-contracts/contracts/fund.cash)

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
4. If output has no tokens: output category must be empty (no tokens)

**CashScript**:
```cashscript
pragma cashscript ~0.13.0;

contract Fund(bytes32 inflowToken, bytes32 outflowToken, bytes32 fundCategory, bytes32 fundHash)
{
    function mint() {
        require(tx.inputs[this.activeInputIndex - 1].tokenCategory == inflowToken);
        require(tx.inputs[this.activeInputIndex - 1].nftCommitment == 
                bytes(fundCategory + fundHash));

        require(tx.inputs[this.activeInputIndex].lockingBytecode == 
                tx.outputs[this.activeInputIndex].lockingBytecode);
        require(tx.inputs[this.activeInputIndex].tokenAmount > 
                tx.outputs[this.activeInputIndex].tokenAmount);

        if(tx.outputs[this.activeInputIndex].tokenAmount > 0) {
            require(tx.inputs[this.activeInputIndex].tokenCategory == fundCategory);
            require(tx.inputs[this.activeInputIndex].tokenCategory == 
                    tx.outputs[this.activeInputIndex].tokenCategory);
        } else {
            require(tx.outputs[this.activeInputIndex].tokenCategory == 0x);
        }
    }

    function redeem() {
        require(tx.inputs[this.activeInputIndex - 1].tokenCategory == outflowToken);
        require(tx.inputs[this.activeInputIndex - 1].nftCommitment == 
                bytes(fundCategory + fundHash));

        require(tx.inputs[this.activeInputIndex].lockingBytecode == 
                tx.outputs[this.activeInputIndex].lockingBytecode);
        require(tx.outputs[this.activeInputIndex].tokenCategory == fundCategory);
        require(tx.inputs[this.activeInputIndex].tokenAmount < 
                tx.outputs[this.activeInputIndex].tokenAmount);
    }
}
```

---

### 10. AssetManager

**Purpose**: Holds and releases individual fund assets

**Location**: [contracts/asset.cash](../fund-tokens-contracts/contracts/asset.cash)

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

**CashScript**:
```cashscript
pragma cashscript ~0.13.0;

contract AssetManager(bytes32 outflowToken, bytes32 fundHash, bytes32 assetCategory)
{
    function release() {
        bool outflowTokenSeen = false;
        int inputIndex = 0;
        do {
            if(tx.inputs[inputIndex].tokenCategory == outflowToken) {
                if(tx.inputs[inputIndex].nftCommitment.slice(32, 64) == fundHash) {
                    outflowTokenSeen = true;
                }
            }
            inputIndex = inputIndex + 1;
        } while(inputIndex < tx.inputs.length && !outflowTokenSeen);
        require(outflowTokenSeen);

        bytes32 satoshiAsset = 0x0000000000000000000000000000000000000000000000000000000000000000;
        if(assetCategory == satoshiAsset) {
            require(tx.inputs[this.activeInputIndex].tokenCategory == 0x);
        } else {
            require(tx.inputs[this.activeInputIndex].tokenCategory == assetCategory);
        }
    }
}
```

---

### 11. FeeManager

**Purpose**: Validates and routes fee payments

**Location**: [contracts/fee.cash](../fund-tokens-contracts/contracts/fee.cash)

**Parameters**:
- `authToken` (bytes32) - Authorization token (owner) for close operation
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

#### `close()`

Allows authorized user to burn remaining fee tokens.

**Validation**:
1. At least one input must have authToken
2. No output can have feeToken (burned)

**CashScript Excerpt**:
```cashscript
pragma cashscript ~0.13.0;

contract FeeManager(bytes32 authToken, bytes destination, bytes32 feeToken, int defaultValue)
{
    function pay() {
        // UTXO returns to self
        require(tx.inputs[this.activeInputIndex].lockingBytecode == 
                tx.outputs[this.activeInputIndex].lockingBytecode);
        require(tx.inputs[this.activeInputIndex].tokenCategory == 
                tx.outputs[this.activeInputIndex].tokenCategory);
        require(tx.inputs[this.activeInputIndex].nftCommitment == 
                tx.outputs[this.activeInputIndex].nftCommitment);

        if(tx.inputs[this.activeInputIndex].tokenCategory == feeToken) {
            // Parse fee commitment
            bytes fee_category, bytes fee_next1 = 
                tx.inputs[this.activeInputIndex].nftCommitment.split(32);
            bytes fee_amount, bytes fee_destination = fee_next1.split(8);

            if(fee_destination.length > 0) {
                require(tx.outputs[this.activeInputIndex + 1].lockingBytecode == fee_destination);
            } else {
                require(tx.outputs[this.activeInputIndex + 1].lockingBytecode == destination);
            }

            if(int(fee_category) == 0) {
                require(tx.outputs[this.activeInputIndex + 1].value == int(fee_amount));
            } else {
                require(tx.outputs[this.activeInputIndex + 1].tokenCategory == fee_category);
                require(tx.outputs[this.activeInputIndex + 1].tokenAmount == int(fee_amount));
            }
        } else {
            require(tx.outputs[this.activeInputIndex + 1].lockingBytecode == destination);
            require(tx.outputs[this.activeInputIndex + 1].value == defaultValue);
        }
    }

    function close() {
        bool authorized = false;
        int inputIndex = 0;
        do {
            if(tx.inputs[inputIndex].tokenCategory == authToken) {
                authorized = true;
            }
            inputIndex = inputIndex + 1;
        } while(inputIndex < tx.inputs.length && !authorized);
        require(authorized, "unauthorized user");

        int outputIndex = 0;
        do {
            require(tx.outputs[outputIndex].tokenCategory != feeToken);
            outputIndex = outputIndex + 1;
        } while(outputIndex < tx.outputs.length);
    }
}
```

---

## Contract State Transitions

### Inflow Transaction (Minting)

```
Manager (inflow token) + Fund (fund tokens) + Fee
  ↓
Manager validates: inflow token + fund commitment
Fund validates: token release amount
Fee validates: payment routing
  ↓
Manager → Manager (returns with inflow token)
Fund → Fund (returns with fewer tokens)
Fee → Fee (returns with fee token intact)
Asset 1 → User (receives satoshis/tokens)
Asset 2 → User (receives satoshis/tokens)
Asset N → User (receives satoshis/tokens)
User → User (receives fund tokens)
```

### Outflow Transaction (Redemption)

```
Fund (fund tokens) + Manager (outflow token) + Fee + Assets
  ↓
Manager validates: outflow token + fund commitment
Fund validates: token collection amount
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
