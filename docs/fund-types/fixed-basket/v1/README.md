# Fixed Basket v1

The first fixed basket contracts: 14 CashScript contracts that create funds, mint and
redeem fund tokens, collect fees and publish fund definitions on-chain.

Source: [fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts).
Exact rules, transaction layouts and encodings: [agent specs](../../../agents/fixed-basket/v1/CONTRACTS.md).

## Contracts

### Per fund

Each fund gets its own contracts, whose addresses are derived from the fund definition.

| Contract | Source | Role |
| --- | --- | --- |
| TransactionManager | [manager.cash](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts/manager.cash) | Holds the fund's threads and does all the accounting for mints and redemptions |
| FundManager | [fund.cash](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts/fund.cash) | Holds the unminted fund token supply |
| AssetManager | [asset.cash](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts/asset.cash) | Holds one reserve: the fund's BCH, or one asset. Releases it only in a redemption |

### Shared by every fund of an instance

| Contract | Source | Role |
| --- | --- | --- |
| FundStartup | [startup.cash](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts/startup.cash) | Validates a fund definition and creates its threads |
| FundInflowMint, FundOutflowMint | [mint_inflow.cash](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts/mint_inflow.cash), [mint_outflow.cash](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts/mint_outflow.cash) | Mint a fund's mint (inflow) and redeem (outflow) threads to its TransactionManager |
| PublicFund | [public.cash](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts/public.cash) | Creates a public fund: mints its whole supply into its FundManager and publishes its definition |
| FeeManager | [fee.cash](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts/fee.cash) | Checks fee payments. One for the create fee, one for the execute fee |
| PublicFundVault | [public_vault.cash](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts/public_vault.cash) | Holds published fund definitions; proves them on-chain; delisting |
| AuthHeadVault | [authhead_vault.cash](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts/authhead_vault.cash) | Holds each public fund's identity (BCMR authhead) |
| SimpleVault | [simple_vault.cash](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts/simple_vault.cash) | Fee vault: collects fees for the maintainer |

### Instance maintenance

| Contract | Source | Role |
| --- | --- | --- |
| InstanceVault | [instance_vault.cash](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts/instance_vault.cash) | Publishes the instance parameters and lifecycle state; proves them on-chain |
| SimpleMinter | [simple_minter.cash](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts/simple_minter.cash) | Mints new system threads (fund creation capacity) |
| FeeMinter | [fee_minter.cash](../../../../fund-tokens-contracts/src/fund-types/fixed-basket/v1/contracts/fee_minter.cash) | Issues fee tokens (alternative fee prices or payment tokens) |

Maintenance actions need an authorization token with the right permission; see
[system tokens](TOKENS.md#authorization).

## Operations

### Create a fund

One transaction, built by `PublicFundTransactionBuilder.addBroadcast`:

- Input 0 spends output 0 of a transaction (the genesis UTXO); that transaction's id
  becomes the fund's token category.
- FundStartup checks the definition: a positive `amount`, BCH backing in range, assets in
  ascending category order with positive amounts.
- FundInflowMint and FundOutflowMint mint the fund's first threads to its TransactionManager.
- PublicFund mints the whole supply (2⁶³−1 fund tokens) into the FundManager, sends the
  fund's identity output to the AuthHeadVault, and publishes the definition to the
  PublicFundVault in 128-byte pieces.
- The create fee is paid.

More thread pairs can be added later the same way, without PublicFund.

### Mint (inflow)

The user spends an inflow thread, the execute fee and FundManager supply, and deposits
`units × satoshis` BCH and `units × amount` of each asset into the AssetManagers. The
TransactionManager checks that exactly `units × fund.amount` fund tokens leave the
FundManager.

### Redeem (outflow)

The user spends an outflow thread and the execute fee, pays `units × fund.amount` fund tokens
back to the FundManager, and releases exactly `units ×` the backing from every reserve
(change returns to the reserve). AssetManagers release only alongside the fund's own
outflow thread, and the TransactionManager checks every amount.

### Proofs

Anyone can prove a fund's definition or the instance parameters on-chain by spending the
published NFTs and returning them unchanged.

## Limits

- Funds of up to **100 assets** (plus BCH) are accepted by the library: the most whose
  redemption fits in a standard transaction. The protocol itself sets no limit, so larger
  funds can exist; clients are expected not to create or deposit into them.
- Large funds need extra compute, bought with padding: fund creation beyond 78 assets.
  Redemptions fit without padding. See [LIMITS](../../../agents/fixed-basket/v1/LIMITS.md).
- A redemption that would release too many custody UTXOs to fit is refused; redeem fewer
  units per transaction.

## Docs

- [System tokens](TOKENS.md): instance, threads, public fund, fees, authorization
- [Builder API](BUILDERS.md): v1 builders, encoding, fees
- Agent specs: [contracts](../../../agents/fixed-basket/v1/CONTRACTS.md),
  [transactions](../../../agents/fixed-basket/v1/TRANSACTIONS.md),
  [encodings](../../../agents/fixed-basket/v1/ENCODINGS.md),
  [limits](../../../agents/fixed-basket/v1/LIMITS.md)
