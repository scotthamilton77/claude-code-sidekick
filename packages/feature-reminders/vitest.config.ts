import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const pkgDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@sidekick/testing-fixtures': resolve(pkgDir, '../testing-fixtures/src'),
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
        'vitest.config.ts',
        'src/index.ts',
        'src/events.ts',
        'src/handlers/*/index.ts',
        'src/handlers/consumption/inject-*.ts',
        'src/handlers/ipc/types.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 82,
        functions: 90,
        lines: 90,
      },
    },
  },
})
