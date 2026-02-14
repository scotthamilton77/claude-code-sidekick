// packages/sidekick-cli/src/commands/setup/plugin-installer.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import type { Logger } from '@sidekick/types'
import { printHeader, printStatus, promptSelect, type PromptContext } from './prompts.js'

// ============================================================================
// Constants
// ============================================================================

export const MARKETPLACE_NAME = 'claude-code-sidekick'
export const MARKETPLACE_SOURCE = 'github:scotthamilton77/claude-code-sidekick'
export const PLUGIN_NAME = 'sidekick'

const ALL_SCOPES: readonly InstallScope[] = ['user', 'project', 'local'] as const

// ============================================================================
// Types
// ============================================================================

export type InstallScope = 'user' | 'project' | 'local'

export interface CommandExecutor {
  exec(cmd: string, args: string[]): Promise<{ stdout: string; exitCode: number }>
}

export interface PluginInstallerResult {
  marketplaceScope: InstallScope
  pluginScope: InstallScope
  marketplaceAction: 'already-installed' | 'installed' | 'failed'
  pluginAction: 'already-installed' | 'installed' | 'failed'
  error?: string
}

export interface PluginInstallerOptions {
  logger: Logger
  stdout: NodeJS.WritableStream
  force: boolean
  projectDir: string
  executor?: CommandExecutor
  ctx?: PromptContext
  marketplaceScope?: InstallScope
  pluginScope?: InstallScope
  isDevMode?: boolean
}

// ============================================================================
// Scope hierarchy: user (broadest) > project > local (narrowest)
// ============================================================================

const SCOPE_ORDER: Record<InstallScope, number> = { user: 0, project: 1, local: 2 }

/**
 * Get valid plugin scopes given a marketplace scope.
 * Plugin scope must be equal to or narrower than marketplace scope.
 */
export function getValidPluginScopes(marketplaceScope: InstallScope): InstallScope[] {
  const minOrder = SCOPE_ORDER[marketplaceScope]
  return ALL_SCOPES.filter((s) => SCOPE_ORDER[s] >= minOrder)
}

/** Plugin scope must be equal to or narrower than marketplace scope. */
export function isScopeValid(marketplaceScope: InstallScope, pluginScope: InstallScope): boolean {
  return SCOPE_ORDER[pluginScope] >= SCOPE_ORDER[marketplaceScope]
}

// ============================================================================
// Settings JSON merging (for project/local marketplace installation)
// ============================================================================

interface MarketplaceEntry {
  name: string
  source: string
}

/**
 * Merge marketplace config into existing settings object.
 * Adds extraKnownMarketplaces and enabledPlugins entries without duplicating.
 */
