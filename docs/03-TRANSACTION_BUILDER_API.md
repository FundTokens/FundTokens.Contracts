# Transaction Builder API Reference

This document provides detailed API reference for the three transaction builders used to interact with FundTokens contracts.

## Overview

The FundTokens system provides three transaction builder classes that extend CashScript's `TransactionBuilder`:

1. **SystemTransactionBuilder** - System initialization and maintenance
2. **PublicFundTransactionBuilder** - Fund creation and broadcasting
3. **FundTokenTransactionBuilder** - Fund inflow/outflow (minting/redemption)

Each builder abstracts contract interactions and transaction composition.

---

## SystemTransactionBuilder

**Location**: [lib/SystemTransactionBuilder.js](../fund-tokens-contracts/lib/SystemTransactionBuilder.js)

Handles system-level operations: initialization and fee token creation.

### Constructor

```javascript
new SystemTransactionBuilder({
    provider,           // CashScript Provider instance
    system,             // System configuration object
    logger,             // Optional: logger instance (default: console)
    allowImplicitFungibleTokenBurn // Optional: CashScript option
})
```

**System Configuration**:

```javascript
{
    inflow: '0x...',           // 256-bit hex string - inflow token category
    outflow: '0x...',          // 256-bit hex string - outflow token category
    publicFund: '0x...',       // 256-bit hex string - public fund token category
    authHead: '0x...',         // 256-bit hex string - auth head token category
    owner: '0x...',            // 256-bit hex string - owner token category
    fees: {
        create: {
            nft: '0x...',      // 256-bit hex - create fee token category
            value: 10000n      // bigint - create fee in satoshis
        },
        execute: {
            nft: '0x...',      // 256-bit hex - execute fee token category
            value: 100000n     // bigint - execute fee in satoshis
        }
    }
}
```

### Methods

#### `getContracts()`

Returns compiled contract instances.

**Returns**:
```javascript
{
    startupContract: Contract,
    mintContract: Contract,
    publicFundContract: Contract,
    inflowHoldingContract: Contract,
    outflowHoldingContract: Contract,
    publicFundHoldingContract: Contract,
    mintCreateFundFeeContract: Contract,
    createFundFeeContract: Contract,
    mintExecuteFundFeeContract: Contract,
    executeFundFeeContract: Contract,
    authHeadVaultContract: Contract,
    feeVaultContract: Contract
}
```

#### `addInitializeSystem()`

Creates system genesis threads.

**When to use**: Initial system setup, called once.

**Transaction structure**:
- Inputs: Genesis tokens (inflow, outflow, publicFund, fees, auth)
- Outputs: System thread UTXOs with minting capability

**Example**:
```javascript
const transaction = new SystemTransactionBuilder({ provider, system });
transaction
    .addInputs(genesisInputs, ownerWallet.signatureTemplate.unlockP2PKH())
    .addInitializeSystem()
    .addInput(authUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
    .addInput(feeUtxo, ownerWallet.signatureTemplate.unlockP2PKH())
    .addOutput({
        to: ownerWallet.tokenAddress,
        amount: DustAmount,
        token: {
            category: system.owner,
            amount: 0n,
            nft: { capability: 'none', commitment: '' }
        }
    });

const response = await transaction.send();
```

#### `addSystemThreads()`

Adds new execution threads for inflow, outflow, and public fund operations.

**When to use**: When existing threads are congested, called periodically.

**Preconditions**:
- No inputs/outputs added yet

**Transaction structure**:
- Inputs: Holding contract threads (inflow, outflow, publicFund)
- Outputs: New thread UTXOs with minting capability, startup UTXO

**Example**:
```javascript
const transaction = new SystemTransactionBuilder({ provider, system });
await transaction.addSystemThreads();
await transaction.addCreateFundFee();
await transaction.addExecuteFundFee();
transaction.addInput(feeUtxo, wallet.signatureTemplate.unlockP2PKH());
transaction.addInput(authUtxo, wallet.signatureTemplate.unlockP2PKH());
transaction.addOutput({
    to: wallet.tokenAddress,
    amount: DustAmount,
    token: authUtxo.token,
});

await transaction.send();
```

