# Flow Diagrams & Visual Reference

This document contains visual diagrams of key FundToken workflows.

## 1. System Initialization Flow

```
Genesis Tokens
  │
  ├─ inflow (seed)
  ├─ outflow (seed)
  ├─ publicFund (seed)
  └─ fee tokens (seeds)
  ├─ authorization (seed)
  │
  └──→ Initialize System
       │
       └──→ Creates system threads:
            ├─ Inflow holding contract & token
            ├─ Outflow holding contract & token
            ├─ PublicFund holding contract & token
            ├─ Create fee minter & manager
            ├─ Execute fee minter & manager
       │
       └──→ Ready for fund creation
```

## 2. Fund Creation Sequence Diagram

```
User
 │
 ├─ Prepares fund definition:
 │  ├─ Fund category (from genesis txid)
 │  ├─ Fund amount divisor
 │  ├─ Bitcoin satoshis per token
 │  └─ Assets (sorted by category)
 │
 └──→ PublicFundTransactionBuilder.addBroadcast()
      │
      ├─ Input: Genesis UTXO
      ├─ Input: Startup contract
      ├─ Input: Inflow thread token
      ├─ Input: Outflow thread token
      ├─ Input: Create fee token
      ├─ Input: PublicFund thread token
      │
      └─ FundStartup.start(fund) ─┐
         │ Validates:              │
         │ ✓ Fund amount > 0        │
         │ ✓ Satoshis in range     │
         │ ✓ Assets sorted         │
         │ ✓ Asset amounts > 0     │
         │ Mints inflow/outflow    │
         │ NFTs with commitment    │
         │                         │
         └─────────────────────────┘
                      │
                      ├─ Output: Startup returned
                      ├─ Output: Inflow NFT (minting capability)
                      ├─ Output: Outflow NFT (minting capability)
                      ├─ Output: Fee payment routed
                      ├─ Output: Fund manager contract instances
                      ├─ Output: Fund contract instance
                      ├─ Output: Asset contract instances
                      └─ Outputs: Fund data chunks (PublicFund)
                             │
                             └─ NFT commitments: 128-byte chunks
                                containing sorted assets & amounts
```

## 3. Fund Inflow (Minting) Transaction

```
User Deposits Assets → Fund Tokens
        │
        └─ Transaction Setup:
           ├─ Input: Inflow manager token (signals thread)
           ├─ Input: Fund token UTXO (holds supply)
           ├─ Input: Execute fee UTXO
           ├─ Input: Bitcoin (user)
           ├─ Input: Asset 1 (user)
           ├─ Input: Asset 2 (user)
           │
           └─ FundManager.inflow(fund) ─┐
              │ Validates:               │
              │ ✓ Inflow token present  │
              │ ✓ matching commitment   │
              │ ✓ Thread valid          │
              │ Calculates tokens      │
              │ = (in - out) / amount  │
              │ ✓ Multiple of amount   │
              │                        │
              └────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
         └─ Fund.mint() Validates:
            │ ✓ Inflow token in prev input
            │ ✓ Returns to self with funds
            │ ✓ All tokens same category
            │
            └─ Outputs:
               ├─ Inflow manager (returned)
               ├─ Fund tokens (released to user)
               └─ Fund UTXO (returned)
                  │
                  └─ Fee.pay()
                     │ Routes fee:
                     │ ✓ From commitment or default
                     │ or destination override
                     │
                     └─ Outputs:
                        ├─ Fee token (returned)
                        ├─ Fee payment
                        │
         ┌──────────────┼───────────────┐
         │              │               │
    For Each Asset:
         │
         └─ AssetManager.release()
            │ Requires:
            │ ✓ Outflow token seen
            │ ✓ Matching fund hash
            │
            └─ Outputs:
               ├─ Asset to user
               └─ Asset UTXO (returned)
                        │
         ┌──────────────┴──────────────┐
         │                             │
    User receives:
    ├─ Fund tokens (amount × fund_amt)
    ├─ Bitcoin change
    ├─ Asset 1 change (if over-deposited)
    └─ Asset 2 change (if over-deposited)
```

## 4. Fund Outflow (Redemption) Transaction

