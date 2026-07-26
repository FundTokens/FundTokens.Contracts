# Fee Token

This document provides detailed specifications for the fee token system, including commitment encoding of fees.

## Overview

The Fee Token is a multiple CashToken NFT that gates access to system functions like public fund creation, additional or private fund threads, and inflow/outflow operations.

## Fee Token Commitment Format

Fee token commitments encode fee details into CashToken NFTs. The maintainer may create and close fees at will and without notice (excluding the use of tx timelocks).

### Commitment Structure

```
[fee_type (0x00) (1 byte)][serial_number (vm number)] | [fee_type (0x01) (1 byte)][fee_category (32 bytes)][fee_amount (8 bytes)][fee_destination? (undefined)]
```

- **fee_type**: One byte containing the fee token type
- **serial_number**: VM number encoded serial number
- **fee_category**: Encoded CashToken category or all zeros for Bitcoin
- **fee_amount**: Encoded fee amount, Bitcoin value or CashToken amount
- **fee_destination**: Locking bytecode for an optional fee destination, fallback to the default vault if none provided

### Fee Types

| Hex | Capability | Auth Type | Purpose |
|-----|------------|-----------|---------|
| 0x00 | Minting | New Tokens | Mint new fee tokens as needed |
| 0x01 | None | Fee NFT | Used to encode fee details |

### Serial Number

A serial number (VM Number encoded) that can be used to easily reference specific tokens i.e. users and systems

## See Also

- [01-SYSTEM_ARCHITECTURE.md](01-SYSTEM_ARCHITECTURE.md) - System design overview
- [02-CONTRACT_SPECIFICATIONS.md](02-CONTRACT_SPECIFICATIONS.md) - Contract details
- [03-TRANSACTION_BUILDER_API.md](03-TRANSACTION_BUILDER_API.md) - Transaction API
- [04-INTEGRATION_GUIDE.md](04-INTEGRATION_GUIDE.md) - Integration examples
- [05-FLOW_DIAGRAMS.md](05-FLOW_DIAGRAMS.md) - Visual flow diagrams