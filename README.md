# FundToken Contracts

FundTokens lets anyone hold a trustless, self-custodial basket of Bitcoin Cash native assets using CashTokens and smart contracts. No middlemen. Transparent rules. On-chain.

## 🚀 Quick Start

For developers integrating or auditing FundTokens:

1. **New to FundTokens?** Start with [System Architecture](docs/01-SYSTEM_ARCHITECTURE.md)
2. **Need contract details?** See [Contract Specifications](docs/02-CONTRACT_SPECIFICATIONS.md) full CashScript source available
3. **Building an integration?** Check [Transaction Builder API](docs/03-TRANSACTION_BUILDER_API.md)
4. **Ready to code?** Follow [Integration Guide & Examples](docs/04-INTEGRATION_GUIDE.md)
5. **Visualizing flows?** Review [Flow Diagrams](docs/05-FLOW_DIAGRAMS.md)
6. **Curious about our operating tokens?** Inspect [System Tokens](docs/06-SYSTEM_TOKENS.md)

## System Overview

### Core Components

**Data Encoding Tokens** (On-chain data encoding w/ proofs):
- **Instance Token** - Verify global contract parameters
- **Public Fund Token** - Broadcasts trustless fund parameters on-chain

**System Tokens** (Enables various operations and maintenance):
- **Inflow Token** - Cross-contract fund's inflow signal
- **Outflow Token** - Cross-contract fund's outflow signal
- **Fee Tokens** - Authorizes FundToken actions
- **Authorization Token** - System authorization (new threads for scaling, manage fees, manage BCMR)


**Smart Contracts** (43 total):

| Category | Contracts | Purpose |
|----------|-----------|---------|
| **System** | SimpleMinter, FeeMinter, SimpleVault, AuthHeadVault, PublicVault, InstanceVault | Execution thread creation & custody |
| **Fund Initialization** | FundStartup, PublicFund, FundInflowMint, FundOutflowMint | Fund creation & deployment |
| **Fund Operations** | TransactionManager, FundManager, AssetManager, FeeManager | Fund execution |

### Public Fund Operation Model

```
Create Public Fund → Mint FundTokens (deposit assets) → Redeem FundTokens (withdraw assets)
     ↓                      ↓                                  ↓
 1 time tx            Threading available                Threading available
 per fund
```

## Key Features

✅ **Trustless** - No middlemen, contracts enforce all rules
✅ **Self-Custodial** - Users always control their assets
✅ **Non-Upgradeable** - Parameters set at creation, immutable
✅ **High Throughput** - Scaling design w/ multiple execution threads to prevent UTXO congestion and double-spends
✅ **Flexible Assets** - Mix Bitcoin + up to ~35 CashTokens per fund (before having to buy more "gas")
✅ **Transparent** - On-chain contract parameters with full auditable operations
✅ **Ecosystem Ready** - Use FundTokens on existing ecosystem applications that use CashTokens

## Documentation Structure

```
docs/
├── 01-SYSTEM_ARCHITECTURE.md      ← Start here: overview, design, flows
├── 02-CONTRACT_SPECIFICATIONS.md  ← Deep dive: contracts + CashScript
├── 03-TRANSACTION_BUILDER_API.md  ← API reference: integration points
├── 04-INTEGRATION_GUIDE.md        ← Step-by-step examples & patterns
├── 05-FLOW_DIAGRAMS.md            ← Visual workflows & sequences
├── 06-SYSTEM_TOKENS.md            ← System Token Overview
├── 06-INSTANCE_TOKEN.md           ← Instance encoding tokens details
├── 07-PUBLICFUND_TOKEN.md         ← Broadcasted "Public Fund" token details
├── 08-FEE_TOKENS.md               ← Dyanmic fee token details
├── 09-OPERATION_TOKENS.md         ← Fund TX signal token details
└── 10-AUTHORIZATION_TOKEN.md      ← Protocol steward maintenance tokens
```

## Building & Testing

