# Fund Types

| Fund type | Key | Versions |
| --- | --- | --- |
| [Fixed basket](fixed-basket/README.md) | `fixed-basket` | [v1](fixed-basket/v1/README.md) (supported) |
| [BCH/USD Target Blend](bch-usd-target-blend/README.md) | `bch-usd-target-blend` | v1 ([in design](../agents/bch-usd-target-blend/v1/DESIGN.md)) |

A fund type defines what backs a fund and how minting and redemption work. Each fund type
ships **contract versions**. A released version is frozen: its contracts, builders and
docs describe it forever, so funds created on it can always be operated. Changes ship as a
new version.

Each fund type has one key, used by the library and as the registry instance's `type`.
Each registry instance names its fund type (`type`) and contract version (`version`).
`FundTypeResolver` picks the matching version from the library
([Library API](../LIBRARY_API.md#fundtyperesolver)).

## Documenting a fund type or version

Docs mirror the code (`fund-tokens-contracts/src/fund-types/<type>/<version>/`):

| Doc | Contents |
| --- | --- |
| `fund-types/<type>/README.md` | What the fund type is, its versions and their status |
| `fund-types/<type>/<version>/README.md` | Contracts and how each operation works, for people |
| `fund-types/<type>/<version>/TOKENS.md` | System tokens and permissions (if the version has them) |
| `fund-types/<type>/<version>/BUILDERS.md` | The version's library API |
| `agents/<type>/<version>/` | Implementation-level specs: [agent docs](../agents/README.md) |

For a new version, copy the previous version's directories (human and agent), then update
them for what changed. Leave the previous version's docs as they are.
