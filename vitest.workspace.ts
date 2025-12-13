import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'packages/sidekick-core',
  'packages/sidekick-cli',
  'packages/shared-providers',
  'packages/sidekick-supervisor',
  'packages/testing-fixtures',
  'packages/feature-reminders',
  'packages/feature-session-summary',
  'packages/feature-statusline',
  'packages/sidekick-ui',
])
