# FundTokens System Architecture

## Overview

FundTokens is a trustless, self-custodial system that allows anyone to create and manage a basket of Bitcoin Cash native assets (using CashTokens) through smart contracts. The system enables users to:

- **Create custom fund tokens** backed by multiple CashToken assets and/or Bitcoin Cash satoshis
- **Mint fund tokens** in exchange for depositing assets (inflow)
- **Redeem fund tokens** to withdraw assets (outflow)
- **Pay usage fees** without intermediaries or custodial risk
- **Manage fund creation** through a public system state

No middlemen. Transparent rules. On-chain.

## System Components

### 1. Token Types

The FundTokens system uses several token types to coordinate state and permissions:

| Token | Purpose | Quantity | Role |
|-------|---------|----------|------|
| **Inflow Token** | Signals permission to mint fund tokens | Multiple (threaded) | Enables fund minting |
| **Outflow Token** | Signals permission to redeem fund tokens | Multiple (threaded) | Enables fund redemption |
| **Fund Token** | Represents ownership stake in a fund | Variable | User-held asset |
| **Public Fund Token** | Publishes fund details on-chain | One per fund | Broadcast mechanism |
| **Create Fee Token** | Authorizes fund creation | Multiple (threaded) | System maintenance |
| **Execute Fee Token** | Authorizes fund execution | Multiple (threaded) | System maintenance |
| **Owner Token** | Authorizes system owner operations | Single | System admin |
| **Auth Head Token** | Authorizes auth head operations | Single | Fund verification |

### 2. Core Contracts

The system comprises 11 smart contracts organized into two main flows:

#### System Initialization & Maintenance
- **SimpleMinter** / **FeeMinter** - Owner-controlled token minting
- **SimpleVault** / **AuthHeadVault** - Token custody with authorization checks

#### Fund Lifecycle
- **FundStartup** - Validates fund initialization and mints inflow/outflow tokens
- **PublicFund** - Broadcasts fund details on-chain in consumable chunks
- **FundMint** - Creates fund-specific contracts for a particular fund thread

#### Fund Execution (Per-Fund Contracts)
- **FundManager** - Coordinates inflow/outflow minting and redemption
- **Fund** - Holds fund tokens and calculates release amounts
- **AssetManager** - Holds and releases individual fund assets
- **FeeManager** - Validates and routes fee payments

### 3. Transaction Flows

#### Fund Creation Flow

```
1. User initiates fund creation via Public Fund
2. Startup contract validates fund parameters:
   - Fund amount > 0
   - Satoshi amount valid (0 or 1,000-21,000,000 satoshis)
   - Assets sorted by category and amounts > 0
3. Inflow & Outflow tokens minted with fund commitment
4. Public Fund broadcasts fund details in chunks
5. Fund-specific contracts instantiated for threading
```

#### Fund Inflow (Minting) Flow

```
1. User deposits assets matching fund composition
2. Inflow Manager validates transaction
   - Verifies inflow token presence
   - Confirms fund thread selection
3. Fund contract releases fund tokens
   - Calculates tokens released: (input - output) / fund_amount
4. Asset contracts ready for receipt
5. Fee contract processes payment
```

#### Fund Outflow (Redemption) Flow

```
1. User provides fund tokens to redeem
2. Outflow Manager validates:
   - Verifies outflow token presence
   - Confirms fund thread selection
3. Fund contract collects fund tokens
   - Input fund tokens > Output (reduction)
4. Asset contracts release corresponding assets
   - Bitcoin goes to user as satoshis
   - Tokens go to user in original categories
5. Fee contract processes payment
```

### 4. Threading Architecture

To support high-throughput fund operations, FundTokens uses a **threading model**:

- Multiple **inflow threads** allow concurrent minting transactions
- Multiple **outflow threads** allow concurrent redemption transactions  
- Each thread has its own **inflow token**, **outflow token**, and **fund contracts**
- Threads are independent - transactions can be parallelized
- New threads can be added via system transactions

**Thread Activation**: A transaction uses a specific thread by including the corresponding inflow/outflow token NFT in its inputs.

### 5. Fee System

The fee system is dual-layered:

#### Create Fees
- Charged when creating a new fund
- Paid during FundStartup validation
- Routed to fee destination via FeeManager

#### Execute Fees
- Charged per inflow/outflow transaction
- Paid during Fund execution
- Routed to fee destination via FeeManager

**Fee Structure**: Each fee is an NFT with commitment encoding:
```
Commitment = [category (32 bytes) | amount (8 bytes) | destination (variable bytes)]
```

- If `category = 0x00`: amount is satoshis
- Otherwise: amount is token quantity in specified category
- If destination empty: routes to system default

### 6. NFT Commitments

CashToken NFT commitments store critical fund parameters:

