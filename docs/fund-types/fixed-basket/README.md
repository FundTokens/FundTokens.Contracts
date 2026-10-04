# Fixed Basket

A fund backed by a **fixed basket** of BCH and CashTokens, set when the fund is created.

A fund defines a **unit**: `amount` fund tokens, backed by `satoshis` BCH and a fixed
amount of each asset. Minting deposits whole units of backing and receives
`units × amount` fund tokens; redeeming returns them and receives the backing. The price of
a fund token is always its share of the basket: no oracle, no rebalancing, no manager.

Example: a fund with `amount: 10`, `satoshis: 1000` and assets `{ XYZ: 2, DEF: 5 }`.
Depositing 2,000 sats, 4 XYZ and 10 DEF (2 units) mints 20 fund tokens. Redeeming 10 fund
tokens (1 unit) releases 1,000 sats, 2 XYZ and 5 DEF.

| | |
| --- | --- |
| Key (library and registry) | `fixed-basket` |
| Library namespace | `FixedBasket` (`@fundtokens/builders/fixed-basket`) |

## Versions

| Version | Status | Docs |
| --- | --- | --- |
| v1 | supported | [Overview](v1/README.md) · [System tokens](v1/TOKENS.md) · [Builders](v1/BUILDERS.md) · [Agent specs](../../agents/fixed-basket/v1/CONTRACTS.md) |
