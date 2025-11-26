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
  },
})
