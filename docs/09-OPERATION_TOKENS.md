# Operation Tokens

This document provides detailed specifications for the Inflow/Outlfow token system, including commitment encoding.

## Overview

The operation tokens are multiple CashToken NFTs that enables user operations such as fund inflow and outflow. These tokens are a technical requirement used to create a secure method for contracts to compose themselves using TX introspection.

## Operation Tokens Commitment Format

Operation token commitments encode token type and serial numbers into CashToken NFTs.

### Commitment Structure

The commitment structure can operate as a serial (at least two bytes) or can contain a created fund's category and hash (65 bytes).

```
[type (1 byte)][serial_number (vm number)] | [type (1 byte)][fund_category (32 bytes)][fund_hash (32 bytes)]
```

- **type**: One byte containing the token type
- **serial_number**: VM number encoded serial number
- **fund_category**: The fund's token category
- **fund_hash**: The fund's hash

### NFT Types

| Hex | Capability | Role | Description |
|-----|------------|-----------|---------|
| 0x00 | Minting | New Thread Creation | Mint new executing threads as needed and maintain serial number for next minting |
| 0x01 | Minting | Fund Thread Creation | Mint new fund executing threads for the user. Many threads may be minted per fund |
| 0x02 | None | Executing Thread | Execution thread on smart contract for a fund. |

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