#### `addCreateFundFee()`

Creates a fund creation fee token.

**When to use**: Called with `addSystemThreads()` to create fee source.

**Preconditions**:
- Called after `addSystemThreads()`
- System already initialized

**Effects**:
- Adds inputs from mint create fee contract
- Adds outputs with fee token NFT

#### `addExecuteFundFee()`

Creates a fund execution fee token.

**When to use**: Called with `addSystemThreads()` alongside `addCreateFundFee()`.

**Preconditions**:
- Called after `addSystemThreads()`

**Effects**:
- Adds inputs from mint execute fee contract
- Adds outputs with fee token NFT

---

## PublicFundTransactionBuilder

**Location**: [lib/PublicFundTransactionBuilder.js](../fund-tokens-contracts/lib/PublicFundTransactionBuilder.js)

Handles fund creation and public broadcasting.

### Constructor

```javascript
new PublicFundTransactionBuilder({
    provider,    // CashScript Provider instance
    system,      // System configuration object (same as SystemTransactionBuilder)
    logger       // Optional: logger instance
})
```

### Methods

#### `getContracts()`

Returns fund creation contracts.

**Returns**:
```javascript
{
    startupContract: Contract,
    mintContract: Contract,
    createFundFeeContract: Contract,
    executeFundFeeContract: Contract,
    publicFundContract: Contract,
    feeVaultContract: Contract,
    authHeadVaultContract: Contract
}
```

#### `addBroadcast(options)`

Creates a new fund by broadcasting its parameters on-chain.

**Parameters**:
```javascript
{
    fund: {
        category: '0x...',      // 256-bit fund token category (usually genesis txid)
        amount: 10n,            // Fund token divisor (e.g., 10 = each token = 1/10 of fund)
        satoshis: 1000n,        // Bitcoin per fund token (0 if no Bitcoin component)
        assets: [               // Array of assets (sorted by category)
            {
                category: '0x...',   // Token category
                amount: 2n          // Token amount per fund token
            },
            {
                category: '0x...',
                amount: 5n
            }
        ]
    },
    payBy: '0x...'    // Optional: token category to pay fee with (default: Bitcoin)
}
```

**Preconditions**:
- First input must be added before calling (genesis transaction)
- First input must be a genesis UTXO (vout == 0, no tokens)
- No outputs added yet

**Transaction structure**:
- Inputs: Genesis UTXO, startup, inflow, outflow, publicFund, fee
- Outputs: 
  - Auth head output
  - Startup UTXO (returned)
  - Inflow/outflow tokens (minted)
  - Fee output
  - Manager, inflow/outflow, and fund contract instances
  - Public fund data chunks (one per 128 bytes of fund data)

**Fund Creation Validation** (performed by contract):
1. Fund amount must be > 0
2. Satoshis must be 0 or between 1,000 and 21,000,000 BTC
3. Assets must be sorted by category
4. Each asset amount must be > 0

**Example**:
```javascript
const fund = {
    category: '7777777777777777777777777777777777777777777777777777777777777777',
    amount: 10n,
    satoshis: 1000n,
    assets: [
        { category: '8888888888888888888888888888888888888888888888888888888888888888', amount: 2n },
        { category: '9999999999999999999999999999999999999999999999999999999999999999', amount: 3n }
    ]
};

const transaction = new PublicFundTransactionBuilder({ provider, system });
transaction.addInput(genesisUtxo, wallet.signatureTemplate.unlockP2PKH());
await transaction.addBroadcast({ fund, payBy });

await transaction.send();
```

**Output**: 
- Returns transaction reference with inputs/outputs prepared
- Fund token category committed in inflow/outflow NFTs
- Fund details broadcast in `PublicFund` contract outputs

---

## FundTokenTransactionBuilder

**Location**: [lib/FundTokenTransactionBuilder.js](../fund-tokens-contracts/lib/FundTokenTransactionBuilder.js)

