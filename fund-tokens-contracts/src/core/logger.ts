/** The logging surface the builders use; `console` satisfies it. */
export interface Logger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

/** Default logger: libraries should not write to the console unless asked to. */
export const silentLogger: Logger = Object.freeze({
    debug() {},
    info() {},
    warn() {},
    error() {},
});
