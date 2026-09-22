import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['src/**/*.test.ts'],
        setupFiles: ['./test-utils/setup.ts'],
        testTimeout: 50_000,
        silent: 'passed-only',
        disableConsoleIntercept: true,
        printConsoleTrace: false,
    },
    resolve: {
        alias: {
            '@test-utils': path.resolve(root, 'test-utils'),
        },
    },
});
