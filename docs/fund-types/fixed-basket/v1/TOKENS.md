# Fixed Basket v1: System Tokens

Each instance has its own system token categories, listed in its parameters. They are
CashToken NFTs that coordinate the contracts. Byte layouts are in the
[agent encodings](../../../agents/fixed-basket/v1/ENCODINGS.md).

| Token | Held by | Purpose |
| --- | --- | --- |
| [Instance](#instance) | InstanceVault | Publishes the instance parameters and lifecycle state |
| [Inflow and outflow](#threads) | FundInflowMint, FundOutflowMint, each fund's TransactionManager | A fund's mint and redeem threads |
| [Public fund](#public-fund) | PublicFund, PublicFundVault | Creating public funds; their published definitions |
| [Fees](#fees) | FeeMinter, FeeManager | Alternative fee prices and payment tokens |
| [Authorization](#authorization) | The maintainer | Permission to perform maintenance |

The thread, public fund, fee and authorization categories also have **minting** NFTs that
issue new tokens, numbered by a serial counter. The instance category must have none, so no
second instance NFT can ever be minted.

## Instance

Two NFTs created once per instance: a mutable proof NFT holding the type, lifecycle state,
contract version and a hash, and an immutable data NFT. Together they hold the instance
parameters, so anyone can recover and verify them on-chain.

| State | Meaning |
| --- | --- |
| Pre-release | Early access, use at your own risk |
| Main | The instance to use for new funds |
| Deprecated | No new funds; existing funds keep working |
| Vulnerable | A vulnerability was found: redeem holdings |

- The state changes only with permission `0x0040`, and only to one of these four.
- **Vulnerable is permanent**: once set, the state can never change again.
- The instance NFTs can be burned (permission `0x0080`) only once deprecated or vulnerable.
  The parameters stay recoverable from transaction history.

## Threads

Each fund has inflow (mint) and outflow (redeem) threads: immutable NFTs held by its
TransactionManager, committing to the fund's category and hash. A mint or redemption spends
one and returns it, so a fund with more threads serves more users at once. Thread pairs are
minted by FundInflowMint and FundOutflowMint at fund creation, or later for a create fee.

## Public fund

PublicFund holds a minting NFT that, at each fund creation, publishes the fund definition as
a series of immutable NFTs to the PublicFundVault: the fund's on-chain listing. Anyone can
prove a definition by spending the series and returning it unchanged. Delisting (permission
`0x0100`) burns the series; the fund itself keeps working.

## Fees

The create and execute fees each have a fee token category. A FeeManager UTXO is either:

- **Default**: no token; pay the instance's default fee in BCH to the fee vault. Always available.
- **Enforced fee NFT**: pay an encoded amount of BCH or of a CashToken, to the fee vault or an
  encoded destination.
- **Voluntary fee NFT**: pay anything (BCH or a token) to the fee vault, or nothing (an
  empty OP_RETURN).

The maintainer issues fee NFTs (permission `0x0010`) and can close fee UTXOs (`0x0020`),
burning their NFTs. Closing cannot send anything back to the fee contract; to consolidate,
close, then send a new default fee UTXO separately. Builders choose the cheapest fee
payable in `payBy` (BCH by default).

## Authorization

Authorization NFTs carry permission bits. A token may combine several (bitwise OR), so
each maintainer, person or service can hold only what it needs.

| Bit | Contract | Permission |
| --- | --- | --- |
| 0x0001 | SimpleMinter | Mint system threads (inflow, outflow, public fund) |
| 0x0002 | SimpleVault | Release vault UTXOs, e.g. collected fees |
| 0x0004 | AuthHeadVault | Update a fund identity (BCMR) |
| 0x0008 | AuthHeadVault | Burn fund identities |
| 0x0010 | FeeMinter | Issue fee NFTs |
| 0x0020 | FeeManager | Close fee UTXOs |
| 0x0040 | InstanceVault | Change the instance's lifecycle state (never from vulnerable) |
| 0x0080 | InstanceVault | Burn a deprecated or vulnerable instance |
| 0x0100 | PublicFundVault | Delist a public fund |
| 0xFE00 | | Reserved |

- Only an immutable authorization NFT authorizes.
- A token held by the contract it would authorize does not count, so an authorization token
  sent to a contract cannot authorize its own release. Keep authorization tokens outside the
  contracts they authorize.
- There is no revocation: retire a token by burning it.
