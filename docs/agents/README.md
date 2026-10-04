# Agent Reference

Exhaustive, implementation-level documentation for AI agents (and auditors) working on
FundTokens. The human docs in [docs/](../README.md) summarise. These files spell out every
rule, byte layout and index, so a change can be checked without re-deriving it from the
contracts.

## Source of truth

1. The contracts (`fund-tokens-contracts/src/fund-types/<type>/<version>/contracts/*.cash`)
2. The tests in the same version directory (they pin the behaviour, including what must be rejected)
3. These agent docs
4. The human docs

When they disagree, the contract wins. Fix the docs in the same change.

## Layout

Docs follow the code: one directory per fund type and contract version.

```
docs/agents/
├── README.md                      ← this file: conventions, notation, maintenance rules
└── <fund-type>/<version>/
    ├── CONTRACTS.md               ← every contract: parameters, functions, every check
    ├── TRANSACTIONS.md            ← input/output layouts of every operation, by index
    ├── ENCODINGS.md               ← byte layouts: fund encoding, NFT commitments, permissions
    └── LIMITS.md                  ← compute budget, padding, transaction size, measured numbers
```

| Fund type | Version | Status | Agent docs |
| --- | --- | --- | --- |
| Token basket (`token-basket`, registry `fixed-basket`) | v1 | supported | [token-basket/v1](token-basket/v1/CONTRACTS.md) |
| Weighted BCH/USD (`weighted-bch-usd`) | v1 | in design, no contracts | [weighted-bch-usd/v1](weighted-bch-usd/v1/DESIGN.md) (design) |

A released version is frozen. A contract change ships as a new version directory in the
code and a new directory here (copy the previous version's docs, then edit). Never edit a
released version's docs to describe a later version.

## Notation

- `a`: `this.activeInputIndex`, the input running the function being described.
- `s`: the FundStartup input in a fund creation; `p`: the PublicFund input (`p = s + 4`).
- `in[i]`, `out[i]`: `tx.inputs[i]`, `tx.outputs[i]`.
- `X + 0x01` / `X + 0x02`: category `X` with the mutable / minting capability byte appended,
  as CashScript sees `tokenCategory`. A bare `X` is an immutable NFT (or fungible tokens only).
- "Returns to itself": the output at the same index has the same locking bytecode, token
  category, NFT commitment and fungible token amount, unless the rule says otherwise.
  Satoshi values of returned UTXOs are never checked.
- Categories inside contract data (fund encodings, commitments, contract parameters) are in
  internal byte order: the reverse of the hex shown by explorers and the library.
  The library converts with `swapEndianness`.

## Repository conventions

See [AGENTS.md](../../AGENTS.md) at the repository root for commands, line endings, testing
helpers and CashScript pitfalls.

## Maintaining these docs

When a contract changes (in an unreleased version):

1. Update that version's `CONTRACTS.md` (the rules), `TRANSACTIONS.md` (any index that moved),
   `ENCODINGS.md` (any byte layout) and `LIMITS.md` (re-measure if the bytecode grew).
2. Update the human summary in `docs/fund-types/<type>/<version>/` only where behaviour a
   reader would notice changed.
3. Keep rule wording testable: each bullet should map to a `require` or a test.
