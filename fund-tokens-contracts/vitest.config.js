import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: './',
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 50000,
    silent: 'passed-only',
    coverage: {
      provider: 'v8',
      reporter: ['json-summary'],
    },
    disableConsoleIntercept: true,
    printConsoleTrace: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@lib': path.resolve(__dirname, './lib'),
      '@system': path.resolve(__dirname, './system'),
    }
  }
});