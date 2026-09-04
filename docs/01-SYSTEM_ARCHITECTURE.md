# FundTokens System Architecture

## Overview

FundTokens is a trustless, self-custodial system that allows anyone to create and manage a basket of Bitcoin Cash native assets (using CashTokens) through smart contracts. The system enables users to:

- **Define and create custom public fund tokens** backed by multiple CashToken assets and/or Bitcoin
- **Mint fund tokens** in exchange for depositing assets (inflow)
- **Redeem fund tokens** to withdraw assets (outflow)
- **Audit real-time funds** to independently verify solvency
- **Compose fund tokens** together or compose with your application/service

No middlemen. Transparent rules. On-chain.

## System Components

### 1. Token Types

The FundTokens system uses several token types to coordinate state and permissions:

| Token | Purpose | Quantity | Role |
|-------|---------|----------|------|
| **Inflow Token** | Signals permission to mint fund tokens | Multiple (threaded) | Enables fund minting |
| **Outflow Token** | Signals permission to redeem fund tokens | Multiple (threaded) | Enables fund redemption |
| **Public Fund Token** | Publishes fund details on-chain | Multiple (threaded) | Public broadcast mechanism |
| **Fund Token** | Represents ownership stake in a fund | Int64.MaxValue | Contract/User-held asset |
| **Authorization Token** | Authorizes maintenance operations | Single/Multiple | Authorizes maintenance |
| **Create Fee Token** | Authorizes fund creation | Multiple (threaded) | Enables dynamic fee rates |
| **Execute Fee Token** | Authorizes fund execution | Multiple (threaded) | Enables dynamic fee rates |

### 2. Core Contracts

The system comprises 14 smart contracts organized into three main flows:

#### System Initialization & Maintenance
- **SimpleMinter** / **FeeMinter** - Owner-controlled token minting, create additional threading for fund startup contracts
- **SimpleVault** / **AuthHeadVault** - Vault custody with token authorization checks
- **InstanceVault** / **PublicFundVault** - Data vaults for UTXO discovery and on-chain introspection

#### Fund Creation
- **PublicFund** - Validates fund initialization and broadcasts fund details on-chain in consumable chunks
- **FundStartup** - Validates encoded commitments and destinations for inflow/outflow tokens and create fee is paid
- **FundInflowMint** - Holds the inflow minting token and creates fund-specific contracts for a particular fund
- **FundOutflowMint** - Holds the outflow minting token and creates fund-specific contracts for a particular fund
- **FeeManager** - Validates and routes fee payments w/ creation spend defaults

#### Fund Execution (Per-Fund Contracts)
- **TransactionManager** - Coordinates inflow/outflow minting and redemption; calculates release/redemption amounts
- **FundManager** - Holds fund tokens and checks for fund manager
- **AssetManager** - Holds and releases individual fund assets
- **FeeManager** - Validates and routes fee payments w/ execution spend default

### 3. Transaction Flows

#### Public Fund Creation Flow

```
1. User initiates fund creation via Public Fund contract
   - Validates token creation and destination
   - Ensures identity management available
2. Startup contract validates fund parameters:
   - Fund amount > 0
   - Satoshi amount valid
      - If no assets, then greater than zero and less than or equal to 21M
      - If assets, then greater than or equal to zero and less than or equal to 21M
   - Assets sorted by category (ascending hexadecimal order) with amounts > 0
3. Inflow & Outflow tokens minted with fund commitment
   - Bytcode building ensures strict destination enforcement
   - NFT commitment for proper threading
4. Public Fund broadcasts fund details in chunks
   - UTXO discovery
   - On-chain introspection validation
5. Fund-specific contracts instantiated with additional thread
   - Scaling mechanism to reduce UTXO contention and double-spends
```

#### Fund Inflow (Minting) Flow

```
1. User deposits assets matching fund composition
2. Transaction Manager (inflow) validates transaction
   - Verifies inflow token presence
   - Confirms fund thread selection
   - Calculates fund tokens release: (input - output) / fund_amount
3. Fund contract releases fund tokens
   - Verified inflow token present
   - Decrease in fund tokens
4. Asset contracts receive deposit assets
5. Fee contract processes payment
6. User receives fund token receipts
```

#### Fund Outflow (Redemption) Flow

