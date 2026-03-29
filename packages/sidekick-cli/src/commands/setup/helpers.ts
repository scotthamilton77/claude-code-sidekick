// packages/sidekick-cli/src/commands/setup/helpers.ts
/**
 * Shared helper functions for the setup subsystem.
 *
 * Contains display formatters and config writers used by both the interactive
 * wizard and the doctor/scripted execution paths. Extracted to avoid duplication
 * after decomposing setup/index.ts.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Logger } from '@sidekick/types'
import type { ApiKeyHealth } from '@sidekick/types'
import type { ApiKeySource, PluginInstallationStatus, PluginLivenessStatus } from '@sidekick/core'
import type { InstallScope } from './plugin-installer.js'

// ============================================================================
// Shared Types
// ============================================================================

export interface SetupCommandResult {
  exitCode: number
  output?: string
}

export interface SetupCommandOptions {
  checkOnly?: boolean
  fix?: boolean
  force?: boolean
  stdin?: NodeJS.ReadableStream
  help?: boolean
  // Scripting flags for non-interactive setup
  statuslineScope?: InstallScope
  gitignore?: boolean // true = install, false = skip, undefined = not specified
  personas?: boolean // true = enable, false = disable, undefined = not specified
  alias?: boolean // true = install, false = remove, undefined = not specified
  apiKeyScope?: 'user' | 'project' // where to save API key (reads from OPENROUTER_API_KEY env)
  autoConfig?: 'auto' | 'manual'
  // Plugin installation flags
  marketplaceScope?: InstallScope
  pluginScope?: InstallScope
  // Doctor filtering - comma-separated list of checks to run
  only?: string
  // User profile scripting flags
  userProfileName?: string
  userProfileRole?: string
  userProfileInterests?: string // comma-separated
  // Testing override - allows tests to specify home directory
  homeDir?: string
}

// ============================================================================
// Constants
// ============================================================================

export const STATUSLINE_COMMAND = 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR'

// ============================================================================
// Path Resolution
// ============================================================================

/** Resolve the settings file path for a given statusline scope. */
export function statuslineSettingsPath(scope: InstallScope, homeDir: string, projectDir: string): string {
  switch (scope) {
    case 'user':
      return path.join(homeDir, '.claude', 'settings.json')
    case 'project':
      return path.join(projectDir, '.claude', 'settings.json')
    case 'local':
      return path.join(projectDir, '.claude', 'settings.local.json')
  }
}

// ============================================================================
// Config Writers
// ============================================================================

/**
 * Write statusline config to Claude Code settings.json.
 * Returns true if written, false if skipped (e.g. dev-mode statusline detected).
 */
