export type FundTokensErrorCode =
    /** A caller-supplied value is malformed or out of range. */
    | 'INVALID_ARGUMENT'
    /** Encoded data (fund, fee, commitment) could not be decoded. */
    | 'INVALID_ENCODING'
    /** A contract UTXO the transaction depends on does not exist. */
    | 'MISSING_UTXO'
    /** Contract UTXOs exist but do not hold enough to cover the request. */
    | 'INSUFFICIENT_FUNDS'
    /** The builder's existing inputs/outputs don't satisfy an operation's preconditions. */
    | 'INVALID_TRANSACTION_STATE'
    /** The transaction would exceed the standard transaction size, so nodes would not relay it. */
    | 'TRANSACTION_TOO_LARGE'
    /** No fund type or version matches, or the match is not usable yet. */
    | 'UNSUPPORTED_FUND_TYPE'
    /** The feature is declared but not built yet. */
    | 'NOT_IMPLEMENTED'
    /** The registry could not be reached or answered with an error status. */
    | 'REGISTRY_REQUEST_FAILED'
    /** The registry answered, but not with the shape this client expects. */
    | 'REGISTRY_INVALID_RESPONSE'
    /** The registry has no record for the request. */
    | 'REGISTRY_NOT_FOUND';

/**
 * Every error thrown by this library. Branch on `code` rather than on the
 * message, which is written for people and may change.
 */
export class FundTokensError extends Error {
    readonly code: FundTokensErrorCode;

    constructor(code: FundTokensErrorCode, message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'FundTokensError';
        this.code = code;
    }
}

/** An error talking to the registry; carries the request and, when there was one, the HTTP status. */
export class RegistryError extends FundTokensError {
    readonly url: string;
    readonly status: number | undefined;

    constructor(
        code: Extract<FundTokensErrorCode, `REGISTRY_${string}`>,
        message: string,
        details: { url: string; status?: number | undefined; cause?: unknown },
    ) {
        super(code, message, details.cause === undefined ? undefined : { cause: details.cause });
        this.name = 'RegistryError';
        this.url = details.url;
        this.status = details.status;
    }
}

export function isFundTokensError(error: unknown, code?: FundTokensErrorCode): error is FundTokensError {
    return error instanceof FundTokensError && (code === undefined || error.code === code);
}
