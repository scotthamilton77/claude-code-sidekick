import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'packages/sidekick-core',
  'packages/sidekick-cli',
  'packages/shared-providers',
  'packages/sidekick-supervisor',
  'packages/testing-fixtures',
])
