# FundTokens.Contracts

FundTokens lets anyone hold a trustless, self-custodial basket of BitcoinCash native assets using CashTokens and smart contracts. No middlemen. Transparent rules. On-chain.

## 🚀 Quick Start

For developers integrating or auditing FundTokens:

1. **New to FundTokens?** Start with [System Architecture](docs/01-SYSTEM_ARCHITECTURE.md)
2. **Need contract details?** See [Contract Specifications](docs/02-CONTRACT_SPECIFICATIONS.md) with full CashScript source
3. **Building an integration?** Check [Transaction Builder API](docs/03-TRANSACTION_BUILDER_API.md)
4. **Ready to code?** Follow [Integration Guide & Examples](docs/04-INTEGRATION_GUIDE.md)
5. **Visualizing flows?** Review [Flow Diagrams](docs/05-FLOW_DIAGRAMS.md)

## System Overview

### Core Components

**System Tokens** (Enable operations):
- **Inflow Token** - Authorizes fund token minting
- **Outflow Token** - Authorizes fund token redemption
- **Public Fund Token** - Broadcasts fund parameters on-chain
- **Owner Token** - System administrator authorization
- **Fee Tokens** - Create & execute fee authorization

**Smart Contracts** (11 total):

| Category | Contracts | Purpose |
|----------|-----------|---------|
| **System** | SimpleMinter, FeeMinter, SimpleVault | Token minting & custody |
| **Fund Init** | FundStartup, PublicFund, FundMint | Fund creation & deployment |
| **Fund Ops** | FundManager, Fund, AssetManager, FeeManager | Fund execution |

### Fund Operation Model

```
Create Fund → Mint Tokens (deposit assets) → Redeem Tokens (withdraw assets)
     ↓              ↓                               ↓
 1 transaction  Multiple threads           Multiple threads
 per fund       in parallel                in parallel
```

## Key Features

✅ **Trustless** - No middlemen, contracts enforce all rules  
✅ **Self-Custodial** - Users always control their assets  
✅ **Non-Upgradeable** - Parameters set at creation, immutable  
✅ **High Throughput** - Multiple execution threads prevent UTXO congestion  
✅ **Flexible Assets** - Mix Bitcoin + up to 2 CashTokens per fund  
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

# Watch mode
yarn test:watch
```

## Contract Reference

| Contract | Location | Purpose |
|----------|----------|---------|
| SimpleMinter | `contracts/simple_minter.cash` | Owner-controlled token minting |
| FeeMinter | `contracts/fee_minter.cash` | Fee token creation with commitments |
| SimpleVault | `contracts/simple_vault.cash` | Authorization-gated vault |
| AuthHeadVault | `contracts/authhead_vault.cash` | Fund creation authorization |
| FundStartup | `contracts/startup.cash` | Validates & initializes fund |
| PublicFund | `contracts/public.cash` | Broadcasts fund data on-chain |
| FundMint | `contracts/mint.cash` | Creates per-fund contracts |
| FundManager | `contracts/manager.cash` | Coordinates inflow/outflow |
| Fund | `contracts/fund.cash` | Holds & releases fund tokens |
| AssetManager | `contracts/asset.cash` | Custodies fund assets |
| FeeManager | `contracts/fee.cash` | Routes fee payments |

## System Architecture

### System Tokens
- Owner PubKey
- Auth Head PKH
- Fee Tokens
    1. Create Fee
    2. Execute Fee
- Inflow Token
- Outflow Token
- Public Fund Token

### Fund Lifecycle

1. **Owner, System Maint Contracts**
    - Simple Minter - Owner can mint new tokens to the required destination
    - Fee Minter - Owner can mint new fees to the required destination

2. **New Public Fund**
    - GOTO → New Fund Thread
    - Public Fund - Verify the FundToken is properly started

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
import PublicFundTransactionBuilder from '@lib/PublicFundTransactionBuilder.js';
import FundTokenTransactionBuilder from '@lib/FundTokenTransactionBuilder.js';

// Create a fund
const publicBuilder = new PublicFundTransactionBuilder({ provider, system });
const fund = {
    category: genesisUtxo.txid,
    amount: 10n,
    satoshis: 1000n,
    assets: [{ category: 'token_id', amount: 2n }]
};
await publicBuilder.addBroadcast({ fund });
await publicBuilder.send();

// Mint fund tokens (user deposits assets)
const fundBuilder = new FundTokenTransactionBuilder({
    provider, system, fund
});
await fundBuilder.addInflow({ amount: 1n });
// ... add user inputs/outputs
await fundBuilder.send();

// Redeem fund tokens (user withdraws assets)
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
| Assets per fund | ~2 | 128-byte NFT commitment |
| Total system throughput | Unlimited | Multiple threads |
| Fund lifetime | Unlimited | Non-upgradeable |
| Transaction latency | ~10min avg | Thread selection randomness |

## File Structure

```
fund-tokens-contracts/
├── contracts/              # CashScript source
│   ├── *.cash             # Contract definitions
│   └── tests/             # Contract tests
├── lib/                   # JavaScript integration layer
│   ├── *TransactionBuilder.js
│   ├── utils.js
│   ├── constants.js
│   └── art/               # Compiled contract artifacts
├── tests/                 # Integration tests
├── package.json
└── vitest.config.js
```

## License

MIT

## See Also

- [CashScript Documentation](https://cashscript.org)
- [Bitcoin Cash](https://bitcoincash.org)
- [CashTokens Spec](https://github.com/bitjson/cashtokens)