```
User Redeems Tokens ← Underlying Assets
        │
        └─ Transaction Setup:
           ├─ Input: Fund tokens to redeem (user)
           ├─ Input: Outflow manager token (signals thread)
           ├─ Input: Fund token UTXO (current supply)
           ├─ Input: Execute fee UTXO
           ├─ Input: Satoshi asset UTXOs (as needed)
           ├─ Input: Asset 1 UTXOs (as needed)
           └─ Input: Asset 2 UTXOs (as needed)
                 │
                 └─ FundManager.outflow(fund) ─┐
                    │ Validates:                │
                    │ ✓ Outflow token present  │
                    │ ✓ matching commitment   │
                    │ ✓ Thread valid          │
                    │ Collects fund tokens    │
                    │ = amount × fund_amount │
                    │                        │
                    └────────────────────────┘
                             │
                ┌────────────┼────────────┐
                │            │            │
                └─ Fund.redeem()
                   │ Validates:
                   │ ✓ Outflow token
                   │ ✓ Token collection
                   │ ✓ Returns with more
                   │
                   └─ Outputs:
                      ├─ Outflow manager (returned)
                      ├─ Fund tokens (collected + input)
                      └─ Fund UTXO (returned)
                             │
                             └─ Fee.pay()
                                │ Routes fee
                                │
         ┌──────────────────────┼──────────────────────┐
         │                      │                      │
    For Satoshi Assets:    For Each Token Asset:
         │                      │
         └─ AssetManager.release()
            │ For Bitcoin:      For Tokens:
            │ ✓ No token input  ✓ Token input
            │ ✓ Outputs SAT    ✓ Outputs tokens
            │                  │
            └─ Returns:        └─ Returns:
               ├─ Satoshis        ├─ Tokens
               └─ Change (sats)   └─ Change (tokens)
                      │                   │
         ┌────────────┴───────────────────┤
         │                                │
    User receives:
    ├─ Bitcoin (amount × satoshis_per_token)
    ├─ Asset 1 tokens (amount × asset1_per_token)
    ├─ Asset 2 tokens (amount × asset2_per_token)
    ├─ Satoshi change
    ├─ Asset 1 change
    └─ Asset 2 change
```

## 5. Fee Processing Flow

```
Fee UTXO Structure
│
├─ Token Category: Fee token NFT
├─ NFT Commitment: [category | amount | destination]
│
└─ Fee.pay() Flow:
   │
   ├─ If Fee Token:
   │  ├─ Parse commitment
   │  ├─ Extract: Category | Amount | Destination (optional)
   │  │
   │  └─ Route based on category:
   │     ├─ Category = 0x00 → Bitcoin payment
   │     │  └─ Output: amount satoshis to destination
   │     │
   │     └─ Category = Token → Token payment
   │        └─ Output: amount tokens to destination
   │
   └─ Else (No Fee Token):
      └─ Default payment
         └─ Output: defaultValue satoshis to default destination
```

## 6. Threading & Concurrency

```
System Threads Pool
│
├─ Inflow Thread 1 ─┐
├─ Inflow Thread 2  │
├─ Inflow Thread N  │─→ Enables parallel transactions
│                   │
├─ Outflow Thread 1─┤
├─ Outflow Thread 2 │
├─ Outflow Thread N─┘
│
└─ Selection:
   │
   ├─ User initiates transaction
   ├─ Builder randomly selects thread
   ├─ Transaction uses corresponding token
   ├─ Parallel execution via different thread UTXOs
   │
   └─ If no thread available:
      └─ Error: "Missing required UTXO"
         Remedy: Add system threads
```

## 7. Asset Sorting Requirement

```
Fund With 3 Assets
│
├─ MUST be sorted by category ↑
│
│  Category: "0x99..." → Amount: 5
│  Category: "0x88..." → Amount: 3
│  Category: "0x77..." → Amount: 2
│                ▲
│                │ INVALID - out of order
│        
│        Correct order:
│        Category: "0x77..." → Amount: 2
│        Category: "0x88..." → Amount: 3
│        Category: "0x99..." → Amount: 5
│                ▲
│                │ Valid - ascending
│
└─ Validation: Deployed contracts check ordering
```

## 8. Transaction Builder State Machine

```
PublicFundTransactionBuilder
│
├─ State: Genesis Input Added
│  └─ Ready: addBroadcast()
│
├─ State: Broadcast Added
│  └─ Ready: addInput(), addOutput() (no inputs/outputs yet)
│
├─ State: Inputs Added
│  └─ Properties: I/O structured per flow diagrams
│
└─ State: Complete
   └─ Ready: send()


FundTokenTransactionBuilder
│
├─ State: Initialized
│  └─ Ready: addInflow() or addOutflow()
│
├─ State: Inflow Added
│  └─ Results: Contract inputs/outputs added
│     User must: add account inputs/outputs
│
├─ State: User I/O Added
│  └─ Properties: Balanced inputs/outputs
│
└─ State: Ready to Sign & Send
   └─ Ready: send()
```

## 9. Fund Lifecycle Timeline