#### Fund Commitment Format
```
[
  fund_category (32 bytes),
  fund_amount (8 bytes),
  satoshis (8 bytes),
  asset_1_category (32 bytes),
  asset_1_amount (8 bytes),
  asset_2_category (32 bytes),
  asset_2_amount (8 bytes),
  ...
]
```

**Maximum size**: 128 bytes (CashToken limit)

**Asset ordering**: Must be sorted by category in ascending order for validation

#### Inflow/Outflow Token Commitments
```
[
  fund_category (32 bytes),
  fund_hash (32 bytes)
]
```

## Security Model

### 1. Contract Isolation

Each contract has a specific, limited role:
- **FundManager** only coordinates, doesn't hold assets
- **Fund** only holds fund tokens, calculation-only
- **AssetManager** only releases assets when outflow token present
- **FeeManager** only validates fee routing

### 2. Authorization Checks

Authorization is enforced through:
- **Token presence**: Required tokens must be in inputs
- **NFT commitment validation**: Fund details checked against stored commitment
- **Input/output matching**: Contracts locked back to themselves
- **Sorted assets**: Prevents duplicate or out-of-order assets

### 3. Fund Parameter Immutability

Once a fund is created:
- Fund token category is fixed
- Fund token amount is fixed
- Asset composition is fixed (cannot add/remove/change)
- Fund commitment hash prevents tampering

### 4. No Custodial Risk

- All contracts are non-custodial for user funds
- User always holds fund tokens
- Assets only released via matched asset contracts
- Fee system cannot intercept user deposits

## Data Flow Example: Simple Fund with 2 Assets

```
Fund Parameters:
- Category: ABC... (256-bit hash)
- Amount: 10 (user holds 1 = owns 1/10th)
- Bitcoin: 1,000 satoshis per fund token
- Asset1: CAT XYZ... quantity 2 per fund token
- Asset2: CAT DEF... quantity 5 per fund token

User wants to mint 2 fund tokens:
- Deposits: 2,000 satoshis + 4 XYZ tokens + 10 DEF tokens
- Fund Manager validates via inflow token
- Fund contract releases: 2 fund tokens (stored as holding)
- Fee processor charges execution fee
- User receives: 2 fund tokens

Later, user redeems 1 fund token:
- Deposits: 1 fund token
- Fund Manager validates via outflow token
- Fund contract collects: 1 fund token (destroyed)
- Asset managers release:
  - 1,000 satoshis
  - 2 XYZ tokens
  - 5 DEF tokens
- Fee processor charges execution fee
- User receives: assets as specified
```

## Implementation Technology

- **Language**: CashScript ~0.13.0 for contract bytecode
- **Platform**: Bitcoin Cash (CHIPNET/MAINNET)
- **Token Standard**: CashTokens (Bitcoin Cash Native Tokens)
- **Transaction Building**: JavaScript/Node.js with libauth & cashscript
- **Testing**: Vitest with MockNetworkProvider for simulation

## Key Design Decisions

1. **Non-upgradeable Contracts**: Each fund gets unique contract instances with committed parameters - no upgrade risk

2. **NFT Commitment Storage**: Fund parameters stored in NFT commitment rather than UTXO data - more efficient and immutable

3. **Thread-Based Concurrency**: Multiple independent execution threads prevent UTXO contention and enable high throughput

4. **Fee Flexibility**: Commitment-encoded fees allow per-transaction customization without contract redeployment

5. **Public Fund Mechanism**: Fund data broadcast in chunks via PublicFund - enables off-chain fund discovery and index building

6. **Asset Sorting**: Required sorted asset list prevents double-spending and simplifies validation

## Limits & Constraints

| Constraint | Limit | Reason |
|-----------|-------|--------|
| Fund Parameters Size | 128 bytes | CashToken NFT commitment max |
| Max Assets Per Fund | ~2 | 128 bytes - 48 bytes overhead ÷ 40 bytes per asset |
| Satoshi Range | 0 or 1,000-21,000,000 BTC | Bitcoin supply cap |
| Thread Count | Unlimited | Can add threads via system transactions |
| Transaction Thread Time | ~10 minutes | Fee token selection randomness |

## Next Steps for Integration

1. Review [02-CONTRACT_SPECIFICATIONS.md](02-CONTRACT_SPECIFICATIONS.md) for detailed per-contract specs
2. Review [03-TRANSACTION_BUILDER_API.md](03-TRANSACTION_BUILDER_API.md) for integration points
3. Review [04-INTEGRATION_GUIDE.md](04-INTEGRATION_GUIDE.md) for end-to-end examples
4. Review [05-FLOW_DIAGRAMS.md](05-FLOW_DIAGRAMS.md) for visual transaction flows
