# FundTokens.Contracts

FundTokens lets anyone hold a trustless, self-custodial basket of BitcoinCash native assets using CashTokens and smart contracts. No middlemen. Transparent rules. On-chain.

## FundToken's System

* Owner PubKey
* Auth Head PKH
* Fee Tokens
    1. Create
    2. Execute
* Inflow Token
* Outflow Token
* Public Fund Token

## Contracts

1. Owner, System Maint Contracts
    1. Simple Minter - Owner can mint new tokens to the required destination
    1. Fee Minter - Owner can mint new fees to the required destination
1. New Public Fund
    1. GOTO -> New Fund Thread
    1. Public Fund - Verify the FundToken is properly started
1. New Fund Thread
    1. Startup - Verify fund details, and only inflow/outflow tokens used in tx
    1. Fee - Verify fee paid
    1. Fund Mint (Inflow) - Mint a new inflow token to a fund's manager
    1. Fund Mint (Outflow) - Mint a new outflow token to a fund's manager
1. Fund Inflow
    1. Manager - Validate the inflow transaction
    1. Fund - Hold and release the fund tokens
    1. Fee - Verify fee paid
1. Fund Outflow
    1. Manager - Validate the outflow transaction
    1. Fund - Collect the fund tokens
    1. Asset - Hold and release the fund's assets
    1. Fee - Verify fee paid