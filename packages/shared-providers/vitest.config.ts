import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@sidekick/types': resolve(rootDir, '../types/src'),
      '@sidekick/core': resolve(rootDir, '../sidekick-core/src'),
    },
  },
  test: {
    environment: 'node',
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: resolve(rootDir, 'coverage'),
      exclude: [
        'dist/**',
        'coverage/**',
        'vitest.config.ts', // Config file - no runtime code
        'src/index.ts', // Barrel file - only re-exports
      ],
    },
  },
})
