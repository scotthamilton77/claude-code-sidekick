import path from 'node:path'
import { fileURLToPath } from 'node:url'

import tseslint from 'typescript-eslint'

const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url))

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    ignores: ['dist', 'node_modules', 'docs', 'coverage', '.archive', '**/*.d.ts', '**/*.js', '**/*.mjs'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Vite/Vitest config and server code use tsconfig.node.json
    files: ['vite.config.ts', 'vitest.config.ts', 'server/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.node.json',
        tsconfigRootDir,
      },
    },
  },
  {
    // JS config files - no type-aware linting
    files: ['*.config.js'],
    languageOptions: {
      parserOptions: {
        project: null,
      },
    },
  }
)
