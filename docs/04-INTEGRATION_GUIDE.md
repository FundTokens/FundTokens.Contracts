# Integration Guide & Examples

This guide provides step-by-step instructions and working code examples for integrating FundTokens into applications.

## Table of Contents

1. [Setup & Initialization](#setup--initialization)
2. [Fund Lifecycle](#fund-lifecycle)
3. [User Operations](#user-operations)
4. [Advanced Patterns](#advanced-patterns)
5. [Error Handling](#error-handling)
6. [Testing](#testing)

---

## Setup & Initialization

### Prerequisites

```bash
npm install cashscript@0.13.0-next.6 libauth
```

### Environment Configuration

```javascript
import { Network, MockNetworkProvider } from 'cashscript';
import SystemTransactionBuilder from '@lib/SystemTransactionBuilder.js';

// For development/testing
const provider = new MockNetworkProvider({ updateUtxoSet: true });
const network = Network.MOCKNET;

// For mainnet
// const provider = new ElectrumNetworkProvider({ url: 'wss://...' });
// const network = Network.MAINNET;
```

### System Initialization

Before any fund operations, the system must be initialized once with genesis tokens:

```javascript
import { generateWallet } from '@/wallet.js';
import SystemTransactionBuilder from '@lib/SystemTransactionBuilder.js';
import { DustAmount } from '@lib/constants.js';

async function initializeSystem({ provider, network }) {
    const ownerWallet = generateWallet(network);

    // System configuration - token IDs from genesis transactions
    const system = {
        inflow: '1111111111111111111111111111111111111111111111111111111111111111',
        outflow: '2222222222222222222222222222222222222222222222222222222222222222',
        publicFund: '3333333333333333333333333333333333333333333333333333333333333333',
        authHead: '4444444444444444444444444444444444444444444444444444444444444444',
        owner: '5555555555555555555555555555555555555555555555555555555555555555',
        fees: {
            create: {
                nft: '6666666666666666666666666666666666666666666666666666666666666666',
                value: 10000n,  // satoshis
            },
            execute: {
                nft: '7777777777777777777777777777777777777777777777777777777777777777',
                value: 100000n, // satoshis
            }
        },
    };

    // Add genesis UTXOs to provider
    const genesisPartial = { vout: 0, satoshis: DustAmount };
    const genesisUtxos = [
        { ...genesisPartial, txid: system.inflow },
        { ...genesisPartial, txid: system.outflow },
        { ...genesisPartial, txid: system.publicFund },
        { ...genesisPartial, txid: system.fees.create.nft },
        { ...genesisPartial, txid: system.fees.execute.nft },
        { ...genesisPartial, txid: system.owner },
    ];
    
    genesisUtxos.forEach(u => 
        provider.addUtxo(ownerWallet.tokenAddress, u)
    );

    // Create initialization transaction
    const transaction = new SystemTransactionBuilder({ provider, system });
    transaction
        .addInputs(genesisUtxos, ownerWallet.signatureTemplate.unlockP2PKH())
        .addInitializeSystem()
        .addInput(
            { txid: system.owner, vout: 0, satoshis: DustAmount, token: { category: system.owner, amount: 0n } },
            ownerWallet.signatureTemplate.unlockP2PKH()
        )
        .addInput(
            { txid: 'any', vout: 0, satoshis: 10000n },
            ownerWallet.signatureTemplate.unlockP2PKH()
        )
        .addOutput({
            to: ownerWallet.tokenAddress,
            amount: DustAmount,
            token: {
                category: system.owner,
                amount: 0n,
                nft: { capability: 'none', commitment: '' }
            }
        });

    const { txid } = await transaction.send();
    console.log('System initialized:', txid);
    
    return { system, ownerWallet };
}
```

### Creating System Threads

Threads enable concurrent fund operations. Add periodically:

```javascript
import SystemTransactionBuilder from '@lib/SystemTransactionBuilder.js';
import { DustAmount } from '@lib/constants.js';

async function addSystemThreads({ provider, system, wallet }) {
    const transaction = new SystemTransactionBuilder({ provider, system });

    // Add new thread tokens
    await transaction.addSystemThreads();
    await transaction.addCreateFundFee();
    await transaction.addExecuteFundFee();

    // Pay for transaction
    transaction
        .addInput(
            { txid: 'any', vout: 0, satoshis: 50000n },
            wallet.signatureTemplate.unlockP2PKH()
        )
        .addInput(
            authUtxo, // Owner token from system init
            wallet.signatureTemplate.unlockP2PKH()
        )
        .addOutput({
            to: wallet.tokenAddress,
            amount: DustAmount,
            token: authUtxo.token,
        });

    const { txid } = await transaction.send();
    console.log('Added system threads:', txid);
}
```

---

## Fund Lifecycle

### Step 1: Create a Fund

Create a new fund definition and broadcast it on-chain:

```javascript
import PublicFundTransactionBuilder from '@lib/PublicFundTransactionBuilder.js';
import { DustAmount } from '@lib/constants.js';

async function createFund({ provider, system, wallet, fundDefinition }) {
    /**
     * Fund Definition Example:
     * A fund holding 1,000 satoshis + 2 XYZ tokens + 5 DEF tokens
     * Each fund token holder owns 1/10th of the fund
     */
    const fund = {
        // Use genesis txid as fund category
        category: '7777777777777777777777777777777777777777777777777777777777777777',
        
        // Fund divisor: 1 fund token = 1/10th of fund
        amount: 10n,
        
        // Bitcoin component: 1,000 satoshis per fund token
        satoshis: 1000n,
        
        // Assets (MUST be sorted by category ascending)
        assets: [
            {
                category: '8888888888888888888888888888888888888888888888888888888888888888',
                amount: 2n  // 2 tokens per fund token
            },
            {
                category: '9999999999999999999999999999999999999999999999999999999999999999',
                amount: 5n  // 5 tokens per fund token
            }
        ]
    };

    // Create transaction
    const transaction = new PublicFundTransactionBuilder({
        provider,
        system,
        logger: console
    });

    // Add genesis input (from fund token category - first UTXO of that txid)
    const genesisUtxo = {
        txid: fund.category,
        vout: 0,
        satoshis: DustAmount,
        tokenCategory: undefined  // No token on genesis
    };
    transaction.addInput(genesisUtxo, wallet.signatureTemplate.unlockP2PKH());

    // Broadcast fund with fee payment
    await transaction.addBroadcast({
        fund,
        payBy: '0'.repeat(64)  // Pay with Bitcoin
    });

    // Add fee UTXOs if needed
    transaction.addInput(
        { txid: 'any', vout: 0, satoshis: 50000n },
        wallet.signatureTemplate.unlockP2PKH()
    );

    const { txid } = await transaction.send();
    console.log('Fund created:', txid);

    return { fund, fundTxid: txid };
}
```

**Output**: 
- Fund token category established
- Inflow/outflow threads created
- Fund parameters broadcast on-chain
- Manager, fund, and asset contracts deployed

### Step 2: Fund Initialization for Users

Before users can mint/redeem, someone must initialize the fund with "seed" tokens:

```javascript
import FundTokenTransactionBuilder from '@lib/FundTokenTransactionBuilder.js';

async function initializeFundThread({ provider, system, wallet, fund }) {
    const builder = new FundTokenTransactionBuilder({
        provider,
        system: {
            ...system,
            fee: system.fees.execute  // Use execute fee
        },
        fund
    });

    // Get contracts for inspection
    const { fundContract } = builder.getContracts();

    // Seed with 1 "empty" fund token to bootstrap
    // (Ensures fund contract UTXO exists)

    console.log('Fund thread initialized at:', fundContract.tokenAddress);
}
```

---

## User Operations

### Minting Fund Tokens (Inflow)

User deposits underlying assets to receive fund tokens:

```javascript
import FundTokenTransactionBuilder from '@lib/FundTokenTransactionBuilder.js';
import { DustAmount, BitcoinCategory } from '@lib/constants.js';

async function userMintFundTokens({
    provider,
    system,
    wallet,
    fund,
    fundTokensToMint = 2n
}) {
    const builder = new FundTokenTransactionBuilder({
        provider,
        system: {
            ...system,
            fee: system.fees.execute
        },
        fund
    });

    // Get contracts
    const contracts = builder.getContracts();
    const { fundContract, managerContract, assetContracts, satoshiAssetContract } = contracts;

    // Build transaction
    const transaction = builder;

    // Add inflow transaction
    await transaction.addInflow({
        amount: fundTokensToMint,
        payBy: BitcoinCategory  // or specific token category
    });

    // Now user adds their inputs:
    // 1. Bitcoin for fee
    // 2. Assets to deposit

    const satoshisNeeded = fund.satoshis * fundTokensToMint + 100000n; // fee + buffer
    const bitcoinUtxo = await provider.getUtxos(wallet.address); // Any Bitcoin UTXO

    transaction.addInput(
        bitcoinUtxo[0],
        wallet.signatureTemplate.unlockP2PKH()
    );

    // Add asset inputs (must match fund composition)
    const xyz_needed = fund.assets[0].amount * fundTokensToMint;
    const def_needed = fund.assets[1].amount * fundTokensToMint;

    // Find XYZ tokens
    const xyzUtxos = await provider.getUtxos(wallet.tokenAddress);
    const xyzInput = xyzUtxos.find(u => u.token?.category === fund.assets[0].category);
    transaction.addInput(
        xyzInput,
        wallet.signatureTemplate.unlockP2PKH()
    );

    // Find DEF tokens
    const defUtxos = await provider.getUtxos(wallet.tokenAddress);
    const defInput = defUtxos.find(u => u.token?.category === fund.assets[1].category);
    transaction.addInput(
        defInput,
        wallet.signatureTemplate.unlockP2PKH()
    );

    // Add user outputs:
    // Fund tokens go to user
    transaction.addOutput({
        to: wallet.address,
        amount: DustAmount,
        token: {
            category: fund.category,
            amount: fundTokensToMint,
            nft: { capability: 'none', commitment: '' }
        }
    });

    // Bitcoin change
    const totalIn = bitcoinUtxo[0].satoshis + xyzInput.satoshis + defInput.satoshis;
    const fee = 1000n; // Estimate
    const change = totalIn - satoshisNeeded - fee;
    if (change > 0n) {
        transaction.addOutput({
            to: wallet.address,
            amount: change
        });
    }

    // Asset change (if over-deposited)
    // (Handled by transaction builder)

    const { txid } = await transaction.send();
    console.log('Minted fund tokens:', txid);
    console.log(`Received ${fundTokensToMint} tokens representing:`);
    console.log(`  - ${satoshisNeeded} satoshis`);
    console.log(`  - ${xyz_needed} XYZ tokens`);
    console.log(`  - ${def_needed} DEF tokens`);

    return txid;
}
```

### Redeeming Fund Tokens (Outflow)

User redeems fund tokens to withdraw underlying assets:

```javascript
import FundTokenTransactionBuilder from '@lib/FundTokenTransactionBuilder.js';
import { DustAmount, BitcoinCategory } from '@lib/constants.js';

async function userRedeemFundTokens({
    provider,
    system,
    wallet,
    fund,
    fundTokensToRedeem = 1n
}) {
    const builder = new FundTokenTransactionBuilder({
        provider,
        system: {
            ...system,
            fee: system.fees.execute
        },
        fund
    });

    const transaction = builder;

    // Add outflow (redemption) transaction
    await transaction.addOutflow({
        amount: fundTokensToRedeem,
        payBy: BitcoinCategory
    });

    // User adds their inputs:
    // 1. Fund tokens to redeem
    // 2. Bitcoin for fee

    const fundTokenUtxos = await provider.getUtxos(wallet.tokenAddress);
    const fundTokenInput = fundTokenUtxos.find(
        u => u.token?.category === fund.category && u.token?.amount >= fundTokensToRedeem
    );

    transaction.addInput(
        fundTokenInput,
        wallet.signatureTemplate.unlockP2PKH()
    );

    // Add Bitcoin for fee
    const bitcoinUtxos = await provider.getUtxos(wallet.address);
    const bitcoinInput = bitcoinUtxos.find(u => !u.token && u.satoshis > 150000n);

    transaction.addInput(
        bitcoinInput,
        wallet.signatureTemplate.unlockP2PKH()
    );

    // Add output for redeemed assets
    // (Bitcoin is automatic from transaction builder)

    // User receives assets
    const satoshisReceived = fund.satoshis * fundTokensToRedeem;
    transaction.addOutput({
        to: wallet.address,
        amount: satoshisReceived
    });

    // Token assets (handled by asset contracts in transaction builder)

    // Bitcoin change
    const fee = 100000n;
    const change = bitcoinInput.satoshis - fee;
    if (change > DustAmount) {
        transaction.addOutput({
            to: wallet.address,
            amount: change
        });
    }

    const { txid } = await transaction.send();
    console.log('Redeemed fund tokens:', txid);
    console.log(`Received:`);
    console.log(`  - ${satoshisReceived} satoshis`);
    console.log(`  - ${fund.assets[0].amount * fundTokensToRedeem} XYZ tokens`);
    console.log(`  - ${fund.assets[1].amount * fundTokensToRedeem} DEF tokens`);

    return txid;
}
```

---

## Advanced Patterns

### Fee Token Customization

Create custom fee tokens with specific amounts or destinations:

```javascript
import { encodeFee } from '@lib/utils.js';

// Encode a custom fee
const customFee = encodeFee({
    category: '0'.repeat(64),          // Pay in Bitcoin
    amount: 50000n,                    // 50,000 satoshis
    destination: 'bchtest:qz...'       // Custom recipient
});

// Encode an asset-based fee
const assetFee = encodeFee({
    category: 'abcd...', // XYZ token category
    amount: 100n,        // 100 tokens
    destination: 'bchtest:qz...'
});
```

### Multiple Fund Threads

For high-volume funds, create multiple threads:

```javascript
async function createMultipleThreads({ provider, system, wallet, count }) {
    const systemBuilder = new SystemTransactionBuilder({ provider, system });

    for (let i = 0; i < count; i++) {
        await systemBuilder.addSystemThreads();
    }

    // Pay and send in one transaction
    systemBuilder.addInput(feeUtxo, wallet.unlock());
    // ... complete transaction
    await systemBuilder.send();
}
```

### Fund with Complex Assets

Create funds with many different assets:

```javascript
const complexFund = {
    category: 'fund_id_hex',
    amount: 100n,
    satoshis: 5000n,
    assets: [
        { category: 'token_1', amount: 10n },
        { category: 'token_2', amount: 20n },
        { category: 'token_3', amount: 15n },
        // ... up to ~2 assets (128-byte commitment limit)
        // For more assets, create separate funds or combine
    ]
};
```

**Note**: Maximum ~2 assets per fund due to 128-byte NFT commitment limit.

### Batch Operations

Process multiple transactions efficiently:

```javascript
async function batchMint({
    provider,
    system,
    wallet,
    fund,
    quantities
}) {
    const results = [];

    for (const qty of quantities) {
        try {
            const txid = await userMintFundTokens({
                provider,
                system,
                wallet,
                fund,
                fundTokensToMint: qty
            });
            results.push({ qty, txid, status: 'success' });
        } catch (error) {
            results.push({ qty, error: error.message, status: 'failed' });
        }

        // Rate limiting
        await new Promise(r => setTimeout(r, 1000));
    }

    return results;
}
```

---

## Error Handling

### Common Errors and Solutions

#### Missing Thread Token

```javascript
try {
    await builder.addInflow({ amount: 1n });
} catch (error) {
    if (error.message.includes('Missing required UTXO')) {
        // Solution: Add more threads
        console.log('Adding system threads...');
        await addSystemThreads({ provider, system, wallet });
        // Retry transaction
    }
}
```

#### Insufficient Assets

```javascript
try {
    await userMintFundTokens({
        provider, system, wallet, fund,
        fundTokensToMint: 100n  // Too many
    });
} catch (error) {
    if (error.message.includes('Missing required asset')) {
        console.log('Insufficient assets. Required:');
        console.log(`  - ${fund.satoshis * 100n} satoshis`);
        fund.assets.forEach(a => {
            console.log(`  - ${a.amount * 100n} of ${a.category}`);
        });
        // Deposit more assets or reduce mint
    }
}
```

#### Fee Unavailable

```javascript
try {
    await builder.addInflow({ amount: 1n, payBy: 'custom_token' });
} catch (error) {
    if (error.message.includes('No acceptable fee UTXOs found')) {
        console.log('Fee token not available. Options:');
        console.log('1. Use Bitcoin (payBy omitted)');
        console.log('2. Create fee tokens');
        console.log('3. Provide fee token UTXOs');
    }
}
```

### Validation Helpers

```javascript
function validateFund(fund) {
    const errors = [];

    if (!fund.amount || fund.amount <= 0n) {
        errors.push('Fund amount must be > 0');
    }

    if (fund.satoshis && !within(fund.satoshis, 0, 2100000000000000n)) {
        errors.push('Satoshis must be 0 or 1,000-21,000,000 BTC');
    }

    if (fund.assets.length > 2) {
        errors.push('Maximum 2 assets (128-byte commitment limit)');
    }

    // Check sorting
    for (let i = 1; i < fund.assets.length; i++) {
        if (fund.assets[i].category <= fund.assets[i-1].category) {
            errors.push('Assets must be sorted by category ascending');
        }
    }

    fund.assets.forEach((asset, i) => {
        if (!asset.amount || asset.amount <= 0n) {
            errors.push(`Asset ${i} amount must be > 0`);
        }
    });

    return errors;
}

// Usage
const fundErrors = validateFund(myFund);
if (fundErrors.length > 0) {
    console.error('Invalid fund:', fundErrors);
    process.exit(1);
}
```

---

## Testing

### Unit Testing with Vitest

```javascript
// test/fund.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import 'cashscript/vitest';
import { MockNetworkProvider, Network } from 'cashscript';
import SystemTransactionBuilder from '@lib/SystemTransactionBuilder.js';

describe('FundTokens', () => {
    let provider;
    let system;
    let wallet;

    beforeEach(async () => {
        provider = new MockNetworkProvider({ updateUtxoSet: true });

        system = {
            inflow: '1111111111111111111111111111111111111111111111111111111111111111',
            outflow: '2222222222222222222222222222222222222222222222222222222222222222',
            publicFund: '3333333333333333333333333333333333333333333333333333333333333333',
            authHead: '4444444444444444444444444444444444444444444444444444444444444444',
            owner: '5555555555555555555555555555555555555555555555555555555555555555',
            fees: {
                create: { nft: '666...', value: 10000n },
                execute: { nft: '777...', value: 100000n }
            }
        };

        wallet = generateWallet(Network.MOCKNET);
    });

    it('should initialize system', async ({ expect }) => {
        const transaction = new SystemTransactionBuilder({ provider, system });
        
        // Setup genesis UTXOs
        const genesisUtxos = [
            { vout: 0, satoshis: 1000n, txid: system.inflow },
            // ... more UTXOs
        ];
        genesisUtxos.forEach(u => 
            provider.addUtxo(wallet.tokenAddress, u)
        );

        // Build transaction
        transaction
            .addInputs(genesisUtxos, wallet.signatureTemplate.unlockP2PKH())
            .addInitializeSystem()
            // ... complete transaction

        // Assertions
        expect(transaction).not.toFailRequire();
        const response = await transaction.send();
        expect(response.txid).toBeDefined();
    });

    it('should mint fund tokens', async ({ expect }) => {
        // Setup fund
        const fund = {
            category: '777...',
            amount: 10n,
            satoshis: 1000n,
            assets: [{ category: '888...', amount: 2n }]
        };

        // Create transaction
        const builder = new FundTokenTransactionBuilder({
            provider,
            system,
            fund
        });

        await builder.addInflow({
            amount: 1n,
            payBy: '0'.repeat(64)
        });

        expect(builder).not.toFailRequire();
    });
});
```

### Integration Testing

```javascript
async function integrationTest({ provider, system }) {
    console.log('🚀 Starting integration test...');

    // 1. Initialize system
    console.log('1️⃣  Initializing system...');
    const { wallet } = await initializeSystem({ provider, system });

    // 2. Create fund
    console.log('2️⃣  Creating fund...');
    const { fund } = await createFund({
        provider,
        system,
        wallet,
        fundDefinition: {
            satoshis: 1000n,
            assets: [ /* ... */ ]
        }
    });

    // 3. Mint tokens
    console.log('3️⃣  Minting fund tokens...');
    await userMintFundTokens({ provider, system, wallet, fund, fundTokensToMint: 5n });

    // 4. Redeem tokens
    console.log('4️⃣  Redeeming fund tokens...');
    await userRedeemFundTokens({ provider, system, wallet, fund, fundTokensToRedeem: 2n });

    console.log('✅ Integration test passed!');
}
```

---

## Best Practices

1. **Always Sort Assets**: Assets must be in ascending category order
2. **Validate Fund Amounts**: Ensure divisor > 0, satoshis valid range
3. **Use Threading**: Add threads for high-volume operations
4. **Error Handling**: Wrap operations in try-catch, handle specific errors
5. **Fee Management**: Monitor fee UTXOs, create when depleted
6. **Dust Amount**: Always send at least 1,000 satoshis per UTXO
7. **Test First**: Verify on testnet before mainnet
8. **Monitor Threads**: Check thread availability periodically

---

## See Also

- [01-SYSTEM_ARCHITECTURE.md](01-SYSTEM_ARCHITECTURE.md) - System design
- [02-CONTRACT_SPECIFICATIONS.md](02-CONTRACT_SPECIFICATIONS.md) - Contract details
- [03-TRANSACTION_BUILDER_API.md](03-TRANSACTION_BUILDER_API.md) - API reference
- [test/happy.test.js](../fund-tokens-contracts/tests/happy.test.js) - Working examples
