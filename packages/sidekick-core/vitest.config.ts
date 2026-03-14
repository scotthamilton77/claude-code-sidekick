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
        // Pure type re-exports - no runtime logic
        'src/runtime-context.ts',
        // Barrel files - only re-exports
        'src/index.ts',
        'src/state/index.ts',
        // IPC service layer - requires Unix sockets, tested via integration
        'src/daemon-client.ts',
        'src/ipc-service.ts',
        // Trivial project root resolver (3 lines of logic)
        'src/project-root.ts',
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