Handles fund operations: minting (inflow) and redemption (outflow).

### Constructor

```javascript
new FundTokenTransactionBuilder({
    provider,   // CashScript Provider instance
    system,     // System configuration object with fee info:
                // { inflow, outflow, owner, fee: { nft, value } }
    logger,     // Optional: logger instance
    fund        // Fund specification object
})
```

**Fund Specification**:
```javascript
{
    category: '0x...',          // Fund token category
    amount: 10n,                // Fund token divisor
    satoshis: 1000n,            // Bitcoin per fund token
    assets: [                   // Asset array (sorted by category)
        {
            category: '0x...',
            amount: 2n
        }
    ]
}
```

### Methods

#### `getContracts()`

Returns fund-specific contract instances.

**Returns**:
```javascript
{
    managerContract: Contract,          // FundManager instance
    fundContract: Contract,             // Fund instance
    satoshiAssetContract: Contract,     // AssetManager for Bitcoin (if applicable)
    assetContracts: [Contract],         // Array of AssetManager instances
    feeContract: Contract,              // FeeManager instance
    feeVaultContract: Contract          // SimpleVault for fees
}
```

#### `addInflow(options)`

Mints fund tokens by depositing underlying assets.

**Parameters**:
```javascript
{
    amount: 2n,         // Number of fund tokens to mint
    payBy: '0x...'      // Optional: token category to pay fee with (default: Bitcoin)
}
```

**Preconditions**:
- Transaction must have matching input/output counts
- Calling code is responsible for adding outputs for:
  - Bitcoin change
  - Fund token recipient output
  - Token change

**Transaction structure**:
- Inputs:
  - Inflow manager token (signals thread)
  - Fund token UTXO (holds minting supply)
  - Fee UTXO
- Outputs:
  - Inflow manager (returned)
  - Fund tokens (decreased, returned to contract)
  - Fee outputs
  - Satoshi outputs (if Bitcoin component)
  - Asset outputs (for each asset)

**Validation** (performed by contracts):
1. Inflow token present (verifies correct thread)
2. Fund commitment matches
3. Fund token reduction = amount × fund_amount
4. Assets prepared for user receipt
5. Fee validated and computed

**Example**:
```javascript
const builder = new FundTokenTransactionBuilder({
    provider,
    system: { inflow, outflow, owner, fee },
    fund: { category, amount: 10n, satoshis: 1000n, assets: [...] }
});

await builder.addInflow({
    amount: 2n,
    payBy: bitcoinCategory
});

// User must prepare inputs:
// - Bitcoin to pay fee
// - Assets to deposit (matched to fund)

// User must add outputs:
// - Recipient address for fund tokens
// - Change outputs

await transaction.send();
```

**Effect**:
- Mints `amount` fund tokens for user
- Consumes assets from user
- Deducts fee
- User receives 2 fund tokens + change

#### `addOutflow(options)`

Redeems fund tokens to withdraw underlying assets.

**Parameters**:
```javascript
{
    amount: 1n,         // Number of fund tokens to redeem
    payBy: '0x...',     // Optional: token category for fee payment
    bufferHex: '0x...'  // Optional: script buffer for density (advanced)
}
```

**Preconditions**:
- Outflow tokens must be available
- Fund UTXO must exist (even if empty)
- Assets must be available in AssetManager contracts
- Calling code responsible for:
  - Adding fund token inputs
  - Adding recipient outputs for assets
  - Adding change outputs

**Transaction structure**:
- Inputs:
  - Outflow manager token (signals thread)
  - Fund token UTXO (holds current supply)
  - Fee UTXO
  - Satoshi asset inputs (if Bitcoin in fund)
  - Token asset inputs (one per asset)
- Outputs:
  - Outflow manager (returned)
  - Fund tokens (increased, returned)
  - Fee outputs
  - Satoshi change (if needed)
  - Asset change (if over-collateralized)