export function mergeMarketplaceSettings(existing: Record<string, unknown>): Record<string, unknown> {
  const result = { ...existing }

  const marketplaces: MarketplaceEntry[] = Array.isArray(result.extraKnownMarketplaces)
    ? [...(result.extraKnownMarketplaces as MarketplaceEntry[])]
    : []

  if (!marketplaces.some((m) => m.name === MARKETPLACE_NAME)) {
    marketplaces.push({ name: MARKETPLACE_NAME, source: MARKETPLACE_SOURCE })
  }
  result.extraKnownMarketplaces = marketplaces

  const plugins: string[] = Array.isArray(result.enabledPlugins) ? [...(result.enabledPlugins as string[])] : []

  const pluginEntry = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`
  if (!plugins.includes(pluginEntry)) {
    plugins.push(pluginEntry)
  }
  result.enabledPlugins = plugins

  return result
}

// ============================================================================
// Default command executor (real CLI)
// ============================================================================

function createDefaultExecutor(): CommandExecutor {
  return {
    exec(cmd: string, args: string[]): Promise<{ stdout: string; exitCode: number }> {
      return new Promise((resolve, reject) => {
        execFile(cmd, args, (error, stdout) => {
          if (!error) {
            resolve({ stdout, exitCode: 0 })
            return
          }
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(error as Error)
            return
          }
          resolve({ stdout: stdout ?? '', exitCode: error.code ? Number(error.code) : 1 })
        })
      })
    },
  }
}

// ============================================================================
// Detection helpers
// ============================================================================

function settingsFilename(scope: 'project' | 'local'): string {
  return scope === 'project' ? 'settings.json' : 'settings.local.json'
}

function isCliMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT' || ((err as Error).message ?? '').includes('ENOENT')
}

async function detectMarketplaceFromCLI(executor: CommandExecutor, logger: Logger): Promise<boolean> {
  const { stdout, exitCode } = await executor.exec('claude', ['plugin', 'marketplace', 'list', '--json'])
  if (exitCode !== 0) {
    logger.warn('claude plugin marketplace list failed', { exitCode })
    return false
  }
  const marketplaces = JSON.parse(stdout) as Array<{ name: string }>
  return marketplaces.some((m) => m.name === MARKETPLACE_NAME)
}

async function detectMarketplaceFromSettings(
  projectDir: string,
  scope: 'project' | 'local',
  logger: Logger
): Promise<boolean> {
  const settingsPath = path.join(projectDir, '.claude', settingsFilename(scope))
  try {
    const content = await fs.readFile(settingsPath, 'utf-8')
    const settings = JSON.parse(content) as Record<string, unknown>
    const marketplaces = settings.extraKnownMarketplaces as MarketplaceEntry[] | undefined
    if (!Array.isArray(marketplaces)) return false
    return marketplaces.some((m) => m.name === MARKETPLACE_NAME)
  } catch {
    logger.debug('Settings file not found or unreadable', { path: settingsPath })
    return false
  }
}

async function detectPluginFromCLI(executor: CommandExecutor, logger: Logger): Promise<boolean> {
  const { stdout, exitCode } = await executor.exec('claude', ['plugin', 'list', '--json'])
  if (exitCode !== 0) {
    logger.warn('claude plugin list failed', { exitCode })
    return false
  }
  const plugins = JSON.parse(stdout) as Array<{ id: string }>
  return plugins.some((p) => p.id.startsWith(`${PLUGIN_NAME}@`))
}

/**
 * Detect marketplace across all scopes: CLI (user), project settings, local settings.
 * Returns the broadest scope where found, or null if not found anywhere.
 * Also tracks whether the CLI is available.
 */
async function detectMarketplaceAnywhere(
  executor: CommandExecutor,
  projectDir: string,
  logger: Logger
): Promise<{ scope: InstallScope | null; cliAvailable: boolean }> {
  let cliAvailable = true

  // Check user scope via CLI (broadest)
  try {
    if (await detectMarketplaceFromCLI(executor, logger)) {
      return { scope: 'user', cliAvailable }
    }
  } catch (err) {
    if (isCliMissing(err)) {
      cliAvailable = false
    }
    logger.warn('Failed to detect marketplace via CLI', { error: (err as Error).message })
  }

  // Check project settings
  if (await detectMarketplaceFromSettings(projectDir, 'project', logger)) {
    return { scope: 'project', cliAvailable }
  }

  // Check local settings
  if (await detectMarketplaceFromSettings(projectDir, 'local', logger)) {
    return { scope: 'local', cliAvailable }
  }

  return { scope: null, cliAvailable }
}

// ============================================================================
// Installation helpers
// ============================================================================

async function installMarketplaceViaCLI(executor: CommandExecutor, logger: Logger): Promise<boolean> {
  logger.info('Installing marketplace via CLI', { source: MARKETPLACE_SOURCE })
  const { exitCode } = await executor.exec('claude', ['plugin', 'marketplace', 'add', MARKETPLACE_SOURCE])
  return exitCode === 0
}

async function installMarketplaceViaSettings(
  projectDir: string,
  scope: 'project' | 'local',
  logger: Logger
): Promise<void> {
  const settingsPath = path.join(projectDir, '.claude', settingsFilename(scope))
  logger.info('Installing marketplace via settings file', { path: settingsPath })

  let existing: Record<string, unknown> = {}
  try {
    const content = await fs.readFile(settingsPath, 'utf-8')
    existing = JSON.parse(content) as Record<string, unknown>
  } catch {
    // Start fresh if file doesn't exist or is invalid JSON
  }

  const merged = mergeMarketplaceSettings(existing)
  await fs.mkdir(path.dirname(settingsPath), { recursive: true })
  await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2) + '\n')
}

async function installPlugin(executor: CommandExecutor, scope: InstallScope, logger: Logger): Promise<boolean> {
  logger.info('Installing sidekick plugin', { scope })
  const { exitCode } = await executor.exec('claude', ['plugin', 'install', PLUGIN_NAME, '-s', scope])
  return exitCode === 0
}

// ============================================================================
// Scope prompting
// ============================================================================

const SCOPE_LABELS: Record<InstallScope, { label: string; description: string }> = {
  user: { label: 'User (recommended)', description: 'Available to all your projects' },
  project: { label: 'Project', description: 'Only this project' },
  local: { label: 'Local', description: 'Local-only, not shared via git' },
}

async function promptMarketplaceScope(ctx: PromptContext): Promise<InstallScope> {
  return promptSelect(ctx, 'Where should the sidekick marketplace be installed?', [
    { value: 'user' as const, ...SCOPE_LABELS.user },
    { value: 'project' as const, ...SCOPE_LABELS.project },
    { value: 'local' as const, ...SCOPE_LABELS.local },
  ])
}

async function promptPluginScope(ctx: PromptContext, validScopes: InstallScope[]): Promise<InstallScope> {
  const options = validScopes.map((scope) => ({
    value: scope,
    ...SCOPE_LABELS[scope],
  }))
  return promptSelect(ctx, 'Where should the sidekick plugin be installed?', options)
}

// ============================================================================
// Main entry point
// ============================================================================

function printManualInstructions(stdout: NodeJS.WritableStream): void {
  stdout.write('\nThe claude CLI is not available. Install sidekick manually:\n')
  stdout.write(`  1. claude plugin marketplace add ${MARKETPLACE_SOURCE}\n`)
  stdout.write(`  2. claude plugin install ${PLUGIN_NAME}\n`)
  stdout.write('\nSee https://github.com/scotthamilton77/claude-code-sidekick for details.\n\n')
}

/**
 * Ensure the sidekick marketplace and plugin are installed.
 *
 * Detection happens FIRST (before any scope prompts), so users are
 * never asked scope questions for components that are already installed.
 *
 * Handles three modes:
 * - Force: installs at user scope (or specified scopes) without prompting
 * - Scripted: installs at specified scopes without prompting
 * - Interactive: prompts for scope selection (only for missing components)
 */
export async function ensurePluginInstalled(options: PluginInstallerOptions): Promise<PluginInstallerResult> {
  const { logger, stdout, force, projectDir } = options
  const executor = options.executor ?? createDefaultExecutor()

  // --- Scripted mode validation (early exit) ---
  if (options.marketplaceScope && options.pluginScope) {
    if (!isScopeValid(options.marketplaceScope, options.pluginScope)) {
      const msg = `Plugin scope '${options.pluginScope}' is broader than marketplace scope '${options.marketplaceScope}'. Plugin scope must be equal to or narrower than marketplace scope.`
      stdout.write(`\u2717 ${msg}\n`)
      return {
        marketplaceScope: options.marketplaceScope,
        pluginScope: options.pluginScope,
        marketplaceAction: 'failed',
        pluginAction: 'failed',
        error: msg,
      }
    }
  }

  // --- Detect current state (before any prompts) ---
  const { scope: detectedMktScope, cliAvailable } = await detectMarketplaceAnywhere(executor, projectDir, logger)

  let pluginDetected = false
  if (cliAvailable) {
    try {
      pluginDetected = await detectPluginFromCLI(executor, logger)
    } catch {
      // Non-fatal: will attempt install later
    }
  }

  // --- Short-circuit: both already installed ---
  if (detectedMktScope && pluginDetected) {
    stdout.write(`\u2713 Marketplace: already installed (${detectedMktScope})\n`)
    stdout.write(`\u2713 Plugin: already installed\n`)
    return {
      marketplaceScope: options.marketplaceScope ?? detectedMktScope,
      pluginScope: options.pluginScope ?? detectedMktScope,
      marketplaceAction: 'already-installed',
      pluginAction: 'already-installed',
    }
  }

  // --- CLI not available ---
  if (!cliAvailable) {
    printManualInstructions(stdout)
    const error = 'claude CLI not available'
    stdout.write(`\u2717 Marketplace: ${error}\n`)
    return {
      marketplaceScope: options.marketplaceScope ?? 'user',
      pluginScope: options.pluginScope ?? 'user',
      marketplaceAction: detectedMktScope ? 'already-installed' : 'failed',
      pluginAction: 'failed',
      error,
    }
  }

  // --- Determine scopes (only for components that need installation) ---
  let marketplaceScope: InstallScope
  let pluginScope: InstallScope

  if (options.marketplaceScope && options.pluginScope) {
    // Scripted mode: use specified scopes
    marketplaceScope = options.marketplaceScope
    pluginScope = options.pluginScope
  } else if (force) {
    // Force mode: use specified or detected or default (dev-mode overrides to user)
    marketplaceScope = options.isDevMode ? 'user' : (options.marketplaceScope ?? detectedMktScope ?? 'user')
    pluginScope = options.isDevMode ? 'user' : (options.pluginScope ?? 'user')
  } else if (options.ctx) {
    // Interactive mode: prompt only for missing components
    printHeader(
      options.ctx,
      'Step 1: Plugin Installation',
      'Sidekick needs the marketplace and plugin installed in Claude Code.'
    )

    if (options.isDevMode) {
      printStatus(options.ctx, 'info', 'Dev-mode active \u2014 only user scope available for plugin installation')
    }

    if (detectedMktScope) {
      marketplaceScope = detectedMktScope
      printStatus(options.ctx, 'info', `Marketplace already installed (${detectedMktScope})`)
    } else if (options.isDevMode) {
      marketplaceScope = 'user'
      printStatus(options.ctx, 'info', 'Marketplace scope: user (constrained by dev-mode)')
    } else {
      marketplaceScope = await promptMarketplaceScope(options.ctx)
    }

    if (pluginDetected) {
      pluginScope = marketplaceScope
      printStatus(options.ctx, 'info', 'Plugin already installed')
    } else if (options.isDevMode) {
      pluginScope = 'user'
      printStatus(options.ctx, 'info', 'Plugin scope: user (constrained by dev-mode)')
    } else {
      const validPluginScopes = getValidPluginScopes(marketplaceScope)
      if (validPluginScopes.length === 1) {
        pluginScope = validPluginScopes[0]
        printStatus(
          options.ctx,
          'info',
          `Plugin scope auto-selected: ${pluginScope} (constrained by marketplace scope)`
        )
      } else {
        pluginScope = await promptPluginScope(options.ctx, validPluginScopes)
      }
    }
  } else {
    // Fallback: use detected or default
    marketplaceScope = detectedMktScope ?? 'user'
    pluginScope = 'user'
  }

  // --- Install marketplace if needed ---
  let marketplaceAction: PluginInstallerResult['marketplaceAction']

  if (detectedMktScope) {
    marketplaceAction = 'already-installed'
    stdout.write(`\u2713 Marketplace: already installed (${detectedMktScope})\n`)
  } else if (marketplaceScope === 'user') {
    const success = await installMarketplaceViaCLI(executor, logger)
    if (success) {
      marketplaceAction = 'installed'
      stdout.write(`\u2713 Marketplace: installed (${marketplaceScope})\n`)
    } else {
      marketplaceAction = 'failed'
      const error = 'Failed to install marketplace via CLI'
      stdout.write(`\u2717 Marketplace: ${error}\n`)
      return { marketplaceScope, pluginScope, marketplaceAction, pluginAction: 'failed', error }
    }
  } else {
    await installMarketplaceViaSettings(projectDir, marketplaceScope, logger)
    marketplaceAction = 'installed'
    stdout.write(`\u2713 Marketplace: installed via settings (${marketplaceScope})\n`)
  }

  // --- Install plugin if needed ---
  let pluginAction: PluginInstallerResult['pluginAction']

  if (pluginDetected) {
    pluginAction = 'already-installed'
    stdout.write(`\u2713 Plugin: already installed\n`)
  } else {
    const success = await installPlugin(executor, pluginScope, logger)
    if (success) {
      pluginAction = 'installed'
      stdout.write(`\u2713 Plugin: installed (${pluginScope})\n`)
    } else {
      pluginAction = 'failed'
      const error = 'Failed to install sidekick plugin'
      stdout.write(`\u2717 Plugin: ${error}\n`)
      return { marketplaceScope, pluginScope, marketplaceAction, pluginAction, error }
    }
  }

  return { marketplaceScope, pluginScope, marketplaceAction, pluginAction }
}