```
1. User provides fund tokens to redeem
2. Transaction Manager (outflow) validates:
   - Verifies outflow token presence
   - Confirms fund thread selection
   - Calculates fund token collection: (output - input) / fund_amount
3. Fund contract collects fund tokens
   - Verified outflow token present
   - Increase in fund tokens
4. Asset contracts release corresponding assets
   - Verified outflow token present
   - Fund assets released from asset contracts
5. Fee contract processes payment
6. User receives fund token assets
```

### 4. Threading Architecture

To support high-throughput fund operations, FundTokens uses a **threading model**:

- Multiple **inflow threads** allow concurrent minting transactions
- Multiple **outflow threads** allow concurrent redemption transactions  
- Each fund has its own **inflow token**, **outflow token**, and **fund contracts**
- UTXOs or threads are independent - transactions can be parallelized w/ any available UTXO
- New threads can be added via system transactions, reinvoking startup w/ inflow/outflow contracts, and unbounded UTXOs (e.g. fund, fee contracts)

**Thread Activation**: A transaction uses a specific thread by including the corresponding inflow/outflow token NFT in its inputs.

### 5. Fee System

The fee system is dual-layered:

#### Create Fees
- Charged when creating a new fund 
- Charged when creating fund inflow/outflow threads
- Paid during FundStartup validation
- Routed to fee destination via FeeManager
- Supports default fees, guaranteed fund token usability

#### Execute Fees
- Charged per inflow/outflow transaction, independent of number of assets or amounts
- Paid during Fund execution
- Routed to fee destination via FeeManager
- Supports default fees, guaranteed fund token usability

**Fee Commitment Structure**: [Deep-dive fee token commitment structure here](09-FEE_TOKENS.md)

### 6. NFT Commitments

CashToken NFT commitments store critical fund parameters:

#### Instance Commitment Format

The contract parameters can be found and verified on-chain w/ the instance NFTs

```
type (0x00) (1 byte),
version (2 bytes)
hash (32 bytes)
inflow (32 bytes)
outflow (32 bytes)
publicFund (32 bytes)
authorization (32 bytes)
fees_create_nft (32 bytes)
fees_create_sats (4 bytes)
fees_execute_nft (32 bytes)
fees_execute_sats (4 bytes)
``` 

#### Public Fund Commitment Format

```
type (0x02) (1 byte),
fund_hash(32 bytes),
fund_category (32 bytes),
divisor (8 bytes),
satoshis (7 bytes),
   [
      {
         asset_1_category (32 bytes),
         asset_1_amount (8 bytes),
      }
      ...
   ]
```

**Maximum chunk size**: 128 bytes (2026 CashToken limit) is enforced by concensus rules and the contracts will adapt to concensus rule changes

**Chunk size enforcement**: The first chunk size sets the requied chunking size for all pieces except the last; the last chunk may be less than or equal to the first chunk

**Asset ordering**: Must be sorted by category in ascending order for validation

#### Inflow/Outflow Token Commitment

```
type (0x02) (1 byte)
fund_category (32 bytes)
fund_hash (32 bytes)
```

## Fund Security Model

### 1. Contract Isolation

Each contract has a specific, limited role:
- **TransactionManager** only coordinates, doesn't hold assets, holistic view and calculations
- **FundManager** only holds fund tokens, limited view
- **AssetManager** only releases assets when outflow token present
- **FeeManager** only validates fee routing

### 2. Authorization Checks

Authorization is enforced through:
- **Token presence**: Required token signals must be in inputs
- **NFT commitment validation**: Fund details checked against stored hash
- **Input/output matching**: Contracts locked back to themselves

### 3. Fund Parameter Immutability

Once a fund is created:
- Fund token category is fixed
- Fund token amount (divisor) is fixed
- Asset composition is fixed (cannot add/remove/change)
- Fund commitment category with hash prevents tampering

### 4. No Custodial Risk

- All contracts are non-custodial for user funds
- User always holds fund tokens
- Assets only released via matched asset contracts
- Fee system cannot intercept user deposits

## Data Flow Example: Simple Fund with 2 Assets + Bitcoin