```bash
# Install dependencies
yarn install

# Compile contract and then run tests
yarn test:build
```

## Contract Reference

### User Interface Contracts

| Contract | Location | Purpose |
|----------|----------|---------|
| InstanceVault | `contracts/instance_vault.cash` | Verify global contract parameters on chain w/ library version signaling |
| PublicVault | `contracts/public_vault.cash` | Verify public fund data on chain |
| PublicFund | `contracts/public.cash` | Broadcasts fund data on-chain |
| FundStartup | `contracts/startup.cash` | Validates & initializes fund |
| FundInflowMint | `contracts/mint_inflow.cash` | Creates per-fund inflow tokens |
| FundOutflowMint | `contracts/mint_outflow.cash` | Creates per-fund outflow tokens |
| TransactionManager | `contracts/manager.cash` | Coordinates inflow/outflow of the fund |
| FundManager | `contracts/fund.cash` | Holds & releases fund tokens |
| AssetManager | `contracts/asset.cash` | Holds & releases fund assets |
| FeeManager | `contracts/fee.cash` | Routes fee payments |

### Protocol Maintenance Contracts

| Contract | Location | Purpose |
|----------|----------|---------|
| SimpleMinter | `contracts/simple_minter.cash` | Token minting w/ immutable destination and CashToken auth |
| FeeMinter | `contracts/fee_minter.cash` | Fee token creation with validated commitments and CashToken auth |
| SimpleVault | `contracts/simple_vault.cash` | Gated vault with CashToken authorization |
| AuthHeadVault | `contracts/authhead_vault.cash` | "AuthHead" UTXO validation with CashToken auth |

## System Architecture

### System Tokens
- Instance Token
- Inflow Token
- Outflow Token
- Authorization
- Fee Tokens
    1. Create Fee
    2. Execute Fee
- Public Fund Token

### Public Fund Lifecycle

1. **New Public Fund**
    - Public Fund - Verify the public FundToken is properly created
    - GOTO → New Fund Thread

2. **New Fund Thread**
    - Startup - Verify fund details, and only inflow/outflow tokens used in tx
    - Fee - Verify fee paid
    - Fund Mint (Inflow) - Mint a new inflow token to a fund's manager
    - Fund Mint (Outflow) - Mint a new outflow token to a fund's manager

3. **Fund Inflow** (User deposits assets)
    - Manager - Validate the inflow transaction
    - Fund - Hold and release the fund tokens
    - Fee - Verify fee paid

4. **Fund Outflow** (User redeems assets)
    - Manager - Validate the outflow transaction
    - Fund - Collect the fund tokens
    - Asset - Hold and release the fund's assets
    - Fee - Verify fee paid

5. **Public Fund Vault** (On-chain fund verification)
    - Public Fund Vault - Maintains encoded tokens and on-chain introspection

## Security Model

- **Non-Custodial**: Funds held in contract UTXOs controlled by code
- **Parameter Immutability**: Fund details hashed and committed to tokens
- **Contract Isolation**: Each contract has single, verified responsibility
- **Thread Authorization**: Operations require matching token presence
- **Atomic Validation**: Multi-contract validation ensures consistency
- **No Admin Keys**: Once deployed, no upgrade or admin controls

## Key Constraints

| Aspect | Limit | Reason | Notes |
|--------|-------|--------|-----------|
| Assets per fund | ~35 | Calculation density limits | Additional "gas" may be bought |
| Total system throughput | Unlimited | High-capacity multi-threading | |
| Fund lifetime | Forever | Non-upgradeable contracts with lockout prevention | |
| Transaction latency | Near instant | Thread selection randomness and no confirmation required | Mempool fragmentation |

## License

Copyright (c) 2026 FoldingCash LLC. All rights reserved.

## See Also

- [CashScript Documentation](https://cashscript.org)
- [Bitcoin Cash](https://bitcoincash.org)
- [CashTokens Spec](https://github.com/cashtokens/cashtokens)
- [BCMR Spec](https://github.com/bitjson/chip-bcmr)