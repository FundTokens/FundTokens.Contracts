# Authorization Token

This document provides detailed specifications for the authorization token system, including commitment encoding of permission bits.

## Overview

The Authorization Token is a single or multiple CashToken NFT that gates maintenance and administrative operations within the FundTokens system. Unlike inflow/outflow tokens which enable user transactions, authorization tokens control system-level actions such as token minting, vault management, and fund closure.

## Authorization Token Commitment Format

Authorization token commitments encode permission flags into CashToken NFTs. The maintainer can delegate least rights access to every "sensitive" platform operation to applications or people that maintain the system.

### Commitment Structure

```
[permission_flags (1 byte)]
```

- **permission_flags**: Single byte containing packed permission bits

### Permission Bits

Each bit in the permission flags byte represents a specific authorization capability:

| Hex | Permission | Purpose |
|-----|-----------|---------|
| 0x01 | Token Minters | Authorize SimpleMinter to mint system tokens (inflow, outflow, public fund tokens) |
| 0x02 | Update AuthHead | Authorize updating BCMR (BitcoinCash Metadata Registry) metadata via AuthHeadVault |
| 0x20 | Burn AuthHead Identity | Authorize burning authhead identities to signal permanent identity closure or rotation |
| 0x04 | Close Fee | Authorize closing/archiving fee management structures and consolidating fees |
| 0x08 | Close Public Fund | Authorize closing public fund data streams and preventing further proofs or UTXO discovery (i.e. tx lookup must be used) |
| 0x10 | Fee Minting | Authorize FeeMinter to create new fee token NFTs with encoded fee parameters |
| 0x40 | RESERVED | Reserved for future usage
| 0x80 | Release Vault Authorization | Authorize releasing funds from vault contracts and SimpleVault operations |

### Combining Permissions

Multiple permissions may be combined using bitwise OR operations:

```
// Example: Minter + Vault Release permissions
permissions = 0x01 | 0x80 = 0x81

// Example: All permissions
permissions = 0x01 | 0x02 | 0x04 | 0x08 | 0x10 | 0x20 | 0x80 = 0xBF
```

## See Also

- [01-SYSTEM_ARCHITECTURE.md](01-SYSTEM_ARCHITECTURE.md) - System design overview
- [02-CONTRACT_SPECIFICATIONS.md](02-CONTRACT_SPECIFICATIONS.md) - Contract details
- [03-TRANSACTION_BUILDER_API.md](03-TRANSACTION_BUILDER_API.md) - Transaction API
- [04-INTEGRATION_GUIDE.md](04-INTEGRATION_GUIDE.md) - Integration examples
- [05-FLOW_DIAGRAMS.md](05-FLOW_DIAGRAMS.md) - Visual flow diagrams
