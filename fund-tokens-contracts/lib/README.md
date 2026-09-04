# FundTokens Builders

A JavaScript library for interacting with FundTokens smart contracts on the Bitcoin Cash network. This library provides tools for discovering, creating, minting, and redeeming fund tokens while handling the complex multi-contract operations required by the FundTokens protocol. 

## Features

- **Public Fund Discovery**: Find trustlessly created funds
- **Fund Creation**: Create new public funds with custom asset compositions
- **Token Minting**: Deposit assets to mint fund tokens
- **Token Redemption**: Withdraw assets by redeeming fund tokens
- **Multi-Contract Coordination**: Handles complex transaction flows across many smart contracts

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

// Add user's genesis UTXO and additional inputs
// If adding outputs, ensure to add our identity output as the first output
await publicBuilder.addBroadcast({ fund });
// Add additional IO
// Add Bitcoin change
await publicBuilder.send();
```

### Minting Fund Tokens

```javascript
import { FundTokenTransactionBuilder } from '@fundtokens/builders';

const fundBuilder = new FundTokenTransactionBuilder({
    provider, system, fund
});

// Add inputs/outputs but inputs.length must equal outputs.length before continuing
await fundBuilder.addInflow({ amount: 1n });
// Add user asset inputs and fund token outputs
// Add Bitcoin change output
await fundBuilder.send();
```

### Redeeming Fund Tokens

```javascript
const fundBuilder = new FundTokenTransactionBuilder({
    provider, system, fund
});

// Add inputs/outputs but inputs.length must equal outputs.length before continuing
await fundBuilder.addOutflow({ amount: 1n });
// Add user fund token inputs and asset outputs
// Add Bitcoin change output
await fundBuilder.send();
```

## Key Concepts

### Fund Lifecycle

* Fund Creation - Broadcast fund parameters
* Fund Operations - Minting (inflow) and redeeming (outflow) fund tokens

## Security Model

* Non-Custodial: Funds held in contract UTXOs controlled by code
* Parameter Immutability: Public fund details are hashed and committed to tokens
* Contract Isolation: Each contract has single, verified responsibility
* Atomic Validation: Orchestrated multi-contract validation ensures consistency

## Requirements
* Bitcoin Cash network access
* Node

## License

Copyright (c) 2026 FoldingCash LLC, doing business as Fun(d)Tokens. All rights reserved.