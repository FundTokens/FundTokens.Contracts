# FundTokens Overview

FundTokens lets anyone create a **fund token**: a CashToken on Bitcoin Cash backed by a
basket of BCH and other CashTokens held by smart contracts. Depositing the basket mints
fund tokens; returning fund tokens redeems the basket. No custodian, no admin keys over
funds, and every rule is enforced on-chain.

## Concepts

**Fund type.** The kind of fund: what backs it and how minting and redemption are priced.
Each fund type has its own contracts. Today:

| Fund type | Status |
| --- | --- |
| [Fixed basket](fund-types/fixed-basket/README.md): a fixed basket of BCH and CashTokens per unit | v1, live |
| [BCH/USD Target Blend](fund-types/bch-usd-target-blend/README.md): BCH and a USD token in target weights | planned |

**Contract version.** A fund type's contracts are released as versions (`v1`, `v2`, …).
A released version never changes; improvements ship as a new version, and funds on an older
version keep working with the builders that match it.

**Instance.** One deployment of a fund type version: its system contracts and system
tokens, with fixed parameters (token categories, fees). Every fund belongs to one instance.
The [registry](LIBRARY_API.md#fundtokensregistry) lists instances and says which is current.

**Fund.** A fund token category and its definition. For a fixed basket: how many fund
tokens make one *unit*, and the BCH and assets backing each unit. The definition is fixed
at creation and published on-chain.

## Lifecycle of a fund

1. **Create.** One transaction defines the fund, mints its whole token supply into a fund
   contract, creates its first execution threads, pays the create fee and publishes the
   definition on-chain.
2. **Mint.** A user deposits the backing for some units and receives the matching fund
   tokens. Pays the execute fee.
3. **Redeem.** A user returns fund tokens and receives the backing. Pays the execute fee.
4. Funds never expire and need no upgrade.

Threads let many users mint and redeem at once: each operation spends one of the fund's
threads (a small token UTXO), so concurrent users pick different threads instead of
competing for one UTXO. More threads can be added at any time.

## Fees

Each instance has a **create** fee (fund creation and new threads) and an **execute** fee
(each mint or redeem, regardless of size). A default fee in BCH always works, so funds can
never be locked out. The maintainer can also issue fee tokens offering other prices,
payment in a CashToken, or voluntary payment. Builders pick the cheapest option.

## Maintenance and instance state

A maintainer holds **authorization tokens** whose permission bits allow specific actions:
adding system threads, issuing and closing fees, collecting fees, updating fund identities
(BCMR), delisting a public fund's on-chain listing, and changing an instance's state.
None of them can move a fund's backing, change a fund, or stop redemptions.

Each instance publishes a **lifecycle state** on-chain, mirrored by the registry:

| State | Meaning |
| --- | --- |
| Pre-release | Early access |
| Main | The instance to use for new funds |
| Deprecated | No new funds; existing funds keep working |
| Vulnerable | A vulnerability was found: redeem holdings. Permanent: the warning cannot be withdrawn |

## Security model

- **Non-custodial.** Backing is held by contracts and released only by redemption.
- **Immutable funds.** A fund's definition is hashed into its tokens and contracts; it cannot change.
- **No admin keys over funds.** Authorization tokens manage system threads, fees and listings only.
- **Lockout prevention.** Default BCH fees and permissionless threads keep every fund usable.
- **Frozen versions.** Contracts never change after release.
- **Verifiable deployment.** Each instance is seeded once with its system tokens: one minting
  NFT per system category and the two instance NFTs. The contracts rely on that seeding but
  cannot check it themselves; clients can, on-chain, from each category's genesis transaction
  and the instance NFTs, instead of trusting the deployer or the registry:
  [trust assumptions](agents/fixed-basket/v1/CONTRACTS.md#trust-assumptions).

## Technology

Bitcoin Cash with CashTokens, contracts in CashScript 0.14, and the
`@fundtokens/builders` TypeScript library (cashscript and libauth). Contract versions and
their docs live side by side: see [fund types](fund-types/README.md).
