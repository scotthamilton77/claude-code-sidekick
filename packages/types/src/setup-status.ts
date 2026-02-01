import { z } from 'zod'

/**
 * Plugin installation status for conflict detection.
 *
 * @see sidekick-72f - Plugin status detection and conflict resolution
 */
export const PluginStatusSchema = z.enum([
  'dev-mode', // Dev-mode hooks detected, no official plugin
  'installed-user', // Official plugin hooks in user settings only
  'installed-project', // Official plugin hooks in project settings only
  'installed-both', // Official plugin hooks in both user and project settings
  'plugin-dir', // Detected via --plugin-dir (liveness check passed but no config)
  'conflict', // Both dev-mode AND official plugin detected (hooks fire twice)
  'not-installed', // No sidekick hooks detected, liveness check failed
])
export type PluginStatus = z.infer<typeof PluginStatusSchema>

/**
 * API key health states for setup status tracking.
 */
export const ApiKeyHealthSchema = z.enum([
  'missing', // Key needed but not found
  'not-required', // No LLM profiles configured for provider
  'pending-validation', // Key exists but not validated
  'invalid', // Validation failed
  'healthy', // Validation succeeded
])
export type ApiKeyHealth = z.infer<typeof ApiKeyHealthSchema>

/**
 * Project-level API key health (adds 'user' option).
 */
export const ProjectApiKeyHealthSchema = z.enum([
  'missing',
  'not-required',
  'pending-validation',
  'invalid',
  'healthy',
  'user', // Deferring to user-level
])
export type ProjectApiKeyHealth = z.infer<typeof ProjectApiKeyHealthSchema>

/**
 * User-level setup status stored in ~/.sidekick/setup-status.json
 */
export const UserSetupStatusSchema = z.object({
  version: z.literal(1),
  lastUpdatedAt: z.string(), // ISO timestamp
  preferences: z.object({
    autoConfigureProjects: z.boolean(),
    defaultStatuslineScope: z.enum(['user', 'project']),
    defaultApiKeyScope: z.enum(['user', 'project', 'skip']),
  }),
  statusline: z.enum(['configured', 'skipped']),
  apiKeys: z.object({
    OPENROUTER_API_KEY: ApiKeyHealthSchema,
    OPENAI_API_KEY: ApiKeyHealthSchema,
  }),
  pluginStatus: PluginStatusSchema.optional(), // Added by doctor check
})
export type UserSetupStatus = z.infer<typeof UserSetupStatusSchema>

/**
 * Gitignore setup status for project.
 */
export const GitignoreStatusSchema = z.enum([
  'unknown', // Setup hasn't checked yet (legacy projects)
  'missing', // User declined or entries not present
  'incomplete', // Section exists but missing end marker or required entries
  'installed', // Sidekick section present with all required entries
])
export type GitignoreStatus = z.infer<typeof GitignoreStatusSchema>

/**
 * Project-level setup status stored in .sidekick/setup-status.json
 */
export const ProjectSetupStatusSchema = z.object({
  version: z.literal(1),
  lastUpdatedAt: z.string(), // ISO timestamp
  autoConfigured: z.boolean(),
  statusline: z.enum(['configured', 'skipped', 'user']),
  apiKeys: z.object({
    OPENROUTER_API_KEY: ProjectApiKeyHealthSchema,
    OPENAI_API_KEY: ProjectApiKeyHealthSchema,
  }),
  gitignore: GitignoreStatusSchema.optional().default('unknown'),
})
export type ProjectSetupStatus = z.infer<typeof ProjectSetupStatusSchema>
