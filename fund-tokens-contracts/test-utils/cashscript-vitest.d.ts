// cashscript's matchers are typed for jest; declare them for vitest. They run synchronously.
import 'vitest';

declare module 'vitest' {
    interface Assertion<T = any> {
        toFailRequire(): void;
        toFailRequireWith(value: RegExp | string): void;
        toLog(value?: RegExp | string): void;
    }
}
