import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@sidekick/types': resolve(rootDir, '../types/src'),
      '@': resolve(rootDir, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: resolve(rootDir, 'coverage'),
      exclude: [
        // Build artifacts and coverage reports
        'dist/**',
        'coverage/**',

        // Config files
        '*.config.{js,ts}',
        'vitest.config.ts',
        'vite.config.ts',
        'postcss.config.js',
        'tailwind.config.js',
        'eslint.config.js',

        // React UI components (require DOM/React testing infrastructure)
        'src/**/*.tsx',
        'src/components/**',

        // React hooks (primarily manage React state, require React testing)
        'src/hooks/**',

        // Mock/fixture data for UI development
        'src/data/mockData.ts',

        // Barrel files (re-export only)
        'src/components/common/index.ts',
        'src/components/events/index.ts',
        'src/components/views/index.ts',

        // Entry point (just wiring)
        'src/main.tsx',

        // Server API handlers (Vite dev server plugins, not business logic)
        'server/**',

        // Type guards in types/index.ts have runtime code but minimal ROI
        // (simple discriminated union checks - defer until Phase 2 if needed)
        'src/types/index.ts',

        // Filter parser - untested utility (defer until needed)
        'src/lib/filter-parser.ts',
      ],
    },
  },
})