```
Fund Parameters:
- Category: ABC... (32-bit hash)
- Amount: 10 (user holds 1 = owns 1/10th)
- Bitcoin: 1,000 satoshis per fund token
- Asset1: CAT XYZ... quantity 2 per fund token
- Asset2: CAT DEF... quantity 5 per fund token

User wants to mint 2 fund tokens:
- Deposits: 2,000 satoshis + 4 XYZ tokens (Dust) + 10 DEF tokens (Dust)
- Fund Manager validates via inflow token
- Fund contract releases: 2 fund tokens (stored as holding)
- Fee processor charges execution fee
- User receives: 2 fund tokens

Later, user redeems 1 fund token:
- Deposits: 1 fund token
- Fund Manager validates via outflow token
- Fund contract collects: 1 fund token (returned)
- Asset managers release:
  - 1,000 satoshis
  - 2 XYZ tokens (Dust if no UTXO token change)
  - 5 DEF tokens (Dust if no UTXO token change)
- Fee processor charges execution fee
- User receives: assets as specified
```

## Key Design Decisions

1. **Non-upgradeable Contracts**: Each fund gets unique contract instances with committed parameters - no upgrade risk

1. **NFT Commitment Storage**: Fund parameters stored in NFT commitment - efficient and immutable

1. **Thread-Based Concurrency**: Multiple independent execution threads prevent UTXO contention and enable high throughput

1. **Fee Flexibility**: Commitment-encoded fees allow per-transaction customization without contract redeployment

1. **Public Fund Mechanism**: Trustlessly created funds w/ data broadcast in chunks - enables on-chain fund discovery and index building

1. **Asset Sorting**: Required sorted asset list ensures asset integrity and efficient processing

### Asset Sorting Detail

Assets within a fund are **sorted by category in ascending hexadecimal order**. This is critical for fund validation:

- **Sorting Function**: `categoryAscending(a, b) => a.category.localeCompare(b.category)`
- **Order**: Hex string comparison (0x00... < 0x01... < 0xFF...)
- **Purpose**: Ensures deterministic asset sequence for commitment validation
- **Implementation**: Used in `lib/utils.js getFundHex()` and validated in `startup.cash`

**Example**:
```
Asset1: Category 0xABCD... → Position 0
Asset2: Category 0xDEF0... → Position 1  
Asset3: Category 0xFF00... → Position 2

Sorted ascending: 0xABCD < 0xDEF0 < 0xFF00 ✓
```

Each asset (except Bitcoin satoshis) must have these properties:
- **Category**: 32-byte hex string (token category ID)
- **Amount**: int64 (quantity of tokens per fund token)
- **Validation**: Amount must be > 0 (cannot have zero-quantity assets)

Failure to sort assets correctly will cause fund creation to fail.

## Limits & Constraints

| Aspect | Limit | Reason | Notes |
|--------|-------|--------|-----------|
| Assets per fund | ~35 | Calculation density limits | Additional "gas" may be bought |
| Total system throughput | Unlimited | High-capacity multi-threading | |
| Fund lifetime | Forever | Non-upgradeable contracts with lockout prevention | |
| Transaction latency | Near instant | Thread selection randomness and no confirmation required | Mempool fragmentation |

## Implementation Technology

- **Language**: CashScript ~0.13.0 for contract bytecode
- **Platform**: Bitcoin Cash (CHIPNET/MAINNET)
- **Token Standard**: CashTokens (Bitcoin Cash Native Tokens)
- **Transaction Building**: JavaScript/Node.js with libauth & cashscript
- **Testing**: Vitest with MockNetworkProvider for simulation

## Next Steps for Integration

- [02-CONTRACT_SPECIFICATIONS.md](02-CONTRACT_SPECIFICATIONS.md) - Contract details
- [03-TRANSACTION_BUILDER_API.md](03-TRANSACTION_BUILDER_API.md) - Transaction API
- [04-INTEGRATION_GUIDE.md](04-INTEGRATION_GUIDE.md) - Integration examples
- [05-FLOW_DIAGRAMS.md](05-FLOW_DIAGRAMS.md) - Visual flow diagrams
- [06-SYSTEM_TOKENS.md](06-SYSTEM_TOKENS.md) - System token specification
- [07-FEE_TOKEN.md](07-FEE_TOKEN.md) - Fee token specification
- [08-AUTHORIZATION_TOKEN.md](08-AUTHORIZATION_TOKEN.md) - Authorization token specification