import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/dist/**',
        '**/node_modules/**',
        '**/*.test.ts',
        '**/__tests__/**',
        // Low-ROI exclusions (see coverage analysis)
        'packages/types/src/**', // Pure types, no runtime
        'packages/sidekick-supervisor/src/index.ts', // Process entrypoint only
        'packages/sidekick-cli/src/bin.ts', // CLI entrypoint only
        'packages/sidekick-cli/src/index.ts', // Barrel file (re-exports only)
        'packages/testing-fixtures/**', // Test infrastructure
        'packages/sidekick-cli/src/commands/**', // CLI dispatch layer
        'packages/sidekick-core/src/feature-types.ts', // Pure types
        'packages/sidekick-core/src/runtime-context.ts', // Pure types
        'packages/sidekick-ui/src/data/mockData.ts', // UI fixture data
      ],
    },
  },
})
