// packages/sidekick-cli/src/commands/setup/index.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import type { Logger } from '@sidekick/types'
import type { UserSetupStatus, ProjectSetupStatus, ApiKeyHealth, GitignoreStatus } from '@sidekick/types'
import {
  SetupStatusService,
  installGitignoreSection,
  detectGitignoreStatus,
  validateOpenRouterKey,
  findZombieDaemons,
  killZombieDaemons,
  type AllScopesDetectionResult,
  type ApiKeySource,
  type PluginInstallationStatus,
  type PluginLivenessStatus,
} from '@sidekick/core'
import { printHeader, printStatus, promptSelect, promptConfirm, promptInput, type PromptContext } from './prompts.js'
import {
  ensurePluginInstalled,
  getValidPluginScopes,
  detectInstalledScope,
  type InstallScope,
} from './plugin-installer.js'
import { detectShell, installAlias, uninstallAlias, isAliasInRcFile } from './shell-alias.js'

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
  // Testing override - allows tests to specify home directory
  homeDir?: string
}

export interface SetupCommandResult {
  exitCode: number
  output?: string
}

const USAGE_TEXT = `Usage: sidekick setup [options]

Run the interactive setup wizard to configure sidekick for Claude Code.
When scripting flags are provided, runs non-interactively for those settings only.

Options:
  --check                       Check configuration status (alias: sidekick doctor)
  --fix                         Auto-fix detected issues (use with --check or doctor)
  --only=<checks>               Run only specific doctor checks (comma-separated)
                                Valid checks: api-keys, statusline, gitignore, plugin, liveness, zombies, auto-config, shell-alias
  --force                       Apply all defaults non-interactively
  --help                        Show this help message

Scripting Flags (for non-interactive/partial setup):
  --marketplace-scope=<scope>   Install marketplace: user | project | local
  --plugin-scope=<scope>        Install plugin: user | project | local
  --statusline-scope=<scope>    Configure statusline: user | project | local
  --gitignore                   Update .gitignore to exclude sidekick files
  --no-gitignore                Skip .gitignore configuration
  --personas                    Enable persona features
  --no-personas                 Disable persona features
  --api-key-scope=<scope>       Save API key from OPENROUTER_API_KEY env: user | project
  --auto-config=<mode>          Auto-configure preference: auto | manual
  --alias                       Add 'sidekick' shell alias to ~/.zshrc or ~/.bashrc
  --no-alias                    Remove 'sidekick' shell alias from shell config

Examples:
  sidekick setup                              Interactive wizard
  sidekick setup --check                      Check current status
  sidekick doctor --only=liveness             Run only the liveness check
  sidekick doctor --only=plugin,liveness      Run plugin and liveness checks
  sidekick setup --statusline-scope=user      Configure statusline only
  sidekick setup --gitignore --personas       Configure gitignore and enable personas
  OPENROUTER_API_KEY=sk-xxx sidekick setup --personas --api-key-scope=user
`

const STATUSLINE_COMMAND = 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR'

