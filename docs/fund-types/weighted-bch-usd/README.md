# Weighted BCH/USD

**Planned.** A fund holding BCH and a USD-pegged token in target weights.

The library reserves the fund type (`WeightedBchUsd`, key and registry type
`weighted-bch-usd`) so registry listings recognise it. Its v1 has no contracts yet: the
builders and `createInstance` throw `NOT_IMPLEMENTED`, and `FundTypeResolver.supports()`
returns false for its instances.

When v1 is built, document it here following the
[fund type layout](../README.md#documenting-a-fund-type-or-version).
