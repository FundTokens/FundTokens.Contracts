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
    inflow: '0x...',           // 32-bit hex string - inflow token category
    outflow: '0x...',          // 32-bit hex string - outflow token category
    publicFund: '0x...',       // 32-bit hex string - public fund token category
    authHead: '0x...',         // 32-bit hex string - auth head token category
    owner: '0x...',            // 32-bit hex string - owner token category
    fees: {
        create: {
            nft: '0x...',      // 32-bit hex string - create fee token category
            value: 10000n      // bigint - create fee in satoshis
        },
        execute: {
            nft: '0x...',      // 32-bit hex string - execute fee token category
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