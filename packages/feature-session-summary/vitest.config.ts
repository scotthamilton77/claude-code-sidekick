import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@sidekick/types': resolve(rootDir, '../types/src'),
      '@sidekick/core': resolve(rootDir, '../sidekick-core/src'),
      '@sidekick/testing-fixtures': resolve(rootDir, '../testing-fixtures/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    exclude: ['dist/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/*.test.ts',
        '**/__tests__/**',
        '**/dist/**',
        // Low-ROI exclusions: config, barrel files, registration wiring
        'vitest.config.ts',
        'src/index.ts',
        'src/handlers/index.ts',
        // Pure data factories with v8 ignore pragmas in source
        'src/events.ts',
        // Pure type re-exports
        'src/types.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
})
