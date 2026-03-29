import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@sidekick/core': resolve(rootDir, '../sidekick-core/src'),
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
        // Config files
        'vitest.config.ts',
        // Barrel files (pure re-exports)
        'src/index.ts',
        'src/utils/index.ts',
        'src/commands/setup.ts',
        // Entry points (process wiring - tested via integration)
        'src/bin.ts',
        // Interactive wizard and setup subsystem (stdin/stdout prompts, tested via E2E)
        'src/commands/setup/index.ts',
        'src/commands/setup/prompts.ts',
        'src/commands/setup/user-profile-setup.ts',
        'src/commands/setup/helpers.ts',
        'src/commands/setup/scripted.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
    },
  },
})