**Validation** (performed by contracts):
1. Outflow token present (verifies thread)
2. Fund tokens collected: increase in output = amount × fund_amount
3. Assets released from managers
4. Fee validated
5. Satoshis computed: amount × satoshis_per_token
6. Token amounts computed: amount × asset_amount_per_token

**Asset Selection Logic**:
- Selects statoshi/token UTXOs with largest amounts first
- Continues until enough to cover redemption
- Returns change if over-collateralized

**Example**:
```javascript
const builder = new FundTokenTransactionBuilder({
    provider,
    system: { inflow, outflow, owner, fee },
    fund
});

await builder.addOutflow({
    amount: 1n,
    payBy: bitcoinCategory
});

// User must add inputs:
// - Fund token UTXO(s) to redeem
// - Bitcoin for fee

// System automatically handles:
// - Finding satoshi/asset UTXOs
// - Computing required amounts
// - Preparing asset release

await transaction.send();
```

**Effect**:
- Burns `amount` fund tokens
- Releases corresponding assets
- Deducts fee
- User receives assets as specified by fund

---

## Utility Functions

**Location**: [lib/utils.js](../fund-tokens-contracts/lib/utils.js)

### Fund Encoding/Decoding

#### `getFundHex(fund): string`

Encodes fund specification to hex string.

**Format** (little-endian uint64 for amounts):
```
category (64 hex) | amount (16 hex) | satoshis (16 hex) | 
[asset_category (64 hex) | asset_amount (16 hex)]...
```

**Example**:
```javascript
const fund = {
    category: '7777777777777777777777777777777777777777777777777777777777777777',
    amount: 10n,
    satoshis: 1000n,
    assets: [
        { category: '8888888888888888888888888888888888888888888888888888888888888888', amount: 2n }
    ]
};

const hex = getFundHex(fund);
// Returns: '7777...0a00000000000000e803000000...0200000000000000'
```

#### `getFundBin(fund): Uint8Array`

Encodes fund specification to binary.

#### `decodeFund(hex): object`

Decodes fund from hex string.

**Return**:
```javascript
{
    category: '0x...',
    amount: 10n,
    satoshis: 1000n,
    assets: [...]
}
```

#### `hashFund(fund): string`

Returns SHA256 double-hash of fund specification (hex).

#### `encodeFee(options): string`

Encodes fee specification to NFT commitment hex.

**Parameters**:
```javascript
{
    category: '0x...',      // Token category (or undefined for default)
    amount: 10000n,         // Fee amount
    destination: 'bchtest:...' // Optional: address override
}
```

**Format**:
```
category (64 hex) | amount (16 hex) | destination_locking_bytecode (0+ hex)
```

#### `decodeFee(hex): object`

Decodes fee from NFT commitment hex.

**Return**:
```javascript
{
    category: '0x...',           // Fee category
    amount: 10000n,              // Fee amount
    destination: 'bchtest:...'   // Optional: destination address
}
```

### Fee Selection

#### `getBestFee(options): Promise<FeeInfo>`

Selects the lowest-cost available fee UTXO.

**Parameters**:
```javascript
{
    feeVaultContract: Contract,     // Fee vault contract
    feeContract: Contract,          // Fee manager contract
    payBy: '0x...',                 // Optional: preferred token category
    fee: { nft, value },            // Fee specification
    owner: '0x...'                  // Owner token category
}
```

**Return**:
```javascript
{
    isBitcoin: boolean,         // Fee paid in satoshis
    amount: bigint,             // Fee amount
    destination: 'bchtest:...', // Fee destination
    utxo: UTXO,                 // Selected UTXO
    outputs: [{ ... }]          // Pre-built fee outputs
}
```

**Behavior**:
1. Collects fee UTXOs (either Bitcoin or fee token NFTs)
2. Filters by requested payment method
3. Sorts by ascending amount (lowest first)
4. Returns lowest-cost option
5. Pre-generates output UTXOs for inclusion in transaction

