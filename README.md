# FundToken Contracts

FundTokens lets anyone hold a trustless, self-custodial basket of BitcoinCash native assets using CashTokens and smart contracts. No middlemen. Transparent rules. On-chain.

## 🚀 Quick Start

For developers integrating or auditing FundTokens:

1. **New to FundTokens?** Start with [System Architecture](docs/01-SYSTEM_ARCHITECTURE.md)
2. **Need contract details?** See [Contract Specifications](docs/02-CONTRACT_SPECIFICATIONS.md) full CashScript source available
3. **Building an integration?** Check [Transaction Builder API](docs/03-TRANSACTION_BUILDER_API.md)
4. **Ready to code?** Follow [Integration Guide & Examples](docs/04-INTEGRATION_GUIDE.md)
5. **Visualizing flows?** Review [Flow Diagrams](docs/05-FLOW_DIAGRAMS.md)

## System Overview

### Core Components

**System Tokens** (Enable operations):
- **Inflow Token** - Authorizes fund token minting
- **Outflow Token** - Authorizes fund token redemption
- **Public Fund Token** - Broadcasts fund parameters on-chain
- **Authorization Token** - System authorization (new execution threads, fees, BCMR)
- **Fee Tokens** - Authorizes FundToken actions

**Smart Contracts** (13 total):

| Category | Contracts | Purpose |
|----------|-----------|---------|
| **System** | SimpleMinter, FeeMinter, SimpleVault, AuthHeadVault, PublicVault | Execution thread creation & custody |
| **Fund Init** | FundStartup, PublicFund, FundInflowMint, FundOutflowMint | Fund creation & deployment |
| **Fund Ops** | TransactionManager, FundManager, AssetManager, FeeManager | Fund execution |

### Public Fund Operation Model

```
Create Public Fund → Mint Tokens (deposit assets) → Redeem Tokens (withdraw assets)
     ↓                      ↓                                  ↓
 1 time tx            Threading available                Threading available
 per fund
```

## Key Features

✅ **Trustless** - No middlemen, contracts enforce all rules  
✅ **Self-Custodial** - Users always control their assets  
✅ **Non-Upgradeable** - Parameters set at creation, immutable  
✅ **High Throughput** - Multiple execution threads prevent UTXO congestion and double-spends  
✅ **Flexible Assets** - Mix Bitcoin + up to ~30 CashTokens per fund
✅ **Transparent** - On-chain fund parameters, auditable operations  

## Documentation Structure

```
docs/
├── 01-SYSTEM_ARCHITECTURE.md      ← Start here: overview, design, flows
├── 02-CONTRACT_SPECIFICATIONS.md  ← Deep dive: contracts + CashScript
├── 03-TRANSACTION_BUILDER_API.md  ← API reference: integration points
├── 04-INTEGRATION_GUIDE.md        ← Step-by-step examples & patterns
└── 05-FLOW_DIAGRAMS.md           ← Visual workflows & sequences
```

## Building & Testing

```bash
# Install dependencies
yarn install

# Compile contracts
yarn build

# Run tests
yarn test
```

## Contract Reference

| Contract | Location | Purpose |
|----------|----------|---------|
| SimpleVault | `contracts/simple_vault.cash` | Gated vault with CashToken authorization |
| SimpleMinter | `contracts/simple_minter.cash` | Token minting w/ immutable destination and CashToken auth |
| FeeMinter | `contracts/fee_minter.cash` | Fee token creation with validated commitments and CashToken auth |
| AuthHeadVault | `contracts/authhead_vault.cash` | "AuthHead" UTXO validation with CashToken auth |
| PublicVault | `contracts/public_vault.cash` | Verify public fund data on chain w/ authorized burning |
| FundStartup | `contracts/startup.cash` | Validates & initializes fund |
| PublicFund | `contracts/public.cash` | Broadcasts fund data on-chain |
| FundInflowMint | `contracts/mint_inflow.cash` | Creates per-fund inflow tokens |
| FundOutflowMint | `contracts/mint_outflow.cash` | Creates per-fund outflow tokens |
| TransactionManager | `contracts/manager.cash` | Coordinates inflow/outflow of the fund |
| FundManager | `contracts/fund.cash` | Holds & releases fund tokens |
| AssetManager | `contracts/asset.cash` | Holds & releases fund assets |
| FeeManager | `contracts/fee.cash` | Routes fee payments |

