# FundTokens.Contracts

A JavaScript library for interacting with FundTokens smart contracts on the Bitcoin Cash network. This library provides tools for creating, minting, and redeeming fund tokens while handling the complex multi-contract operations required by the FundTokens protocol.

## Features

- **Fund Creation**: Create new public funds with custom asset compositions
- **Token Minting**: Deposit assets to mint fund tokens
- **Token Redemption**: Withdraw assets by redeeming fund tokens
- **Multi-Contract Coordination**: Handles complex transaction flows across 13 smart contracts
- **Threaded Operations**: Supports high throughput through parallel execution threads
- **TypeScript Support**: Full TypeScript typing for better development experience

## Installation

```bash
npm install @fundtokens/builders
```

## Quick Start

### Creating a Public Fund

```javascript
import { PublicFundTransactionBuilder } from '@fundtokens/builders';

const publicBuilder = new PublicFundTransactionBuilder({ provider, system });
const fund = {
    category: genesisUtxo.txid,
    amount: 10n,
    satoshis: 1000n,
    assets: [{ category: 'asset_token_id', amount: 2n }]
};

// add user's genesis UTXO
await publicBuilder.addBroadcast({ fund });
// add additional IO
await publicBuilder.send();
```

### Minting Fund Tokens

```javascript
import { FundTokenTransactionBuilder } from '@fundtokens/builders';

const fundBuilder = new FundTokenTransactionBuilder({
    provider, system, fund
});

await fundBuilder.addInflow({ amount: 1n });
// Add user asset inputs and fund token outputs
await fundBuilder.send();
```

### Redeeming Fund Tokens

```javascript
const fundBuilder = new FundTokenTransactionBuilder({
    provider, system, fund
});

await fundBuilder.addOutflow({ amount: 1n });
// Add user inputs/outputs
await fundBuilder.send();
```

## Key Concepts

### Fund Lifecycle

* Fund Creation - Broadcast fund parameters
* Fund Operations - Mint and redeem tokens

## Security Model

* Non-Custodial: Funds held in contract UTXOs controlled by code
* Parameter Immutability: Fund details hashed and committed to tokens
* Contract Isolation: Each contract has single, verified responsibility
* Thread Authorization: Operations require matching token presence
* Atomic Validation: Multi-contract validation ensures consistency

## Requirements
* Bitcoin Cash network access

## License

Copyright (c) 2026 FoldingCash LLC, doing business as Fun(d)Tokens. All rights reserved.