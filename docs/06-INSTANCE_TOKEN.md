# Instance Token

This document provides detailed specifications for the Instance token system, including commitment encoding.

## Overview

The Instance token is a CashToken NFT that is used to encode FundToken system details in the startup TX for on-chain verification and recovery.
These tokens are a voluntary one-time proof created at initial token seeding. The tokens can be used to reconstruct the parameters required to execute FundTokens.

## Instance System Token Commitment Format

Instance token commitments encode FundToken system details into CashToken NFTs.

### Commitment Structure

The 235 byte structure is split across two CashTokens NFT w/ limit of 128bytes per NFT commitment.

```
[type (1 byte)][version (2 bytes)][hash (32 bytes)][inflow (32 bytes)][outflow (32 bytes)][publicFund (32 bytes)][authorization (32 bytes)][fees_create_nft (32 bytes)][fees_create_sats (4 bytes)][fees_execute_nft (32 bytes)][fees_execute_sats (4 bytes)]
```

- **type**: One byte containing the token type
- **version**: The working contract version
- **hash**: The hash of the system settings
- **inflow**: The token used as a signal for a Fund's inflow
- **outflow**: The token used as a signal for a Fund's outflow
- **publicFund**: The token used to encode trustless public funds parameters on-chain
- **authorization**: The token used by the system maintainer to manage UTXO threads and fees
- **fees_create_nft**: The token used to encode dynamic fees for creating a new fund
- **fees_create_sats**: A default amount (in satoshis) to create a new fund that prevents total lockout
- **fees_execute_nft**: The token used to encode dynamic fees for executing an existing fund
- **fees_execute_sats**: A default amount (in satoshis) to execute (inflow/outflow operations) that prevents total lockout

### NFT Types

| Hex | Capability | Role | Description |
|-----|------------|-----------|---------|
| 0x00 | None | Instance Proof | Acts as an on-chain proof when spending from it's vault. Additionaly this ensures parameter recovory is always available |

## See Also

- [01-SYSTEM_ARCHITECTURE.md](01-SYSTEM_ARCHITECTURE.md) - System design overview
- [02-CONTRACT_SPECIFICATIONS.md](02-CONTRACT_SPECIFICATIONS.md) - Contract details
- [03-TRANSACTION_BUILDER_API.md](03-TRANSACTION_BUILDER_API.md) - Transaction API
- [04-INTEGRATION_GUIDE.md](04-INTEGRATION_GUIDE.md) - Integration examples
- [05-FLOW_DIAGRAMS.md](05-FLOW_DIAGRAMS.md) - Visual flow diagrams
- [07-FEE_TOKEN.md](07-FEE_TOKEN.md) - Fee token specification
- [08-AUTHORIZATION_TOKEN.md](08-AUTHORIZATION_TOKEN.md) - Authorization token specification
