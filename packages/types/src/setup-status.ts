import { z } from 'zod'

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

// ============================================================================
// New comprehensive API key status types (v2)
// ============================================================================

/**
 * Per-scope status for an API key.
 */
export const ScopeStatusSchema = z.enum(['healthy', 'invalid', 'missing', 'not-required'])
export type ScopeStatus = z.infer<typeof ScopeStatusSchema>

/**
 * API key scope identifier.
 */
export const ApiKeyScopeSchema = z.enum(['project', 'user', 'env'])
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>

/**
 * Comprehensive API key status for USER level (no project scope).
 * Used in ~/.sidekick/user-setup-status.json
 */
export const UserApiKeyStatusSchema = z.object({
  /** Which scope's key is being used (first valid in priority order) */
  used: z.enum(['user', 'env']).nullable(),
  /** Overall status based on the used key */
  status: ScopeStatusSchema,
  /** Per-scope breakdown */
  scopes: z.object({
    user: ScopeStatusSchema,
    env: ScopeStatusSchema,
  }),
})
export type UserApiKeyStatus = z.infer<typeof UserApiKeyStatusSchema>

/**
 * Comprehensive API key status for PROJECT level (includes project scope).
 * Used in .sidekick/setup-status.json
 */
export const ProjectApiKeyStatusSchema = z.object({
  /** Which scope's key is being used (first valid in priority order) */
  used: z.enum(['project', 'user', 'env']).nullable(),
  /** Overall status based on the used key */
  status: ScopeStatusSchema,
  /** Per-scope breakdown */
  scopes: z.object({
    project: ScopeStatusSchema,
    user: ScopeStatusSchema,
    env: ScopeStatusSchema,
  }),
})
export type ProjectApiKeyStatus = z.infer<typeof ProjectApiKeyStatusSchema>

/**
 * Statusline installation status - matches PluginInstallationStatus pattern.
 * Indicates WHERE the statusline is configured, not just IF.
 */
export const StatuslineStatusSchema = z.enum([
  'user', // Configured in ~/.claude/settings.json
  'project', // Configured in .claude/settings.json (shared via git)
  'local', // Configured in .claude/settings.local.json (not shared)
  'both', // Configured in multiple locations
  'none', // Not configured anywhere
])
export type StatuslineStatus = z.infer<typeof StatuslineStatusSchema>

/**
 * API key value in user status - accepts both old string format and new object format.
 * Old format: 'healthy' | 'invalid' | 'missing' | 'not-required' | 'pending-validation'
 * New format: { used, status, scopes }
 */
export const UserApiKeyValueSchema = z.union([ApiKeyHealthSchema, UserApiKeyStatusSchema])
export type UserApiKeyValue = z.infer<typeof UserApiKeyValueSchema>

/**
 * User-level setup status stored in ~/.sidekick/user-setup-status.json
 */
export const UserSetupStatusSchema = z.object({
  version: z.literal(1),
  lastUpdatedAt: z.string(), // ISO timestamp
  preferences: z.object({
    autoConfigureProjects: z.boolean(),
    defaultStatuslineScope: z.enum(['user', 'project', 'local']),
    defaultApiKeyScope: z.enum(['user', 'project', 'skip']),
  }),
  statusline: StatuslineStatusSchema,
  apiKeys: z.object({
    OPENROUTER_API_KEY: UserApiKeyValueSchema,
    OPENAI_API_KEY: UserApiKeyValueSchema,
  }),
  /** True if sidekick plugin detected at user scope via `claude plugin list` */
  pluginDetected: z.boolean().optional(),
})
export type UserSetupStatus = z.infer<typeof UserSetupStatusSchema>

/**
 * Gitignore setup status for project.
 */
export const GitignoreStatusSchema = z.enum([
  'unknown', // Setup hasn't checked yet (legacy projects)
  'missing', // User declined or entries not present
  'incomplete', // .sidekick/.gitignore exists but missing required entries (legacy: partial root section)
  'installed', // .sidekick/.gitignore present with all entries (new format)
  'legacy', // Root .gitignore has old marked section — functional, migrate recommended
])
export type GitignoreStatus = z.infer<typeof GitignoreStatusSchema>

/**
 * API key value in project status - accepts both old string format and new object format.
 * Old format: 'healthy' | 'invalid' | 'missing' | 'not-required' | 'pending-validation' | 'user'
 * New format: { used, status, scopes }
 */
export const ProjectApiKeyValueSchema = z.union([ProjectApiKeyHealthSchema, ProjectApiKeyStatusSchema])
export type ProjectApiKeyValue = z.infer<typeof ProjectApiKeyValueSchema>

/**
 * Project-level setup status stored in .sidekick/setup-status.json
 */
export const ProjectSetupStatusSchema = z.object({
  version: z.literal(1),
  lastUpdatedAt: z.string(), // ISO timestamp
  autoConfigured: z.boolean(),
  statusline: StatuslineStatusSchema,
  apiKeys: z.object({
    OPENROUTER_API_KEY: ProjectApiKeyValueSchema,
    OPENAI_API_KEY: ProjectApiKeyValueSchema,
  }),
  gitignore: GitignoreStatusSchema.optional().default('unknown'),
  /** True if sidekick plugin detected at project scope via `claude plugin list` */
  pluginDetected: z.boolean().optional(),
  /** True if dev-mode hooks are enabled for this project. Set by `dev-mode enable/disable`. */
  devMode: z.boolean().optional(),
})
export type ProjectSetupStatus = z.infer<typeof ProjectSetupStatusSchema>

/**
 * Daemon runtime health status.
 * Tracks whether the daemon process started successfully.
 * Written by CLI on state transitions, read by statusline.
 *
 * @see docs/plans/2026-02-16-daemon-health-state-design.md
 */
export const DaemonHealthStatusSchema = z.enum(['unknown', 'healthy', 'failed'])
export type DaemonHealthStatus = z.infer<typeof DaemonHealthStatusSchema>

export const DaemonHealthSchema = z.object({
  status: DaemonHealthStatusSchema,
  lastCheckedAt: z.string(),
  error: z.string().optional(),
})
export type DaemonHealth = z.infer<typeof DaemonHealthSchema>
