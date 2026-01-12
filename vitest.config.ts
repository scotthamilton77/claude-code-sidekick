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

        // === Global patterns ===
        'packages/types/src/**', // Pure types, no runtime
        'packages/testing-fixtures/**', // Test infrastructure

        // === sidekick-core ===
        'packages/sidekick-core/src/index.ts', // Barrel file
        'packages/sidekick-core/src/feature-types.ts', // Pure types
        'packages/sidekick-core/src/runtime-context.ts', // Pure types

        // === sidekick-cli ===
        'packages/sidekick-cli/src/index.ts', // Barrel file
        'packages/sidekick-cli/src/bin.ts', // CLI entrypoint only
        'packages/sidekick-cli/src/commands/**', // CLI dispatch layer

        // === shared-providers ===
        'packages/shared-providers/src/index.ts', // Barrel file
        'packages/shared-providers/src/providers/emulators/**', // LLM test emulators (test infrastructure)

        // === sidekick-daemon ===
        'packages/sidekick-daemon/src/index.ts', // Process entrypoint
        'packages/sidekick-daemon/src/daemon.ts', // Orchestration, tested via E2E
        'packages/sidekick-daemon/src/handlers/index.ts', // Barrel file

        // === feature-reminders ===
        'packages/feature-reminders/src/index.ts', // Barrel file
        'packages/feature-reminders/src/handlers/*/index.ts', // Registration wiring
        'packages/feature-reminders/src/handlers/consumption/inject-*.ts', // Thin wrappers

        // === feature-session-summary ===
        'packages/feature-session-summary/src/index.ts', // Barrel file
        'packages/feature-session-summary/src/handlers/index.ts', // Registration wiring

        // === feature-statusline ===
        'packages/feature-statusline/src/index.ts', // Barrel file

        // === sidekick-ui (React SPA - requires DOM testing infrastructure) ===
        'packages/sidekick-ui/src/**/*.tsx', // React components
        'packages/sidekick-ui/src/hooks/**', // React hooks
        'packages/sidekick-ui/src/data/mockData.ts', // UI fixture data
        'packages/sidekick-ui/src/components/**/index.ts', // Barrel files
        'packages/sidekick-ui/src/types/index.ts', // Type guards (minimal ROI)
        'packages/sidekick-ui/src/lib/filter-parser.ts', // Untested utility (deferred)
        'packages/sidekick-ui/server/**', // Vite dev server plugins
      ],
    },
  },
})