export async function configureStatusline(settingsPath: string, logger?: Logger): Promise<boolean> {
  let settings: Record<string, unknown> = {}

  try {
    const content = await fs.readFile(settingsPath, 'utf-8')
    settings = JSON.parse(content) as Record<string, unknown>
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
    // File doesn't exist, start fresh
  }

  // Guard: don't overwrite dev-mode statusline
  const existing = settings.statusLine as { command?: string } | undefined
  if (existing?.command?.includes('dev-sidekick')) {
    logger?.warn('Statusline managed by dev-mode, skipping overwrite', { path: settingsPath })
    return false
  }

  settings.statusLine = {
    type: 'command',
    command: STATUSLINE_COMMAND,
  }

  const dir = path.dirname(settingsPath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')
  logger?.info('Statusline configured', { path: settingsPath })
  return true
}

/**
 * Write API key to .env file
 */
export async function writeApiKeyToEnv(envPath: string, key: string, value: string): Promise<void> {
  const dir = path.dirname(envPath)
  await fs.mkdir(dir, { recursive: true })

  let content = ''
  try {
    content = await fs.readFile(envPath, 'utf-8')
  } catch {
    // File doesn't exist
  }

  // Check if key already exists
  const keyRegex = new RegExp(`^${key}=.*$`, 'm')
  if (keyRegex.test(content)) {
    // Replace existing
    content = content.replace(keyRegex, `${key}=${value}`)
  } else {
    // Append
    if (content && !content.endsWith('\n')) {
      content += '\n'
    }
    content += `${key}=${value}\n`
  }

  await fs.writeFile(envPath, content)
}

/**
 * Write persona enabled/disabled setting to sidekick features config.
 * Per CONFIG-SYSTEM.md, feature flags go in features.yaml (not core.yaml).
 */
export async function writePersonaConfig(homeDir: string, enabled: boolean): Promise<void> {
  // Write to user-level features config (~/.sidekick/features.yaml)
  const configDir = path.join(homeDir, '.sidekick')
  const featuresPath = path.join(configDir, 'features.yaml')

  await fs.mkdir(configDir, { recursive: true })

  let content = ''
  try {
    content = await fs.readFile(featuresPath, 'utf-8')
  } catch {
    // File doesn't exist
  }

  // Check if personas config exists (structure: personas:\n  enabled: true|false)
  const personasRegex = /^personas:\s*\n\s*enabled:\s*(true|false)/m
  const newPersonasBlock = `personas:\n  enabled: ${enabled}`

  if (personasRegex.test(content)) {
    // Replace existing
    content = content.replace(personasRegex, newPersonasBlock)
  } else {
    // Append
    if (content && !content.endsWith('\n')) {
      content += '\n'
    }
    content += newPersonasBlock + '\n'
  }

  await fs.writeFile(featuresPath, content)
}

// ============================================================================
// Display Formatters
// ============================================================================

/**
 * Map plugin installation status to human-readable label.
 */
export function getPluginStatusLabel(status: PluginInstallationStatus): string {
  switch (status) {
    case 'plugin':
      return 'installed'
    case 'dev-mode':
      return 'dev-mode (local)'
    case 'both':
      return 'conflict (both plugin and dev-mode detected!)'
    case 'none':
      return 'not installed'
    case 'timeout':
      return 'check timed out'
    case 'error':
      return 'check failed'
  }
}

/**
 * Map API key health to status type for display.
 */
export function getApiKeyStatusType(health: ApiKeyHealth): 'success' | 'warning' | 'info' {
  switch (health) {
    case 'healthy':
      return 'success'
    case 'not-required':
      return 'info'
    default:
      return 'warning'
  }
}

/**
 * Map plugin status to display icon.
 */
export function getPluginStatusIcon(status: PluginInstallationStatus): string {
  switch (status) {
    case 'plugin':
    case 'dev-mode':
      return '✓'
    case 'both':
    case 'timeout':
    case 'error':
      return '⚠'
    case 'none':
      return '✗'
  }
}

/**
 * Map plugin liveness status to display icon.
 */
export function getLivenessIcon(status: PluginLivenessStatus): string {
  switch (status) {
    case 'active':
      return '✓'
    case 'inactive':
      return '✗'
    case 'timeout':
    case 'error':
      return '⚠'
  }
}

/**
 * Map plugin liveness status to human-readable label.
 */
export function getLivenessLabel(status: PluginLivenessStatus): string {
  switch (status) {
    case 'active':
      return 'hooks responding'
    case 'inactive':
      return 'hooks not detected'
    case 'timeout':
      return 'check timed out'
    case 'error':
      return 'check failed'
  }
}

/**
 * Format scope status as icon for compact display.
 * ✓ = key found and valid, ✗ = key found but invalid, - = not found or not required
 */
function getScopeIcon(status: 'healthy' | 'invalid' | 'missing' | 'not-required'): string {
  if (status === 'healthy') return '✓'
  if (status === 'invalid') return '✗'
  return '-'
}

/**
 * Format API key scopes for ultra-compact display.
 * Format: [project ✓ user ✓ env ✗]
 */
export function formatApiKeyScopes(scopes: {
  project: 'healthy' | 'invalid' | 'missing' | 'not-required'
  user: 'healthy' | 'invalid' | 'missing' | 'not-required'
  env: 'healthy' | 'invalid' | 'missing' | 'not-required'
}): string {
  return `[project ${getScopeIcon(scopes.project)} user ${getScopeIcon(scopes.user)} env ${getScopeIcon(scopes.env)}]`
}

/**
 * Format API key source for display in doctor output.
 * Returns ' (from <label>)' or empty string if no source.
 */
export function formatApiKeySource(source: ApiKeySource | null): string {
  if (!source) return ''
  const labels: Record<ApiKeySource, string> = {
    'project-env': 'project .env',
    'user-env': 'user .env',
    'env-var': 'env variable',
  }
  return ` (from ${labels[source]})`
}
