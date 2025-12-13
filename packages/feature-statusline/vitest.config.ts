import { defineConfig } from 'vitest/config'

export default defineConfig({
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
