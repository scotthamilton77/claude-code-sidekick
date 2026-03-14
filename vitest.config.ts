import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

const rootDir = dirname(fileURLToPath(import.meta.url))

// Directories to exclude from test discovery and coverage instrumentation.
// Prevents worktree copies and .claude metadata from being picked up.
const worktreeExcludes = [
  '**/.claude/**',
  '**/.worktree/**',
  '**/.worktrees/**',
  '**/worktree/**',
  '**/worktrees/**',
]

export default defineConfig({
  resolve: {
    // Root-level aliases ensure workspace packages resolve during coverage runs.
    // Per-workspace vitest configs define their own aliases for `pnpm test`,
    // but `vitest run --coverage` at root needs these as a fallback.
    alias: {
      // Only infrastructure packages are aliased here. Feature packages
      // (feature-reminders, feature-session-summary, feature-statusline) are
      // intentionally omitted — their consumers are excluded from coverage,
      // and adding them creates transitive mock conflicts in tests.
      '@sidekick/types': resolve(rootDir, 'packages/types/src'),
      '@sidekick/core': resolve(rootDir, 'packages/sidekick-core/src'),
      '@sidekick/shared-providers': resolve(rootDir, 'packages/shared-providers/src'),
      '@sidekick/testing-fixtures': resolve(rootDir, 'packages/testing-fixtures/src'),
    },
  },
  test: {
    // Coverage instrumentation adds significant overhead; 15s prevents false timeouts
    testTimeout: 15_000,
    exclude: [
      ...configDefaults.exclude,
      ...worktreeExcludes,
    ],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        ...worktreeExcludes,
        '**/dist/**',
        '**/node_modules/**',
        '**/*.test.ts',
        '**/__tests__/**',

        // === Global patterns ===
        'packages/types/src/**', // Pure types, no runtime
        'packages/testing-fixtures/**', // Test infrastructure

        // === sidekick-core ===
        'packages/sidekick-core/src/index.ts', // Barrel file
        'packages/sidekick-core/src/state/index.ts', // Barrel file
        'packages/sidekick-core/src/feature-types.ts', // Pure types
        'packages/sidekick-core/src/runtime-context.ts', // Pure types
        'packages/sidekick-core/src/daemon-client.ts', // IPC - requires Unix sockets
        'packages/sidekick-core/src/ipc-service.ts', // IPC - requires Unix sockets
        'packages/sidekick-core/src/project-root.ts', // Trivial resolver (3 lines)

        // === sidekick-cli ===
        'packages/sidekick-cli/src/index.ts', // Barrel file
        'packages/sidekick-cli/src/bin.ts', // CLI entrypoint only
        'packages/sidekick-cli/src/commands/setup.ts', // Barrel re-export to setup/index.ts
        'packages/sidekick-cli/src/commands/setup/index.ts', // Interactive wizard (tested via setup.test.ts for doctor/force)
        'packages/sidekick-cli/src/commands/setup/prompts.ts', // Interactive readline UI
        'packages/sidekick-cli/src/commands/setup/user-profile-setup.ts', // Interactive wizard step

        // === shared-providers ===
        'packages/shared-providers/src/index.ts', // Barrel file
        'packages/shared-providers/src/validation.ts', // Calls external APIs - excluded from default runs
        'packages/shared-providers/src/providers/emulators/**', // LLM test emulators (test infrastructure)

        // === sidekick-daemon ===
        'packages/sidekick-daemon/src/index.ts', // Process entrypoint
        'packages/sidekick-daemon/src/daemon.ts', // Orchestration, tested via E2E
        'packages/sidekick-daemon/src/handlers/index.ts', // Barrel file

        // === feature-reminders ===
        'packages/feature-reminders/src/index.ts', // Barrel file
        'packages/feature-reminders/src/types.ts', // Pure type definitions and constants
        'packages/feature-reminders/src/events.ts', // Pure data factories (v8 ignore in source)
        'packages/feature-reminders/src/handlers/*/index.ts', // Registration wiring
        'packages/feature-reminders/src/handlers/consumption/inject-*.ts', // Thin wrappers
        'packages/feature-reminders/src/handlers/ipc/types.ts', // Pure type definitions

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
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
})
