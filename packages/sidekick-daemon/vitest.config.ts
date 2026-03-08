import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = dirname(fileURLToPath(import.meta.url))
const packagesDir = resolve(rootDir, '..')

export default defineConfig({
  resolve: {
    alias: {
      // Ensure workspace packages resolve to their dist directories for runtime values
      '@sidekick/types': resolve(packagesDir, 'types/dist/index.js'),
      '@sidekick/testing-fixtures': resolve(packagesDir, 'testing-fixtures/src'),
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
        'vitest.config.ts', // Config file
        'src/daemon.ts', // Orchestration layer, tested via E2E
        'src/index.ts', // Process entrypoint only
        'src/handlers/index.ts', // Barrel file - just re-exports
      ],
    },
  },
})