/** Resolve the settings file path for a given statusline scope. */
function statuslineSettingsPath(scope: InstallScope, homeDir: string, projectDir: string): string {
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
// Helper Functions
// ============================================================================

/**
 * Map plugin installation status to human-readable label.
 */
function getPluginStatusLabel(status: PluginInstallationStatus): string {
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
function getApiKeyStatusType(health: ApiKeyHealth): 'success' | 'warning' | 'info' {
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
function getPluginStatusIcon(status: PluginInstallationStatus): string {
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
function getLivenessIcon(status: PluginLivenessStatus): string {
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
function getLivenessLabel(status: PluginLivenessStatus): string {
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
function formatApiKeyScopes(scopes: {
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
function formatApiKeySource(source: ApiKeySource | null): string {
  if (!source) return ''
  const labels: Record<ApiKeySource, string> = {
    'project-env': 'project .env',
    'user-env': 'user .env',
    'env-var': 'env variable',
  }
  return ` (from ${labels[source]})`
}

/**
 * Write statusline config to Claude Code settings.json.
 * Returns true if written, false if skipped (e.g. dev-mode statusline detected).
 */
async function configureStatusline(settingsPath: string, logger?: Logger): Promise<boolean> {
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
async function writeApiKeyToEnv(envPath: string, key: string, value: string): Promise<void> {
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
async function writePersonaConfig(homeDir: string, enabled: boolean): Promise<void> {
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
// Wizard Context (shared state between steps)
// ============================================================================

interface WizardContext {
  ctx: PromptContext
  homeDir: string
  projectDir: string
  logger: Logger
  setupService: SetupStatusService
}

interface WizardState {
  statuslineScope: InstallScope
  gitignoreStatus: GitignoreStatus
  wantPersonas: boolean
  apiKeyHealth: ApiKeyHealth
  apiKeyDetection: AllScopesDetectionResult | null
  autoConfig: 'auto' | 'manual'
  shellAlias: 'installed' | 'already-installed' | 'skipped' | 'unsupported'
}

// ============================================================================
// Wizard Steps
// ============================================================================

/**
 * Print the wizard welcome header.
 */
function printWizardHeader(stdout: NodeJS.WritableStream): void {
  stdout.write('\n┌─────────────────────────────────────────────────────────┐\n')
  stdout.write('│  Sidekick Setup Wizard                                  │\n')
  stdout.write('│                                                         │\n')
  stdout.write('│  This wizard configures sidekick for Claude Code.       │\n')
  stdout.write("│  Run 'sidekick setup' again anytime to reconfigure.     │\n")
  stdout.write('└─────────────────────────────────────────────────────────┘\n')
}

/**
 * Step 2: Configure statusline location.
 * Statusline scope must be equal to or narrower than plugin scope.
 */
async function runStep2Statusline(
  wctx: WizardContext,
  pluginScope: InstallScope,
  isDevMode: boolean
): Promise<InstallScope> {
  const { ctx, homeDir, projectDir, logger } = wctx

  printHeader(ctx, 'Step 2: Statusline Configuration', 'Claude Code plugins cannot provide statusline config directly.')

  // Dev-mode: force user scope
  if (isDevMode) {
    const settingsPath = statuslineSettingsPath('user', homeDir, projectDir)
    const wrote = await configureStatusline(settingsPath, logger)
    if (wrote) {
      printStatus(ctx, 'success', 'Statusline configured at user scope (dev-mode active)')
    } else {
      printStatus(ctx, 'warning', 'Statusline managed by dev-mode (skipped)')
    }
    return 'user'
  }

  const STATUSLINE_SCOPE_OPTIONS: Record<InstallScope, { label: string; description: string }> = {
    user: { label: 'User-level (~/.claude/settings.json)', description: 'Works in all projects' },
    project: { label: 'Project-level (.claude/settings.json)', description: 'Shared via git' },
    local: { label: 'Local (.claude/settings.local.json)', description: 'This machine only, not shared via git' },
  }

  const validScopes = getValidPluginScopes(pluginScope)
  let statuslineScope: InstallScope

  if (validScopes.length === 1) {
    statuslineScope = validScopes[0]
    printStatus(ctx, 'info', `Statusline scope auto-selected: ${statuslineScope} (constrained by plugin scope)`)
  } else {
    const options = validScopes.map((scope) => ({
      value: scope,
      ...STATUSLINE_SCOPE_OPTIONS[scope],
    }))
    statuslineScope = await promptSelect(ctx, 'Where should sidekick configure your statusline?', options)
  }

  // Configure statusline
  const settingsPath = statuslineSettingsPath(statuslineScope, homeDir, projectDir)

  const wrote = await configureStatusline(settingsPath, logger)
  if (wrote) {
    printStatus(ctx, 'success', `Statusline configured in ${settingsPath}`)
  } else {
    printStatus(ctx, 'warning', 'Statusline managed by dev-mode (skipped)')
  }

  return statuslineScope
}

/**
 * Step 3: Configure .gitignore for sidekick files.
 */
async function runStep3Gitignore(wctx: WizardContext, force: boolean): Promise<GitignoreStatus> {
  const { ctx, projectDir } = wctx

  // Check current status
  const currentStatus = await detectGitignoreStatus(projectDir)

  if (currentStatus === 'installed') {
    if (!force) {
      printStatus(ctx, 'success', 'Sidekick entries already present in .gitignore')
    }
    return 'installed'
  }

  const needsRepair = currentStatus === 'incomplete'

  // Force mode: just install/repair without prompting
  if (force) {
    const result = await installGitignoreSection(projectDir)
    return result.status === 'error' ? 'missing' : 'installed'
  }

  // Interactive mode: ask user
  printHeader(ctx, 'Step 3: Git Configuration', 'Sidekick creates logs and session data that should not be committed.')

  if (needsRepair) {
    printStatus(ctx, 'warning', 'Existing .gitignore section is incomplete and needs repair')
  }

  const promptMessage = needsRepair
    ? 'Repair .gitignore section with missing entries?'
    : 'Update .gitignore to exclude sidekick transient files?'

  const shouldInstall = await promptConfirm(ctx, promptMessage, true)

  if (!shouldInstall) {
    printStatus(ctx, 'info', 'Skipping .gitignore configuration (you can manage it manually)')
    return needsRepair ? 'incomplete' : 'missing'
  }

  const result = await installGitignoreSection(projectDir)

  if (result.status === 'error') {
    printStatus(ctx, 'warning', `Failed to update .gitignore: ${result.error}`)
    return needsRepair ? 'incomplete' : 'missing'
  }

  // Both 'installed' and 'already-installed' are success states
  let message: string
  if (needsRepair) {
    message = 'Repaired sidekick section in .gitignore'
  } else if (result.status === 'already-installed') {
    message = 'Sidekick entries already present in .gitignore'
  } else {
    message = 'Added sidekick section to .gitignore'
  }
  printStatus(ctx, 'success', message)
  return 'installed'
}

/**
 * Step 4: Configure API key for LLM features.
 * API keys power all LLM features: session titles, topic classification,
 * completion detection, and persona messages. This step runs independently
 * of persona enablement.
 */
async function runStep4ApiKey(
  wctx: WizardContext
): Promise<{ apiKeyHealth: ApiKeyHealth; apiKeyDetection: AllScopesDetectionResult | null }> {
  const { ctx } = wctx

  printHeader(
    ctx,
    'Step 4: API Key Configuration',
    'Sidekick uses an OpenRouter API key for LLM-powered features:\nsession titles, topic classification, completion detection, and persona messages.'
  )

  const result = await configureApiKey(wctx)
  return { apiKeyHealth: result.health, apiKeyDetection: result.detection }
}

/**
 * Step 5: Configure persona features.
 */
async function runStep5Personas(wctx: WizardContext): Promise<boolean> {
  const { ctx, homeDir } = wctx

  printHeader(
    ctx,
    'Step 5: Persona Features',
    'Sidekick includes AI personas (Marvin, Skippy, etc.) that add\npersonality to your coding sessions with snarky messages and contextual nudges.'
  )

  const wantPersonas = await promptConfirm(ctx, 'Enable persona features?', true)
  await writePersonaConfig(homeDir, wantPersonas)
  printStatus(ctx, wantPersonas ? 'success' : 'info', `Personas ${wantPersonas ? 'enabled' : 'disabled'}`)

  return wantPersonas
}

/**
 * Configure API key.
 * Uses detectAllApiKeys to check all scopes with validation, shows per-scope results.
 */
async function configureApiKey(
  wctx: WizardContext
): Promise<{ health: ApiKeyHealth; detection: AllScopesDetectionResult | null }> {
  const { ctx, homeDir, projectDir, logger, setupService } = wctx
  const stdout = ctx.stdout

  // Detect keys across all scopes with validation
  stdout.write('\nChecking API keys...\n')
  const detection = await setupService.detectAllApiKeys('OPENROUTER_API_KEY')

  // Display per-scope results
  const scopeLabels = {
    project: 'project (.sidekick/.env)',
    user: 'user (~/.sidekick/.env)',
    env: 'env (OPENROUTER_API_KEY)',
  }
  for (const scope of ['project', 'user', 'env'] as const) {
    const r = detection[scope]
    const icon = r.found ? (r.status === 'healthy' ? '✓' : '✗') : '-'
    const label = r.found ? r.status : 'not found'
    stdout.write(`  ${icon} ${scopeLabels[scope]}: ${label}\n`)
  }

  // Check if any scope has a healthy key
  const healthyScope = (['project', 'user', 'env'] as const).find((s) => detection[s].status === 'healthy')
  if (healthyScope) {
    printStatus(ctx, 'success', `OpenRouter API Key: healthy (using ${healthyScope})`)
    return { health: 'healthy', detection }
  }

  // Check if any key was found but invalid
  const invalidScope = (['project', 'user', 'env'] as const).find((s) => detection[s].found)
  if (invalidScope) {
    printStatus(ctx, 'warning', 'API key found but validation failed')
  } else {
    printStatus(ctx, 'warning', 'OPENROUTER_API_KEY not found')
  }

  const configureNow = await promptConfirm(ctx, invalidScope ? 'Replace API key?' : 'Configure API key now?', true)

  if (!configureNow) {
    stdout.write('\n')
    printStatus(ctx, 'warning', 'LLM features will be limited until an API key is configured.')
    stdout.write("Run 'sidekick setup' again or ask Claude to help configure API keys using /sidekick-config.\n")
    return { health: 'missing', detection }
  }

  // User wants to configure key now
  const keyScope = await promptSelect(ctx, 'Where should the API key be stored?', [
    { value: 'user' as const, label: 'User-level (~/.sidekick/.env)', description: 'Works in all projects' },
    { value: 'project' as const, label: 'Project-level (.sidekick/.env)', description: 'This project only' },
  ])

  const apiKey = await promptInput(ctx, 'Paste your OpenRouter API key')

  if (!apiKey) {
    printStatus(ctx, 'warning', 'No API key entered, skipping')
    return { health: 'missing' as ApiKeyHealth, detection: null }
  }

  stdout.write('Validating... ')
  const result = await validateOpenRouterKey(apiKey, logger)
  const envPath =
    keyScope === 'user' ? path.join(homeDir, '.sidekick', '.env') : path.join(projectDir, '.sidekick', '.env')

  if (result.valid) {
    stdout.write('valid!\n')
    await writeApiKeyToEnv(envPath, 'OPENROUTER_API_KEY', apiKey)
    printStatus(ctx, 'success', `API key saved to ${envPath}`)
  } else {
    stdout.write(`invalid (${result.error})\n`)
    printStatus(ctx, 'warning', 'API key validation failed, saving anyway')
    await writeApiKeyToEnv(envPath, 'OPENROUTER_API_KEY', apiKey)
  }

  // Re-detect after writing to get accurate scope state (skip validation — we just validated above)
  const postDetection = await setupService.detectAllApiKeys('OPENROUTER_API_KEY', true)
  return { health: result.valid ? 'healthy' : 'invalid', detection: postDetection }
}

/**
 * Step 6: Configure auto-configuration preference.
 */
async function runStep6AutoConfig(wctx: WizardContext, pluginScope: InstallScope): Promise<'auto' | 'manual'> {
  const { ctx } = wctx

  printHeader(ctx, 'Step 6: Project Auto-Configuration')

  if (pluginScope !== 'user') {
    printStatus(ctx, 'info', 'Auto-configure requires user-scoped plugin installation (skipped)')
    return 'manual'
  }

  const autoConfig = await promptSelect(ctx, 'When sidekick runs in a new project for the first time:', [
    { value: 'auto' as const, label: 'Auto-configure using my defaults', description: 'Recommended' },
    { value: 'manual' as const, label: 'Do nothing', description: 'Manual setup only' },
  ])

  return autoConfig
}

/**
 * Step 7: Configure shell alias for easier CLI access.
 */
async function runStep7ShellAlias(
  wctx: WizardContext
): Promise<'installed' | 'already-installed' | 'skipped' | 'unsupported'> {
  const { ctx, homeDir } = wctx
  const shellInfo = detectShell(process.env.SHELL)

  printHeader(ctx, 'Step 7: Shell Alias')

  if (!shellInfo) {
    printStatus(ctx, 'info', 'Unsupported shell — only zsh and bash are supported')
    return 'unsupported'
  }

  const rcPath = path.join(homeDir, shellInfo.rcFile)

  if (isAliasInRcFile(rcPath)) {
    printStatus(ctx, 'success', `Shell alias already configured in ~/${shellInfo.rcFile}`)
    return 'already-installed'
  }

  const choice = await promptSelect(ctx, "Add a 'sidekick' shell alias for easier CLI access?", [
    { value: 'yes' as const, label: 'Yes', description: `Add alias to ~/${shellInfo.rcFile}` },
    { value: 'no' as const, label: 'No', description: 'Skip — use npx @scotthamilton77/sidekick' },
  ])

  if (choice === 'no') {
    printStatus(ctx, 'info', 'Shell alias skipped')
    return 'skipped'
  }

  const result = installAlias(rcPath)
  if (result === 'installed') {
    printStatus(ctx, 'success', `Alias added to ~/${shellInfo.rcFile}`)
    printStatus(ctx, 'info', `Run 'source ~/${shellInfo.rcFile}' or open a new terminal to activate`)
  }
  return result
}

/**
 * Write the status files based on wizard results.
 */
async function writeStatusFiles(wctx: WizardContext, state: WizardState): Promise<void> {
  const { setupService } = wctx
  const { statuslineScope, gitignoreStatus, apiKeyHealth, apiKeyDetection, autoConfig } = state

  const userStatus: UserSetupStatus = {
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    preferences: {
      autoConfigureProjects: autoConfig === 'auto',
      defaultStatuslineScope: statuslineScope,
      defaultApiKeyScope: 'user',
    },
    statusline: statuslineScope,
    apiKeys: {
      OPENROUTER_API_KEY: apiKeyDetection
        ? setupService.buildUserApiKeyStatus(apiKeyDetection)
        : SetupStatusService.userApiKeyStatusFromHealth(apiKeyHealth),
      OPENAI_API_KEY: SetupStatusService.userApiKeyStatusFromHealth('not-required'),
    },
  }

  await setupService.writeUserStatus(userStatus)

  // Preserve fields managed by other subsystems (e.g. dev-mode)
  const existingProject = await setupService.getProjectStatus()

  // Determine project-level API key status:
  // Use comprehensive detection if available, else convert health string to object format
  const projectOpenRouterStatus = apiKeyDetection
    ? setupService.buildProjectApiKeyStatus(apiKeyDetection)
    : SetupStatusService.projectApiKeyStatusFromHealth(apiKeyHealth)

  // Always write project status now (we track gitignore at project level)
  const projectStatus: ProjectSetupStatus = {
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    autoConfigured: false,
    statusline: statuslineScope,
    apiKeys: {
      OPENROUTER_API_KEY: projectOpenRouterStatus,
      OPENAI_API_KEY: SetupStatusService.projectApiKeyStatusFromHealth('not-required'),
    },
    gitignore: gitignoreStatus,
    devMode: existingProject?.devMode,
  }
  await setupService.writeProjectStatus(projectStatus)
}

/**
 * Print the summary of wizard choices.
 */
function printSummary(wctx: WizardContext, state: WizardState): void {
  const { ctx } = wctx
  const { statuslineScope, gitignoreStatus, wantPersonas, apiKeyHealth, autoConfig } = state
  const stdout = ctx.stdout

  printHeader(ctx, 'Summary')
  const scopeLabel = { user: 'User-level', project: 'Project-level', local: 'Local' }[statuslineScope]
  printStatus(ctx, 'success', `Statusline: ${scopeLabel}`)

  let gitignoreStatusType: 'success' | 'warning' | 'info'
  let gitignoreLabel: string
  switch (gitignoreStatus) {
    case 'installed':
      gitignoreStatusType = 'success'
      gitignoreLabel = 'Configured'
      break
    case 'incomplete':
      gitignoreStatusType = 'warning'
      gitignoreLabel = 'Incomplete'
      break
    default:
      gitignoreStatusType = 'info'
      gitignoreLabel = 'Skipped'
  }
  printStatus(ctx, gitignoreStatusType, `Gitignore: ${gitignoreLabel}`)
  printStatus(ctx, wantPersonas ? 'success' : 'info', `Personas: ${wantPersonas ? 'Enabled' : 'Disabled'}`)

  const apiKeyStatusType = getApiKeyStatusType(apiKeyHealth)
  printStatus(ctx, apiKeyStatusType, `API Key: ${apiKeyHealth}`)
  if (state.apiKeyDetection) {
    const scopes = {
      project: state.apiKeyDetection.project.status,
      user: state.apiKeyDetection.user.status,
      env: state.apiKeyDetection.env.status,
    }
    stdout.write(`         ${formatApiKeyScopes(scopes)}\n`)
  }
  printStatus(ctx, 'success', `Auto-configure: ${autoConfig === 'auto' ? 'Enabled' : 'Disabled'}`)

  const aliasStatusType: 'success' | 'info' =
    state.shellAlias === 'installed' || state.shellAlias === 'already-installed' ? 'success' : 'info'
  const aliasLabels: Record<WizardState['shellAlias'], string> = {
    installed: 'Installed',
    'already-installed': 'Already configured',
    skipped: 'Skipped',
    unsupported: 'Unsupported shell',
  }
  printStatus(ctx, aliasStatusType, `Shell Alias: ${aliasLabels[state.shellAlias]}`)

  stdout.write('\n')
  stdout.write('Setup complete! Your statusline and hooks are now active.\n')
}

// ============================================================================
// Main Entry Points
// ============================================================================

/**
 * Run the interactive setup wizard.
 */
async function runWizard(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options: SetupCommandOptions,
  isDevMode: boolean
): Promise<SetupCommandResult> {
  const homeDir = options.homeDir ?? os.homedir()
  const wctx: WizardContext = {
    ctx: {
      stdin: options.stdin ?? process.stdin,
      stdout,
    },
    homeDir,
    projectDir,
    logger,
    setupService: new SetupStatusService(projectDir, { homeDir, logger }),
  }

  const force = options.force ?? false

  // Run wizard steps
  if (!force) {
    printWizardHeader(stdout)
  }

  // Dev-mode banner
  if (isDevMode && !force) {
    stdout.write('\n')
    stdout.write('  ⚠ Dev-mode is active — project and local scope options are unavailable.\n')
    stdout.write('    Only user-scope configuration is available for plugin and statusline.\n')
    stdout.write('\n')
  }

  // Step 1: Plugin installation
  const pluginResult = await ensurePluginInstalled({
    logger,
    stdout,
    force,
    projectDir,
    ctx: wctx.ctx,
    marketplaceScope: options.marketplaceScope,
    pluginScope: options.pluginScope,
    isDevMode,
  })
  if (pluginResult.error) {
    logger.warn('Plugin installation had issues, continuing with setup', { error: pluginResult.error })
  }

  // Force mode: statusline defaults to plugin scope (respects scope constraint)
  const forceStatuslineScope = pluginResult.pluginScope
  const forceEffectiveScope: InstallScope = isDevMode ? 'user' : forceStatuslineScope
  const statuslineScope = force
    ? forceEffectiveScope
    : await runStep2Statusline(wctx, pluginResult.pluginScope, isDevMode)
  const gitignoreStatus = await runStep3Gitignore(wctx, force)
  const { apiKeyHealth, apiKeyDetection } = force
    ? { apiKeyHealth: 'missing' as const, apiKeyDetection: null }
    : await runStep4ApiKey(wctx)
  const wantPersonas = force ? true : await runStep5Personas(wctx)
  const forceAutoConfig = pluginResult.pluginScope === 'user' ? 'auto' : 'manual'
  const autoConfig = force ? forceAutoConfig : await runStep6AutoConfig(wctx, pluginResult.pluginScope)
  const shellAlias = force ? ('skipped' as const) : await runStep7ShellAlias(wctx)

  // In force mode, configure statusline at same scope as plugin
  if (force) {
    const settingsPath = statuslineSettingsPath(forceEffectiveScope, homeDir, projectDir)
    const wrote = await configureStatusline(settingsPath, logger)
    if (!wrote) {
      stdout.write('⚠ Statusline managed by dev-mode (skipped)\n')
    }
  }

  // Collect state and finalize
  const state: WizardState = {
    statuslineScope,
    gitignoreStatus,
    wantPersonas,
    apiKeyHealth,
    apiKeyDetection,
    autoConfig,
    shellAlias,
  }
  await writeStatusFiles(wctx, state)

  if (!force) {
    printSummary(wctx, state)
  } else {
    // Force mode: show brief summary of what was configured
    stdout.write('Setup complete (force mode):\n')
    stdout.write(`  Plugin: ${pluginResult.pluginAction} (${pluginResult.pluginScope})\n`)
    stdout.write(
      `  Statusline: ${forceEffectiveScope} (${statuslineSettingsPath(forceEffectiveScope, homeDir, projectDir)})\n`
    )
    stdout.write(`  Gitignore: ${gitignoreStatus === 'installed' ? 'configured' : 'skipped'}\n`)
    stdout.write(`  API Key: not configured (run 'sidekick setup' to add)\n`)
    stdout.write(`  Personas: enabled\n`)
    stdout.write(`  Auto-configure: ${autoConfig === 'auto' ? 'enabled' : 'disabled'}\n`)
    stdout.write(`  Shell Alias: skipped (run 'sidekick setup --alias' to add)\n`)
  }

  return { exitCode: 0 }
}

/**
 * Check if any scripting flags are provided.
 */
function hasScriptingFlags(options: SetupCommandOptions): boolean {
  return (
    options.marketplaceScope !== undefined ||
    options.pluginScope !== undefined ||
    options.statuslineScope !== undefined ||
    options.gitignore !== undefined ||
    options.personas !== undefined ||
    options.apiKeyScope !== undefined ||
    options.autoConfig !== undefined ||
    options.alias !== undefined
  )
}

/**
 * Run scripted (non-interactive) setup for specified options only.
 */
async function runScripted(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options: SetupCommandOptions,
  isDevMode: boolean
): Promise<SetupCommandResult> {
  const homeDir = options.homeDir ?? os.homedir()
  const setupService = new SetupStatusService(projectDir, { homeDir, logger })

  // Dev-mode scope guard: block project/local scopes
  if (isDevMode) {
    const blocked: string[] = []
    if (options.marketplaceScope && options.marketplaceScope !== 'user') {
      blocked.push(`--marketplace-scope=${options.marketplaceScope}`)
    }
    if (options.pluginScope && options.pluginScope !== 'user') {
      blocked.push(`--plugin-scope=${options.pluginScope}`)
    }
    if (options.statuslineScope && options.statuslineScope !== 'user') {
      blocked.push(`--statusline-scope=${options.statuslineScope}`)
    }

    if (blocked.length > 0) {
      stdout.write(`✗ Dev-mode is active. Cannot use non-user scopes: ${blocked.join(', ')}\n`)
      stdout.write('  Disable dev-mode first (pnpm sidekick dev-mode disable) or use user scope.\n')
      return { exitCode: 1 }
    }
  }

  let configuredCount = 0

  // 0. Install marketplace/plugin if specified
  if (options.marketplaceScope !== undefined || options.pluginScope !== undefined) {
    const pluginResult = await ensurePluginInstalled({
      logger,
      stdout,
      force: true, // scripted mode never prompts
      projectDir,
      marketplaceScope: options.marketplaceScope,
      pluginScope: options.pluginScope,
    })
    if (pluginResult.error) {
      stdout.write(`⚠ Plugin installation issue: ${pluginResult.error}\n`)
    } else {
      configuredCount++
    }
  }

  // 1. Configure statusline if specified
  if (options.statuslineScope) {
    const settingsPath = statuslineSettingsPath(options.statuslineScope, homeDir, projectDir)

    const wrote = await configureStatusline(settingsPath, logger)
    if (wrote) {
      stdout.write(`✓ Statusline configured (${options.statuslineScope}-level)\n`)
      configuredCount++
    } else {
      stdout.write(`⚠ Statusline managed by dev-mode (skipped)\n`)
    }
  }

  // 2. Configure gitignore if specified
  if (options.gitignore === true) {
    const result = await installGitignoreSection(projectDir)
    if (result.status === 'error') {
      stdout.write(`⚠ Failed to update .gitignore: ${result.error}\n`)
    } else if (result.status === 'already-installed') {
      stdout.write('✓ Gitignore already configured\n')
    } else {
      stdout.write('✓ Gitignore configured\n')
    }
    configuredCount++
  } else if (options.gitignore === false) {
    stdout.write('- Gitignore skipped\n')
  }

  // 3. Configure personas if specified
  if (options.personas !== undefined) {
    await writePersonaConfig(homeDir, options.personas)
    stdout.write(`✓ Personas ${options.personas ? 'enabled' : 'disabled'}\n`)
    configuredCount++
  }

  // 4. Configure API key if scope specified and env var present
  if (options.apiKeyScope) {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (apiKey) {
      const envPath =
        options.apiKeyScope === 'user'
          ? path.join(homeDir, '.sidekick', '.env')
          : path.join(projectDir, '.sidekick', '.env')

      // Validate the key first
      stdout.write('Validating API key... ')
      const result = await validateOpenRouterKey(apiKey, logger)
      if (result.valid) {
        stdout.write('valid\n')
        await writeApiKeyToEnv(envPath, 'OPENROUTER_API_KEY', apiKey)
        stdout.write(`✓ API key saved (${options.apiKeyScope}-level)\n`)
      } else {
        stdout.write(`invalid (${result.error})\n`)
        stdout.write(`⚠ API key saved anyway (${options.apiKeyScope}-level)\n`)
        await writeApiKeyToEnv(envPath, 'OPENROUTER_API_KEY', apiKey)
      }
      configuredCount++
    } else {
      stdout.write('⚠ --api-key-scope specified but OPENROUTER_API_KEY not set in environment\n')
    }
  }

  // 5. Configure auto-config preference if specified
  if (options.autoConfig) {
    // Determine effective plugin scope: explicit flag > detected > default
    const effectivePluginScope = options.pluginScope ?? (await detectInstalledScope(projectDir, logger)) ?? 'user'

    if (options.autoConfig === 'auto' && effectivePluginScope !== 'user') {
      stdout.write(
        `⚠ Auto-configure requires user-scoped plugin installation (plugin scope: ${effectivePluginScope})\n`
      )
      stdout.write('  Skipping --auto-config=auto. Install plugin at user scope to enable.\n')
    } else {
      // Read existing user status or create new
      const existingUserStatus = await setupService.getUserStatus()
      const userStatus: UserSetupStatus = existingUserStatus ?? {
        version: 1,
        lastUpdatedAt: new Date().toISOString(),
        preferences: {
          autoConfigureProjects: options.autoConfig === 'auto',
          defaultStatuslineScope: 'user',
          defaultApiKeyScope: 'user',
        },
        statusline: 'none',
        apiKeys: {
          OPENROUTER_API_KEY: 'missing',
          OPENAI_API_KEY: 'missing',
        },
      }

      userStatus.preferences.autoConfigureProjects = options.autoConfig === 'auto'
      userStatus.lastUpdatedAt = new Date().toISOString()
      await setupService.writeUserStatus(userStatus)
      stdout.write(`✓ Auto-config set to '${options.autoConfig}'\n`)
      configuredCount++
    }
  }

  // 6. Install or remove shell alias if specified
  if (options.alias !== undefined) {
    const shellInfo = detectShell(process.env.SHELL)
    if (!shellInfo) {
      stdout.write('⚠ Unsupported shell — only zsh and bash are supported\n')
    } else {
      const rcPath = path.join(homeDir, shellInfo.rcFile)
      if (options.alias) {
        const result = installAlias(rcPath)
        if (result === 'installed') {
          stdout.write(`✓ Shell alias added to ~/${shellInfo.rcFile}\n`)
          stdout.write(`  Run 'source ~/${shellInfo.rcFile}' or open a new terminal to activate.\n`)
        } else {
          stdout.write(`✓ Shell alias already configured in ~/${shellInfo.rcFile}\n`)
        }
      } else {
        const result = uninstallAlias(rcPath)
        if (result === 'removed') {
          stdout.write(`✓ Shell alias removed from ~/${shellInfo.rcFile}\n`)
        } else {
          stdout.write(`- No shell alias found in ~/${shellInfo.rcFile}\n`)
        }
      }
      configuredCount++
    }
  }

  // Write project setup-status.json so hooks know this project is configured
  if (configuredCount > 0) {
    const existingProject = await setupService.getProjectStatus()
    const projectStatus: ProjectSetupStatus = {
      version: 1,
      lastUpdatedAt: new Date().toISOString(),
      autoConfigured: false,
      statusline: options.statuslineScope ?? existingProject?.statusline ?? 'none',
      apiKeys: existingProject?.apiKeys ?? {
        OPENROUTER_API_KEY: SetupStatusService.projectApiKeyStatusFromHealth('missing'),
        OPENAI_API_KEY: SetupStatusService.projectApiKeyStatusFromHealth('not-required'),
      },
      gitignore: options.gitignore ? 'installed' : (existingProject?.gitignore ?? 'unknown'),
      ...(existingProject?.devMode !== undefined && { devMode: existingProject.devMode }),
    }
    await setupService.writeProjectStatus(projectStatus)
  }

  if (configuredCount === 0) {
    stdout.write('No configuration changes made. Use --help to see available options.\n')
  } else {
    stdout.write(`\nConfigured ${configuredCount} setting${configuredCount === 1 ? '' : 's'}.\n`)
  }

  return { exitCode: 0 }
}

/**
 * Run the doctor/check mode.
 * Now checks actual config state against cache and updates cache if mismatched.
 */
const DOCTOR_CHECK_NAMES = [
  'api-keys',
  'statusline',
  'gitignore',
  'plugin',
  'liveness',
  'zombies',
  'auto-config',
  'shell-alias',
] as const
type DoctorCheckName = (typeof DOCTOR_CHECK_NAMES)[number]

function parseDoctorOnly(only: string | undefined): Set<DoctorCheckName> | null {
  if (!only) return null
  const requested = only.split(',').map((s) => s.trim())
  const invalid = requested.filter((s) => !DOCTOR_CHECK_NAMES.includes(s as DoctorCheckName))
  if (invalid.length > 0) {
    throw new Error(`Unknown doctor check(s): ${invalid.join(', ')}. Valid: ${DOCTOR_CHECK_NAMES.join(', ')}`)
  }
  return new Set(requested as DoctorCheckName[])
}

/** Result type from SetupStatusService.runDoctorCheck() */
type DoctorCheckResultType = Awaited<ReturnType<SetupStatusService['runDoctorCheck']>>

/**
 * Apply targeted fixes for unhealthy doctor items.
 * When filter is null (unfiltered), runs all fixes and reports unfixable items.
 * When filter is provided, only runs fixes for the specified checks.
 */
async function runDoctorFixes(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  context: {
    homeDir: string
    filter: Set<DoctorCheckName> | null
    doctorResult: DoctorCheckResultType | null
    gitignore: string | null
    pluginStatus: PluginInstallationStatus | null
    liveness: PluginLivenessStatus | null
  }
): Promise<SetupCommandResult> {
  const { homeDir, filter, doctorResult, gitignore, pluginStatus, liveness } = context
  const isFullMode = filter === null
  const shouldFix = (check: DoctorCheckName): boolean => isFullMode || filter.has(check)

  logger.info('Starting doctor fix mode', { homeDir, isFullMode, gitignore, pluginStatus, liveness })
  stdout.write('\nFixing detected issues...\n\n')

  let fixedCount = 0
  const unfixable: string[] = []

  // Fix: Missing user setup-status file (only in full mode — not a named check)
  if (isFullMode && doctorResult && !doctorResult.userSetupExists) {
    stdout.write('Fixing: User Setup\n')
    const setupService = new SetupStatusService(projectDir, { homeDir, logger })
    const userStatus: UserSetupStatus = {
      version: 1,
      lastUpdatedAt: new Date().toISOString(),
      preferences: {
        autoConfigureProjects: true,
        defaultStatuslineScope: 'user',
        defaultApiKeyScope: 'user',
      },
      statusline: 'none',
      apiKeys: {
        OPENROUTER_API_KEY: SetupStatusService.userApiKeyStatusFromHealth('missing'),
        OPENAI_API_KEY: SetupStatusService.userApiKeyStatusFromHealth('missing'),
      },
    }
    await setupService.writeUserStatus(userStatus)
    stdout.write('  ✓ Created ~/.sidekick/setup-status.json with defaults\n')
    fixedCount++
  }

  // Fix: Missing statusline
  if (shouldFix('statusline') && doctorResult?.statusline.actual === 'none') {
    stdout.write('Fixing: Statusline\n')
    const settingsPath = statuslineSettingsPath('user', homeDir, projectDir)
    const wrote = await configureStatusline(settingsPath, logger)
    if (wrote) {
      stdout.write('  ✓ Statusline configured at user scope\n')
      fixedCount++
    } else {
      stdout.write('  ⚠ Statusline managed by dev-mode (skipped)\n')
    }
  }

  // Fix: Missing/incomplete gitignore
  if (shouldFix('gitignore') && gitignore !== null && gitignore !== 'installed') {
    stdout.write('Fixing: Gitignore\n')
    const result = await installGitignoreSection(projectDir)
    if (result.status === 'error') {
      stdout.write(`  ⚠ Failed to update .gitignore: ${result.error}\n`)
    } else {
      stdout.write('  ✓ Gitignore configured\n')
      fixedCount++
    }
  }

  // Fix: Missing plugin
  if (shouldFix('plugin') && pluginStatus === 'none') {
    stdout.write('Fixing: Plugin\n')
    try {
      const pluginResult = await ensurePluginInstalled({
        logger,
        stdout,
        force: true,
        projectDir,
        marketplaceScope: 'user',
      })
      if (pluginResult.error) {
        stdout.write(`  ⚠ Plugin installation issue: ${pluginResult.error}\n`)
      } else {
        stdout.write(`  ✓ Plugin installed (${pluginResult.pluginScope})\n`)
        fixedCount++
      }
    } catch (err) {
      stdout.write(`  ⚠ Plugin installation failed: ${err instanceof Error ? err.message : String(err)}\n`)
    }
  }

  // Fix: Zombie daemons
  if (shouldFix('zombies')) {
    const zombieResults = await killZombieDaemons(logger)
    if (zombieResults.length > 0) {
      stdout.write('Fixing: Zombie Daemons\n')
      const killed = zombieResults.filter((r) => r.killed).length
      if (killed > 0) {
        stdout.write(`  ✓ Killed ${killed} zombie daemon${killed === 1 ? '' : 's'}\n`)
        fixedCount++
      }
      const failed = zombieResults.filter((r) => !r.killed)
      for (const f of failed) {
        stdout.write(`  ⚠ Failed to kill PID ${f.pid}: ${f.error}\n`)
      }
    }
  }

  // Fix: Missing shell alias
  if (shouldFix('shell-alias')) {
    const shellInfo = detectShell(process.env.SHELL)
    if (shellInfo) {
      const rcPath = path.join(homeDir, shellInfo.rcFile)
      if (!isAliasInRcFile(rcPath)) {
        stdout.write('Fixing: Shell Alias\n')
        const aliasResult = installAlias(rcPath)
        if (aliasResult === 'installed') {
          stdout.write(`  ✓ Shell alias added to ~/${shellInfo.rcFile}\n`)
          stdout.write(`  Run 'source ~/${shellInfo.rcFile}' or open a new terminal to activate.\n`)
          fixedCount++
        }
      }
    }
  }

  // Unfixable items (only tracked in full mode)
  if (isFullMode && doctorResult) {
    const openRouterHealth = doctorResult.apiKeys.OPENROUTER_API_KEY.actual
    if (openRouterHealth !== 'healthy' && openRouterHealth !== 'not-required') {
      unfixable.push("API Key: Run 'sidekick setup' to configure API keys interactively.")
    }
    if (liveness !== null && liveness !== 'active') {
      unfixable.push(
        "Plugin Liveness: Hooks not responding. Try running '/sidekick-config' in Claude Code or 'sidekick setup' from the terminal."
      )
    }
  }

  // Summary
  stdout.write('\n')
  if (fixedCount > 0) {
    stdout.write(`Fixed ${fixedCount} issue${fixedCount === 1 ? '' : 's'}.\n`)
  } else if (!isFullMode) {
    stdout.write('No fixable issues found.\n')
  }
  if (unfixable.length > 0) {
    stdout.write('\nRequires manual action:\n')
    for (const msg of unfixable) {
      stdout.write(`  → ${msg}\n`)
    }
  }

  return { exitCode: unfixable.length > 0 ? 1 : 0 }
}

async function runDoctor(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options?: { homeDir?: string; only?: string; fix?: boolean }
): Promise<SetupCommandResult> {
  const homeDir = options?.homeDir ?? os.homedir()
  const setupService = new SetupStatusService(projectDir, { homeDir, logger })

  let filter: Set<DoctorCheckName> | null
  try {
    filter = parseDoctorOnly(options?.only)
  } catch (err) {
    stdout.write(`${err instanceof Error ? err.message : String(err)}\n`)
    return { exitCode: 1 }
  }
  const shouldRun = (check: DoctorCheckName): boolean => filter === null || filter.has(check)

  stdout.write('\nSidekick Doctor\n')
  stdout.write('===============\n\n')

  // --- Fire all requested checks, report each as it completes ---
  // Node.js is single-threaded: each .then() callback runs to completion
  // before the next, so stdout.write calls never interleave mid-line.
  // Output order is non-deterministic but every line is self-labeled.

  const promises: Promise<unknown>[] = []

  // api-keys and statusline share runDoctorCheck(); run it if either is requested
  let doctorResult: DoctorCheckResultType | null = null
  if (shouldRun('api-keys') || shouldRun('statusline')) {
    promises.push(
      setupService.runDoctorCheck().then((result) => {
        doctorResult = result
        if (result.fixes.length > 0) {
          stdout.write('Cache corrections:\n')
          for (const fix of result.fixes) {
            stdout.write(`  ✓ ${fix}\n`)
          }
        }
        if (shouldRun('api-keys')) {
          const openRouterResult = result.apiKeys.OPENROUTER_API_KEY
          const openRouterHealth = openRouterResult.actual
          const apiKeyIcon = openRouterHealth === 'healthy' || openRouterHealth === 'not-required' ? '✓' : '⚠'
          const scopeBreakdown = formatApiKeyScopes(openRouterResult.scopes)
          const usedToSource: Record<string, ApiKeySource> = {
            project: 'project-env',
            user: 'user-env',
            env: 'env-var',
          }
          const sourceLabel = formatApiKeySource(
            openRouterResult.used ? (usedToSource[openRouterResult.used] ?? null) : null
          )
          stdout.write(`${apiKeyIcon} OpenRouter API Key: ${openRouterHealth}${sourceLabel} ${scopeBreakdown}\n`)
        }
        if (shouldRun('statusline')) {
          const statuslineIcon = result.statusline.actual !== 'none' ? '✓' : '⚠'
          stdout.write(`${statuslineIcon} Statusline: ${result.statusline.actual}\n`)
        }
        if (!result.userSetupExists) {
          const setupIcon = '⚠'
          stdout.write(`${setupIcon} User Setup: missing (~/.sidekick/setup-status.json not found)\n`)
        }
      })
    )
  }

  let gitignore: string | null = null
  if (shouldRun('gitignore')) {
    promises.push(
      detectGitignoreStatus(projectDir).then((result) => {
        gitignore = result
        const gitignoreIcon = result === 'installed' ? '✓' : '⚠'
        stdout.write(`${gitignoreIcon} Gitignore: ${result}\n`)
      })
    )
  }

  // Chain liveness off plugin detection — starts as soon as plugin check resolves,
  // without waiting for the potentially slow API key validation fetch.
  let pluginStatus: PluginInstallationStatus | null = null
  let liveness: PluginLivenessStatus | null = null
  if (shouldRun('plugin') || shouldRun('liveness') || shouldRun('auto-config')) {
    promises.push(
      setupService.detectPluginInstallation().then(async (status) => {
        pluginStatus = status
        if (shouldRun('plugin')) {
          const pluginIcon = getPluginStatusIcon(status)
          const pluginLabel = getPluginStatusLabel(status)
          stdout.write(`${pluginIcon} Plugin: ${pluginLabel}\n`)
        }

        const isPluginPresent = status === 'plugin' || status === 'dev-mode' || status === 'both'
        if (shouldRun('liveness') && isPluginPresent) {
          logger.info('Starting plugin liveness check')
          liveness = await setupService.detectPluginLiveness()
          const livenessIcon = getLivenessIcon(liveness)
          const livenessLabel = getLivenessLabel(liveness)
          stdout.write(`${livenessIcon} Plugin Liveness: ${livenessLabel}\n`)
          logger.info('Plugin liveness check reported', { status: liveness })
        }
      })
    )
  }

  // Zombie daemon check
  let zombieCount = 0
  if (shouldRun('zombies')) {
    promises.push(
      findZombieDaemons(logger).then((zombies) => {
        zombieCount = zombies.length
        const zombieIcon = zombies.length === 0 ? '✓' : '⚠'
        const label =
          zombies.length === 0
            ? 'none detected'
            : `${zombies.length} found (run 'sidekick daemon kill-zombies' or 'sidekick doctor --fix --only=zombies')`
        stdout.write(`${zombieIcon} Zombie Daemons: ${label}\n`)
      })
    )
  }

  await Promise.all(promises)

  // --- Auto-configure consistency check ---
  if (shouldRun('auto-config')) {
    const userStatus = await setupService.getUserStatus()
    if (userStatus?.preferences.autoConfigureProjects) {
      const isUserScoped = pluginStatus === 'plugin' || pluginStatus === 'both'
      if (!isUserScoped) {
        stdout.write('⚠ Auto-configure is enabled but plugin is not installed at user scope\n')
        stdout.write("  Auto-configure won't work in new projects. Run 'sidekick setup' with user-scoped plugin.\n")
      }
    }
  }

  // Shell alias check
  if (shouldRun('shell-alias')) {
    const shellInfo = detectShell(process.env.SHELL)
    if (!shellInfo) {
      stdout.write('• Shell Alias: unsupported shell (zsh/bash only)\n')
    } else {
      const rcPath = path.join(homeDir, shellInfo.rcFile)
      if (isAliasInRcFile(rcPath)) {
        stdout.write(`✓ Shell Alias: configured (~/${shellInfo.rcFile})\n`)
      } else {
        stdout.write("• Shell Alias: not configured (run 'sidekick setup --alias' to add)\n")
      }
    }
  }

  // --- Overall summary (only meaningful when running all checks) ---
  if (filter === null) {
    const isPluginOk = pluginStatus === 'plugin' || pluginStatus === 'dev-mode'
    const isPluginLive = liveness === null || liveness === 'active'
    // After Promise.all with filter===null, all checks have run and populated these variables.
    // TS can't track mutations inside .then() callbacks, so we assert non-null.
    const isHealthy =
      doctorResult!.overallHealth === 'healthy' &&
      gitignore === 'installed' &&
      isPluginOk &&
      isPluginLive &&
      zombieCount === 0
    const overallIcon = isHealthy ? '✓' : '⚠'
    stdout.write(`${overallIcon} Overall: ${isHealthy ? 'healthy' : 'needs attention'}\n`)

    if (!isHealthy && options?.fix) {
      return runDoctorFixes(projectDir, logger, stdout, {
        homeDir,
        filter: null,
        doctorResult: doctorResult!,
        gitignore: gitignore!,
        pluginStatus: pluginStatus!,
        liveness,
      })
    }

    if (!isHealthy) {
      stdout.write("\nRun 'sidekick doctor --fix' to auto-fix, or 'sidekick setup' to configure interactively.\n")
    }

    return { exitCode: isHealthy ? 0 : 1 }
  }

  // Filtered fix mode (--only + --fix)
  if (options?.fix) {
    return runDoctorFixes(projectDir, logger, stdout, {
      homeDir,
      filter,
      doctorResult,
      gitignore,
      pluginStatus,
      liveness,
    })
  }

  return { exitCode: 0 }
}

/**
 * Main setup command handler.
 */
export async function handleSetupCommand(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options: SetupCommandOptions = {}
): Promise<SetupCommandResult> {
  if (options.help) {
    stdout.write(USAGE_TEXT)
    return { exitCode: 0 }
  }
  if (options.checkOnly) {
    return runDoctor(projectDir, logger, stdout, { homeDir: options.homeDir, only: options.only, fix: options.fix })
  }
  // Detect dev-mode before dispatch (doctor mode is unaffected)
  const homeDir = options.homeDir ?? os.homedir()
  const setupService = new SetupStatusService(projectDir, { homeDir, logger })
  const isDevMode = await setupService.getDevMode()

  if (hasScriptingFlags(options)) {
    return runScripted(projectDir, logger, stdout, options, isDevMode)
  }
  return runWizard(projectDir, logger, stdout, options, isDevMode)
}
