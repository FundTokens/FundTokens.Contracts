# Instance Token

This document provides detailed specifications for the instance token system, including commitment encoding.

## Overview

The Instance Token is a CashToken NFT that is used to encode FundToken system details in the startup TX for on-chain verification and recovery.
These tokens are a voluntary one-time proof created in the initial system transaction that encodes all constructor details needed to run FundTokens.

## Instance System Token Commitment Format

Instance token commitments encode FundToken system details into CashToken NFTs.

### Commitment Structure

```
[type (1 byte)][hash (32 byte)] | [type (1 byte)][inflow (32 bytes)][outflow (32 bytes)][publicFund (32 bytes)][authorization (32 bytes)][fees_create_nft (32 bytes)][fees_create_sats (4 bytes)][fees_execute_nft (32 bytes)][fees_execute_sats (4 bytes)]
```

- **type**: One byte containing the token type
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

| Hex | Capability | Type | Purpose |
|-----|------------|-----------|---------|
| 0x00 | None | System Hash | Contains the system hash for on-chain verification |
| 0x01 | None | System Details | Contains the system parameters for on-chain reference and history |

## See Also

- [01-SYSTEM_ARCHITECTURE.md](01-SYSTEM_ARCHITECTURE.md) - System design overview
- [02-CONTRACT_SPECIFICATIONS.md](02-CONTRACT_SPECIFICATIONS.md) - Contract details
- [03-TRANSACTION_BUILDER_API.md](03-TRANSACTION_BUILDER_API.md) - Transaction API
- [04-INTEGRATION_GUIDE.md](04-INTEGRATION_GUIDE.md) - Integration examples
- [05-FLOW_DIAGRAMS.md](05-FLOW_DIAGRAMS.md) - Visual flow diagrams
- [07-FEE_TOKEN.md](07-FEE_TOKEN.md) - Fee token specification
- [08-AUTHORIZATION_TOKEN.md](08-AUTHORIZATION_TOKEN.md) - Authorization token specification
