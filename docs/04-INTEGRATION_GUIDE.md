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
npm install @fundtokens/builders
```

### Environment Configuration

```javascript
import { Network, MockNetworkProvider } from 'cashscript';
import { PublicFundTransactionBuilder, FundTokenTransactionBuilder } from '@fundtokens/builders';

// For development/testing
const provider = new MockNetworkProvider({ updateUtxoSet: true });
const network = Network.MOCKNET;

// For chipnet/mainnet
// const provider = new ElectrumNetworkProvider({ url: 'wss://...' });
// const network = Network.MAINNET;
```

## Fund Lifecycle

### Step 1: Create a Fund

Create a new fund definition and broadcast it on-chain:

```javascript
import { PublicFundTransactionBuilder } from '@fundtokens/builders';

async function createFund({ provider, system, wallet, fundDefinition }) {
    /**
     * Fund Definition Example:
     * A fund holding 1,000 satoshis + 2 XYZ tokens + 5 DEF tokens
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
        payBy: 'Bitcoin'  // Pay with Bitcoin
    });

    // Add fee UTXOs if needed
    transaction.addInput(
        { txid: 'any', vout: 0, satoshis: 50000n },
        wallet.signatureTemplate.unlockP2PKH()
    );

    transaction.addBchChangeOutputIfNeeded({ to: wallet.address })

    const { txid } = await transaction.send();
    console.log('Fund created:', txid);

    return { fund, fundTxid: txid };
}
```

**Output**: 
- Fund token category established
- Inflow/outflow threads created
- Fund parameters broadcast on-chain
- Fund prepared for all operations

---

## User Operations

### Minting Fund Tokens (Inflow)

User deposits underlying assets to receive fund tokens:

```javascript
import { FundTokenTransactionBuilder, BitcoinCategory } from '@fundtokens/builders';

async function userMintFundTokens({
    provider,
    system,
    wallet,
    fund,
    fundTokensToMint = 2n
}) {
    const transaction = new FundTokenTransactionBuilder({
        provider,
        system: {
            ...system,
            fee: system.fees.execute
        },
        fund
    });

    // Add inflow transaction
    await transaction.addInflow({
        amount: fundTokensToMint,
        //payBy defaults to Bitcoin or specify a token category
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
        }
    });

    transaction.addBchChangeOutputIfNeeded({ to: wallet.address });

    // Asset change (if over-deposited)

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
import { FundTokenTransactionBuilder, BitcoinCategory } from '@fundtokens/builders';

async function userRedeemFundTokens({
    provider,
    system,
    wallet,
    fund,
    fundTokensToRedeem = 1n
}) {
    const transaction = new FundTokenTransactionBuilder({
        provider,
        system: {
            ...system,
            fee: system.fees.execute
        },
        fund
    });

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

    // Add outputs for redeemed assets

    // User receives token assets
    // Token assets
    // Bitcoin redeemed + change

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
        // ... up to ~30 assets (standard relay limits)
        // For more assets, create separate funds or combine
    ]
};
```

**Note**: Maximum ~30 assets per fund due to standard relay limits.

---

## Error Handling

### Common Errors and Solutions

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
        console.log('1. Use Bitcoin');
        console.log('2. Use available fee token');
        console.log('3. Add Fee Manager UTXO for default fee');
    }
}
```

---

## Testing

### Unit Testing with Vitest

```javascript
// test/fund.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { MockNetworkProvider, Network } from 'cashscript';
import { FundTokenTransactionBuilder } from '@fundtokens/builders';
import 'cashscript/vitest';

describe('FundTokens', () => {
    let provider;
    let system;
    let wallet;

    beforeEach(async () => {
        provider = new MockNetworkProvider({ updateUtxoSet: true });

        system = {
            inflow: '1111111111111111111111111111111111111111111111111111111111111111',
            outflow: '222...',
            authorization: '333...',
            fees: {
                create: { nft: '444...', value: 10000n },
                execute: { nft: '555...', value: 100000n }
            }
        };

        wallet = generateWallet(Network.MOCKNET);
    });

    it('should mint fund tokens', async ({ expect }) => {
        // Setup fund
        const fund = {
            category: '666...',
            amount: 10n,
            satoshis: 1000n,
            assets: [{ category: '777...', amount: 2n }]
        };

        // Create transaction
        const builder = new FundTokenTransactionBuilder({
            provider,
            system,
            fund
        });

        await builder.addInflow({
            amount: 1n,
            // payBy - defaults to bitcoin
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

1. **Invoke Builder First**: Invoke the builder helper method first or as soon as possible
1. **Always Sort Assets**: Assets must be in ascending category order
2. **Validate Fund Amounts**: Ensure divisor > 0, satoshis valid range
4. **Error Handling**: Wrap operations in try-catch, handle specific errors
5. **Fee Management**: Monitor fee UTXOs
6. **Dust Amount**: Always send at least 1,000-1,065 satoshis per UTXO
7. **Test First**: Verify on testnet/chipnet before mainnet

---

## See Also

- [01-SYSTEM_ARCHITECTURE.md](01-SYSTEM_ARCHITECTURE.md) - System design
- [02-CONTRACT_SPECIFICATIONS.md](02-CONTRACT_SPECIFICATIONS.md) - Contract details
- [03-TRANSACTION_BUILDER_API.md](03-TRANSACTION_BUILDER_API.md) - API reference
- [05-FLOW_DIAGRAMS.md](05-FLOW_DIAGRAMS.md) - Visual transaction flows
