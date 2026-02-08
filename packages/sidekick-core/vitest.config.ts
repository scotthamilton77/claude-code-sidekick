import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@sidekick/types': resolve(rootDir, '../types/src'),
      '@sidekick/shared-providers': resolve(rootDir, '../shared-providers/src'),
      '@sidekick/testing-fixtures': resolve(rootDir, '../testing-fixtures/src'),
    },
  },
  test: {
    environment: 'node',
    exclude: ['dist/**', 'node_modules/**'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: resolve(rootDir, 'coverage'),
      exclude: [
        'dist/**',
        'coverage/**',
        // Config file - not runtime code
        'vitest.config.ts',
        // Pure type definitions - no runtime code
        'src/feature-types.ts',
        // Barrel file - only re-exports
        'src/index.ts',
      ],
    },
  },
})
