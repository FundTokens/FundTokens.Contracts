# System Tokens

This document provides detailed specifications for the system token system, including commitment encoding.

## Overview

The System Tokens is a multiple CashToken NFT that enables user operations such as fund creation/proof and inflow/outflow operations. These tokens are a technical requirement used to create a secure method for contracts to compose themselves using TX introspection.

## System Token Commitment Format

System token commitments encode token type and serial numbers into CashToken NFTs.

### Commitment Structure

```
[type (1 byte)][serial_number (vm number)] | [fund_category (32 bytes)][fund_hash (32 bytes)]
```

- **type**: One byte containing the token type
- **serial_number**: VM number encoded serial number
- **fund_category**: The fund's token category
- **fund_hash**: The fund's hash

### NFT Types

| Hex | Capability | Type | Purpose |
|-----|------------|-----------|---------|
| 0x00 | Minting | Minting Token | Mint new fund minting tokens as needed and maintain serial number for next minting |
| 0x01 | Minting | Fund Creation | Mint new fund contract tokens for the user, many threads may be minted per fund |
| Commitment Length >= 48 | None | Fund Contract | Execution thread on smart contract for a fund, many threads may exist sans public fund proofs |

### Serial Number

A serial number (VM Number encoded) that can be used to easily reference specific tokens i.e. users and systems

## See Also

- [01-SYSTEM_ARCHITECTURE.md](01-SYSTEM_ARCHITECTURE.md) - System design overview
- [02-CONTRACT_SPECIFICATIONS.md](02-CONTRACT_SPECIFICATIONS.md) - Contract details
- [03-TRANSACTION_BUILDER_API.md](03-TRANSACTION_BUILDER_API.md) - Transaction API
- [04-INTEGRATION_GUIDE.md](04-INTEGRATION_GUIDE.md) - Integration examples
- [05-FLOW_DIAGRAMS.md](05-FLOW_DIAGRAMS.md) - Visual flow diagrams
