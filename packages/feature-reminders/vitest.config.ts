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
        'vitest.config.ts',
        'src/index.ts',
        'src/handlers/*/index.ts',
        'src/handlers/consumption/inject-*.ts',
      ],
    },
  },
})