```
T0: Fund Creation
    │
    ├─→ PublicFundTransactionBuilder.addBroadcast()
    │   └─ Contracts deployed
    │   └─ Threads created
    │   └─ Fund parameters broadcast
    │
T1: Initial Deposit
    │
    ├─→ User mints first fund token
    │   └─ Fund ready for all operations
    │
T2: Ongoing Operations
    │
    ├─→ Many users mint/redeem
    │   └─ Transactions parallelized across threads
    │   └─ UTXO congestion prevented
    │
T3: Thread Congestion (Optional)
    │
    ├─→ Add more system threads
    │   └─ Fund continues with expanded capacity
    │
T∞: Fund Operates Indefinitely
    │
    └─ No expiration
    └─ No upgrade needed
    └─ Non-custodial operation
```

## 10. Commitment Structure Deep Dive

```
Fund Commitment (NFT)
├─ Stored in: Inflow/Outflow token NFT commitments
├─ Size: Up to 128 bytes (CashToken limit)
│
└─ Format:
   ├─ [0:32 bytes]   → Fund category (which token is this fund)
   ├─ [32:40 bytes]  → Fund amount (divisor)
   ├─ [40:48 bytes]  → Satoshis per token
   │
   ├─ [48:80]   → Asset 1 category + amount
   ├─ [80:112]  → Asset 2 category + amount
   │
   └─ Example (2 assets):
      32 + 8 + 8 + 40 + 40 = 128 bytes
      
      Can fit:
      ├─ 0 assets:  48 bytes (base)
      ├─ 1 asset:   88 bytes
      ├─ 2 assets: 128 bytes ← One broadcast NFT
      └─ 3+ assets: 168 bytes ← Two broadcast NFT


Fee Token Commitment (NFT)
├─ Stored in: Fee manager fund token NFT
│
└─ Format:
   ├─ [0:32 bytes]  → Fee category (0x00=Bitcoin, else token)
   ├─ [32:40 bytes] → Fee amount (int64 LE)
   └─ [40:...]      → Destination (locking bytecode, optional)
   
   Examples:
   ├─ Bitcoin fee:  [0x00...00][00e86400000000][empty]
   │                = 10,000 satoshis to default 
   │
   └─ Token fee:    [token_cat][64000000000000][address_bytecode]
                    = 100 tokens to custom address
```

## 11. Contract Hashing

```
Contract instances are deployed with parameters that are hashed
to create unique contract addresses.

Example: FundManager instantiation

FundManager parameters:
├─ fee → hash256(feeContract.bytecode)
├─ inflowToken
├─ outflowToken
├─ fundCategory
├─ fundHash
├─ fundContract (bytecode)
└─ assetContract (bytecode)

Result:
├─ Parameters encoded
├─ Hash256 computed
├─ Created as P2SH32 locking bytecode
└─ = Unique address per fund + thread combination
```

## 12. Error Recovery Paths

```
Transaction Fails
│
├─ Missing Inflow Token
│  └─ Action: Add system threads
│     └─ Retry transaction
│
├─ Insufficient Assets
│  └─ Action: Deposit more assets to contracts
│     └─ Retry transaction
│
├─ Fee Unavailable
│  └─ Action: Create fee tokens or use Bitcoin
│     └─ Retry with payBy parameter
│
├─ Invalid Fund Specification
│  └─ Action: Fix asset ordering, amounts, ranges
│     └─ Recreate fund with corrections
│
└─ Asset Sorting Error
   └─ Action: Sort assets by category ascending
      └─ Recreate fund with sorted assets
```

---

## Key Insights

### Validation Points

Each contract validates specific aspects:

```
FundStartup   → Fund parameters (amount, satoshis, sorting)
PublicFund    → Fund broadcast & contract deployment
FundManager   → Thread & transaction authorization  
Fund          → Token accounting & mathematics
AssetManager  → Asset release authorization
FeeManager    → Fee routing & computation
```

### Non-Custodial Guarantee

```
Fund token holder always owns the underlying assets:
- When minting: User sends assets → receives fund token
- When holding: Fund contract holds collateral
- When redeeming: User sends fund token → receives assets

No intermediary can:
- Freeze assets
- Change fund parameters
- Steal tokens
- Refuse redemption
```

---

## See Also

- [01-SYSTEM_ARCHITECTURE.md](01-SYSTEM_ARCHITECTURE.md) - System design
- [02-CONTRACT_SPECIFICATIONS.md](02-CONTRACT_SPECIFICATIONS.md) - Contract code
- [03-TRANSACTION_BUILDER_API.md](03-TRANSACTION_BUILDER_API.md) - API reference
- [04-INTEGRATION_GUIDE.md](04-INTEGRATION_GUIDE.md) - Integration examples
