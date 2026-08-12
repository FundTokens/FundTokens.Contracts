# Authorization Token

This document provides detailed specifications for the authorization token system, including commitment encoding of permission bits.

## Overview

The Authorization Token is a single or multiple CashToken NFT that gates maintenance and administrative operations within the FundTokens system. Unlike inflow/outflow tokens which enable user transactions, authorization tokens control system-level actions such as token minting, fee management, and fund delisting.

## Authorization Token Commitment Format

Authorization token commitments encode permission flags into CashToken NFTs. The maintainer can delegate least rights access to every "sensitive" platform operation to applications or people that maintain the system.

### Commitment Structure

```
[auth_type (1 byte)][permission_flags (2 byte)][serial_number (vm number)]
```

- **auth_type**: One byte containing the authorization token type
- **permission_flags**: Two bytes containing packed permission bits
- **serial_number**: VM number encoded serial number

### Auth Types

| Hex | Capability | Auth Type | Purpose |
|-----|------------|-----------|---------|
| 0x00 | Minting | New Tokens | Mint new authorization tokens as needed and maintain serial number for next minting |
| 0x01 | None | User | A user held token that can be used at will |
| 0x02 | Mutable\|None | Contract | A contract held token that can be used based on the contract's spend conditions |

### Permission Bits

Each bit in the permission flags byte represents a specific authorization capability:

| Hex | Permission | Purpose |
|-----|------------|---------|
| 0x0001 | Token Minters | Authorize SimpleMinter to mint system tokens (inflow, outflow, public fund tokens) |
| 0x0002 | Update AuthHead | Authorize updating BCMR (BitcoinCash Metadata Registry) metadata via AuthHeadVault |
| 0x0020 | Burn AuthHead Identity | Authorize burning authhead identities to signal permanent identity closure or rotation |
| 0x0004 | Close Fee | Authorize closing/archiving fee management structures and consolidating fees |
| 0x0008 | Close Public Fund | Authorize closing public fund data streams and preventing further proofs or UTXO discovery (i.e. tx lookup must be used) |
| 0x0010 | Fee Minting | Authorize FeeMinter to create new fee token NFTs with encoded fee parameters |
| 0x0040 | Burn Instance Tokens | Authorize burning on-chain instance encoded data
| 0x0080 | Release Vault Authorization | Authorize releasing funds from vault contracts and SimpleVault operations |
| 0xFF00 | RESERVED (MULTI) | Reserved for future usage

#### Combining Permissions

Multiple permissions may be combined using bitwise OR operations:

```
// Example: Minter + Vault Release permissions
permissions = 0x0001 | 0x0080 = 0x0081

// Example: All permissions
permissions = 0x0001 | 0x0002 | 0x0004 | 0x0008 | 0x0010 | 0x0020 | 0x0080 = 0x00BF
```

### Serial Number

A serial number (VM Number encoded) that can be used to easily reference specific tokens i.e. users and systems

## See Also

- [01-SYSTEM_ARCHITECTURE.md](01-SYSTEM_ARCHITECTURE.md) - System design overview
- [02-CONTRACT_SPECIFICATIONS.md](02-CONTRACT_SPECIFICATIONS.md) - Contract details
- [03-TRANSACTION_BUILDER_API.md](03-TRANSACTION_BUILDER_API.md) - Transaction API
- [04-INTEGRATION_GUIDE.md](04-INTEGRATION_GUIDE.md) - Integration examples
- [05-FLOW_DIAGRAMS.md](05-FLOW_DIAGRAMS.md) - Visual flow diagrams
- [06-SYSTEM_TOKENS.md](06-SYSTEM_TOKENS.md) - System token specification
- [07-FEE_TOKEN.md](07-FEE_TOKEN.md) - Fee token specification