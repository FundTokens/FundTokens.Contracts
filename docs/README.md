# FundTokens Documentation

## Start here

| Doc | For |
| --- | --- |
| [Overview](OVERVIEW.md) | What FundTokens is and how it works: instances, fund types, versions, threads, fees, maintenance |
| [Integration guide](INTEGRATION_GUIDE.md) | Creating funds, minting and redeeming with `@fundtokens/builders` |
| [Library API](LIBRARY_API.md) | The shared library API: registry, fund type resolver, errors |
| [Fund types](fund-types/README.md) | Every fund type and contract version, with its contracts, tokens and builder API |

## Fund types and versions

FundTokens supports several fund types, each with frozen contract versions. Docs follow the
same layout as the code:

```
docs/
├── README.md, OVERVIEW.md, INTEGRATION_GUIDE.md, LIBRARY_API.md   ← shared by every fund type
├── fund-types/
│   ├── README.md                   ← catalog of fund types and versions
│   ├── fixed-basket/
│   │   ├── README.md               ← what a fixed basket is; its versions
│   │   └── v1/
│   │       ├── README.md           ← contracts and how operations work
│   │       ├── TOKENS.md           ← system tokens: instance, threads, fees, authorization
│   │       └── BUILDERS.md         ← v1 builder API
│   └── bch-usd-target-blend/README.md  ← planned
└── agents/                         ← implementation-level specs for AI agents and auditors
```

## For AI agents and auditors

[agents/](agents/README.md) holds the exhaustive reference: every contract check, the input
and output layout of every transaction, every byte encoding and the measured limits. The
human docs summarise it. Agents working in the repository should also read
[AGENTS.md](../AGENTS.md).