## System Architecture

### System Tokens
- Authorization
- Fee Tokens
    1. Create Fee
    2. Execute Fee
- Inflow Token
- Outflow Token
- Public Fund Token

### Fund Lifecycle

1. **System Maint Contracts**
    - Simple Minter - Maintainer can mint new tokens to the required destination
    - Fee Minter - Maintainer can mint new fees to the required destination

2. **New Public Fund**
    - Public Fund - Verify the public FundToken is properly created
    - GOTO → New Fund Thread

3. **New Fund Thread**
    - Startup - Verify fund details, and only inflow/outflow tokens used in tx
    - Fee - Verify fee paid
    - Fund Mint (Inflow) - Mint a new inflow token to a fund's manager
    - Fund Mint (Outflow) - Mint a new outflow token to a fund's manager

4. **Fund Inflow** (User deposits assets)
    - Manager - Validate the inflow transaction
    - Fund - Hold and release the fund tokens
    - Fee - Verify fee paid

5. **Fund Outflow** (User redeems assets)
    - Manager - Validate the outflow transaction
    - Fund - Collect the fund tokens
    - Asset - Hold and release the fund's assets
    - Fee - Verify fee paid

## Integration Example

```javascript
import { PublicFundTransactionBuilder, FundTokenTransactionBuilder } from '@fundtokens/builders';

// Create a fund
const publicBuilder = new PublicFundTransactionBuilder({ provider, system });
const fund = {
    category: genesisUtxo.txid,
    amount: 10n,
    satoshis: 1000n,
    assets: [{ category: 'asset_token_id', amount: 2n }]
};
// ... add user genesis UTXO
await publicBuilder.addBroadcast({ fund });
await publicBuilder.send();
```

```javascript
// ...
// Mint fund tokens (user deposits assets)
const fundBuilder = new FundTokenTransactionBuilder({
    provider, system, fund
});
await fundBuilder.addInflow({ amount: 1n });
// ... add user asset input(s)
// ... add user fund token output(s)
await fundBuilder.send();
```

```javascript
// ...
// Redeem fund tokens (user withdraws assets)
const fundBuilder = new FundTokenTransactionBuilder({
    provider, system, fund
});
await fundBuilder.addOutflow({ amount: 1n });
// ... add user inputs/outputs
await fundBuilder.send();
```

See [Integration Guide](docs/04-INTEGRATION_GUIDE.md) for complete examples.

## Security Model

- **Non-Custodial**: Funds held in contract UTXOs controlled by code
- **Parameter Immutability**: Fund details hashed and committed to tokens
- **Contract Isolation**: Each contract has single, verified responsibility
- **Thread Authorization**: Operations require matching token presence
- **Atomic Validation**: Multi-contract validation ensures consistency
- **No Admin Keys**: Once deployed, no upgrade or admin controls

## Key Constraints

| Aspect | Limit | Reason |
|--------|-------|--------|
| Assets per fund | ~30 | Standard relay rules |
| Total system throughput | Unlimited | Multiple threads |
| Fund lifetime | Forever | Non-upgradeable and fee defaults |
| Transaction latency | instant | Thread selection randomness and no confirmation required |

## License

Copyright (c) 2026 FoldingCash LLC. All rights reserved.

## See Also

- [CashScript Documentation](https://cashscript.org)
- [Bitcoin Cash](https://bitcoincash.org)
- [CashTokens Spec](https://github.com/cashtokens/cashtokens)