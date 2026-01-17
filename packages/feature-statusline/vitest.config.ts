import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = dirname(fileURLToPath(import.meta.url))
const packagesDir = resolve(rootDir, '..')

export default defineConfig({
  resolve: {
    alias: {
      '@sidekick/feature-session-summary': resolve(packagesDir, 'feature-session-summary/dist/index.js'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/*.test.ts',
        '**/__tests__/**',
        '**/dist/**',
        // Config files - boilerplate, no logic to test
        'vitest.config.ts',
        // Barrel exports - just re-exports, no runtime logic
        'src/index.ts',
      ],
    },
  },
})
