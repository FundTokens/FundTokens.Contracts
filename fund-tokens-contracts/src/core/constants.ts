/** The all-zero category that stands for Bitcoin (BCH) wherever a token category is expected. */
export const BitcoinCategory = '0'.repeat(64);

/** Largest fungible token amount a CashTokens output can carry (2^63 - 1). */
export const MaxTokenAmount = 9_223_372_036_854_775_807n;

/** Total BCH supply, in satoshis. */
export const MaxSatoshis = 2_100_000_000_000_000n;