**Example**:
```javascript
const bestFee = await getBestFee({
    feeVaultContract,
    feeContract,
    payBy: bitcoinCategory,
    fee: { nft: feeTokenId, value: 10000n },
    owner: ownerToken
});

transaction.addInput(bestFee.utxo, contract.unlock.pay());
transaction.addOutputs(bestFee.outputs);
```

### Constants

**Location**: [lib/constants.js](../fund-tokens-contracts/lib/constants.js)

```javascript
export const DustAmount = 1000n;  // Minimum satoshis per UTXO

export const BitcoinCategory = '0'.repeat(64);  // Special "no token" category
```

---

## Common Patterns

### Minting Fund Tokens (Happy Path)

```javascript
// 1. Create builder for fund
const builder = new FundTokenTransactionBuilder({
    provider,
    system,
    fund: {
        category: fundTokenId,
        amount: 10n,
        satoshis: 1000n,
        assets: [...]
    }
});

// 2. Add transaction components
await builder.addInflow({
    amount: 2n,
    payBy 'bitcoinCategory'
});

// 3. Add user inputs/outputs
transaction
    .addInput(bitcoinUtxo, wallet.unlock())
    .addInputs(assetUtxos, wallet.unlock())
    .addOutput(userAddress, dustAmount, fundTokens)
    .addOutput(userAddress, change);

// 4. Send
const { txid } = await transaction.send();
```

### Redeeming Fund Tokens (Happy Path)

```javascript
// 1. Create builder
const builder = new FundTokenTransactionBuilder({
    provider,
    system,
    fund
});

// 2. Add redeem transaction
await builder.addOutflow({
    amount: 1n,
    payBy: bitcoinCategory
});

// 3. Add fund token input(s)
transaction
    .addInput(fundTokenUtxo, wallet.unlock())
    .addInput(bitcoinForFee, wallet.unlock())
    .addOutput(userAddress, ...assets);

// 4. Send
const { txid } = await transaction.send();
```

### Creating a New Fund

```javascript
// 1. Create public fund builder
const publicBuilder = new PublicFundTransactionBuilder({
    provider,
    system
});

// 2. Add genesis input
const genesisUtxo = ...; // From first UTXO of fund token genesis
transaction.addInput(genesisUtxo, wallet.unlock());

// 3. Broadcast fund
await publicBuilder.addBroadcast({
    fund: {
        category: genesisUtxo.txid,
        amount: 10n,
        satoshis: 1000n,
        assets: [...]
    },
    payBy: bitcoinCategory
});

// 4. Send
const { txid } = await transaction.send();
```

---

## Error Handling

Common errors and solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| "Missing required UTXO" | No matching thread token | Add new threads via `SystemTransactionBuilder` |
| "No acceptable fee UTXOs found" | Fee token unavailable | Create fee tokens or provide Bitcoin |
| "Asset sorting error" | Assets not in category order | Sort assets by category ascending |
| "Fund amount mismatch" | Token quantity not multiple of fund_amount | Ensure amount × fund_amount matches |
| "Asset amount insufficient" | Not enough assets held in contracts | Deposit more assets or reduce redemption |

---

## Performance Considerations

1. **Thread Randomization**: Builders select random available threads to distribute load
2. **Satoshi Asset Selection**: Outflow uses first satoshi UTXO with sufficient amount (selects by descending amount)
3. **Token Asset Selection**: Same as satoshi - picks largest first
4. **Transaction Size**: Depends on:
   - Number of assets in fund (adds ~45 bytes per asset for inputs/outputs)
   - Script buffer for complex transactions (optional bufferHex)
   - Fee token encoding length

**Typical sizes**:
- Inflow (2 assets): ~600 bytes
- Outflow (2 assets): ~800 bytes
- Fund creation: ~1200 bytes

---

## See Also

- [01-SYSTEM_ARCHITECTURE.md](01-SYSTEM_ARCHITECTURE.md) - High-level design
- [02-CONTRACT_SPECIFICATIONS.md](02-CONTRACT_SPECIFICATIONS.md) - Contract details
- [04-INTEGRATION_GUIDE.md](04-INTEGRATION_GUIDE.md) - End-to-end examples
