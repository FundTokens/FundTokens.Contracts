# PublicFund Tokens

This document provides detailed specifications for the PublicFund token system, including commitment encoding.

## Overview

The PublicFund tokens is a CashToken NFT that proves a fund was trustlessly created via smart contract enforcement and enables on-chain verification and recovery.
The tokens are held in a vault to provide a secure method for on-chain proofs and building using TX introspection.

## Publicfund Token Commitment Format

PublicFund token commitments encode token type and serial numbers into CashToken NFTs.

### Commitment Structure

The commitment structure guarantees at least 77 bytes with additional optional 40 byte increments with no contract enforced limit.

```
[type (1 byte)][serial_number (vm number)] | [type (1byte)][fund_hash (32 bytes)][fund_category (32 bytes)][divisor (8 bytes)][satoshis (4 bytes)][[asset_category (32 bytes)][asset_amount (8 bytes)]]*
```

- **type**: One byte containing the token type
- **serial_number**: VM number encoded serial number
- **fund_hash**: The fund's hash
- **fund_category**: The fund's token category

### NFT Types

| Hex | Capability | Role | Purpose |
|-----|------------|-----------|---------|
| 0x00 | Minting | Thread Creation | Mint new UTXO threads (i.e. minting tokens) as needed and maintain serial number for next minting |
| 0x01 | Minting | New PublicFund Creation | Mint new PublicFund NFTs to the vault, many threads may exist |
| 0x02 | None | PublicFund Proofs | Execute an on-chain proof and recreate PublicFund parameters, only one proof will exist. |

### Serial Number

A serial number (VM Number encoded) that can be used to easily reference specific tokens i.e. users and systems

## See Also

- [01-SYSTEM_ARCHITECTURE.md](01-SYSTEM_ARCHITECTURE.md) - System design overview
- [02-CONTRACT_SPECIFICATIONS.md](02-CONTRACT_SPECIFICATIONS.md) - Contract details
- [03-TRANSACTION_BUILDER_API.md](03-TRANSACTION_BUILDER_API.md) - Transaction API
- [04-INTEGRATION_GUIDE.md](04-INTEGRATION_GUIDE.md) - Integration examples
- [05-FLOW_DIAGRAMS.md](05-FLOW_DIAGRAMS.md) - Visual flow diagrams
- [07-FEE_TOKEN.md](07-FEE_TOKEN.md) - Fee token specification
- [08-AUTHORIZATION_TOKEN.md](08-AUTHORIZATION_TOKEN.md) - Authorization token specification
