import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Long-running tests, skipped by default. `yarn test --mode all` (or `yarn test:all`) runs them,
 * as does naming one in a filter, e.g. `yarn test stress`.
 */
const longRunning = [
    'src/fund-types/token-basket/v1/tests/stress.test.ts',
    'src/fund-types/token-basket/v1/tests/audit.vmDensity.test.ts',
    'src/fund-types/token-basket/v1/tests/audit.chunkSize.test.ts',
];

const filters = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
const isRequested = (file: string) => filters.some(filter => filter.includes(path.basename(file, '.test.ts')));

export default defineConfig(({ mode }) => ({
    test: {
        environment: 'node',
        globals: true,
        include: ['src/**/*.test.ts'],
        exclude: [
            ...configDefaults.exclude,
            ...(mode === 'all' ? [] : longRunning.filter(file => !isRequested(file))),
        ],
        setupFiles: ['./test-utils/setup.ts'],
        testTimeout: 50_000,
        // Fixtures (bootstrapping an instance, creating and funding a fund) take longer than the default 10s under a full parallel run
        hookTimeout: 50_000,
        silent: 'passed-only',
        disableConsoleIntercept: true,
        printConsoleTrace: false,
    },
    resolve: {
        alias: {
            '@test-utils': path.resolve(root, 'test-utils'),
        },
    },
}));
