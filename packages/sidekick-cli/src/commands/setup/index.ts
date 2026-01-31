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
  type PluginInstallationStatus,
  type PluginLivenessStatus,
} from '@sidekick/core'
import { printHeader, printStatus, promptSelect, promptConfirm, promptInput, type PromptContext } from './prompts.js'

export interface SetupCommandOptions {
  checkOnly?: boolean
  force?: boolean
  stdin?: NodeJS.ReadableStream
  help?: boolean
  // Scripting flags for non-interactive setup
  statuslineScope?: 'user' | 'project'
  gitignore?: boolean // true = install, false = skip, undefined = not specified
  personas?: boolean // true = enable, false = disable, undefined = not specified
  apiKeyScope?: 'user' | 'project' // where to save API key (reads from OPENROUTER_API_KEY env)
  autoConfig?: 'auto' | 'ask' | 'manual'
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
  --force                       Apply all defaults non-interactively
  --help                        Show this help message

Scripting Flags (for non-interactive/partial setup):
  --statusline-scope=<scope>    Configure statusline: user | project
  --gitignore                   Update .gitignore to exclude sidekick files
  --no-gitignore                Skip .gitignore configuration
  --personas                    Enable persona features
  --no-personas                 Disable persona features
  --api-key-scope=<scope>       Save API key from OPENROUTER_API_KEY env: user | project
  --auto-config=<mode>          Auto-configure preference: auto | ask | manual

Examples:
  sidekick setup                              Interactive wizard
  sidekick setup --check                      Check current status
  sidekick setup --statusline-scope=user      Configure statusline only
  sidekick setup --gitignore --personas       Configure gitignore and enable personas
  OPENROUTER_API_KEY=sk-xxx sidekick setup --personas --api-key-scope=user
`

const STATUSLINE_COMMAND = 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Map plugin installation status to human-readable label.
 */
function getPluginStatusLabel(status: 'plugin' | 'dev-mode' | 'both' | 'none'): string {
  switch (status) {
    case 'plugin':
      return 'installed'
    case 'dev-mode':
      return 'dev-mode (local)'
    case 'both':
      return 'conflict (both plugin and dev-mode detected!)'
    case 'none':
      return 'not installed'
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
    case 'error':
      return 'check failed'
  }
}

/**
 * Write statusline config to Claude Code settings.json
 */
async function configureStatusline(settingsPath: string, logger?: Logger): Promise<void> {
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

  settings.statusLine = {
    type: 'command',
    command: STATUSLINE_COMMAND,
  }

  const dir = path.dirname(settingsPath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')
  logger?.info('Statusline configured', { path: settingsPath })
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
 * Check if API key exists in environment or .env files
 */
async function findExistingApiKey(keyName: string, homeDir: string, projectDir: string): Promise<string | null> {
  // Check environment variable
  if (process.env[keyName]) {
    return process.env[keyName]
  }

  // Check .env files
  const envPaths = [
    path.join(homeDir, '.sidekick', '.env'),
    path.join(projectDir, '.sidekick', '.env'),
    path.join(projectDir, '.sidekick', '.env.local'),
  ]

  for (const envPath of envPaths) {
    try {
      const content = await fs.readFile(envPath, 'utf-8')
      const match = content.match(new RegExp(`^${keyName}=(.+)$`, 'm'))
      if (match) {
        return match[1]
      }
    } catch {
      // File doesn't exist
    }
  }

  return null
}

/**
 * Write persona enabled/disabled setting to sidekick features config.
 * Per CONFIG-SYSTEM.md, feature flags go in features.yaml (not config.yaml).
 */
async function writePersonaConfig(_projectDir: string, homeDir: string, enabled: boolean): Promise<void> {
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
  statuslineScope: 'user' | 'project'
  gitignoreStatus: GitignoreStatus
  wantPersonas: boolean
  apiKeyHealth: ApiKeyHealth
  autoConfig: 'auto' | 'ask' | 'manual'
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
 * Step 1: Configure statusline location.
 */
async function runStep1Statusline(wctx: WizardContext): Promise<'user' | 'project'> {
  const { ctx, homeDir, projectDir, logger } = wctx

  printHeader(ctx, 'Step 1: Statusline Configuration', 'Claude Code plugins cannot provide statusline config directly.')

  const statuslineScope = (await promptSelect(ctx, 'Where should sidekick configure your statusline?', [
    { value: 'user', label: 'User-level (~/.claude/settings.json)', description: 'Works in all projects' },
    { value: 'project', label: 'Project-level (.claude/settings.local.json)', description: 'This project only' },
  ])) as 'user' | 'project'

  // Configure statusline
  const statuslinePath =
    statuslineScope === 'user'
      ? path.join(homeDir, '.claude', 'settings.json')
      : path.join(projectDir, '.claude', 'settings.local.json')

  await configureStatusline(statuslinePath, logger)
  printStatus(ctx, 'success', `Statusline configured in ${statuslinePath}`)

  return statuslineScope
}

/**
 * Step 2: Configure .gitignore for sidekick files.
 */
async function runStep2Gitignore(wctx: WizardContext, force: boolean): Promise<GitignoreStatus> {
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
  printHeader(ctx, 'Step 2: Git Configuration', 'Sidekick creates logs and session data that should not be committed.')

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
  const message = needsRepair
    ? 'Repaired sidekick section in .gitignore'
    : result.status === 'already-installed'
      ? 'Sidekick entries already present in .gitignore'
      : 'Added sidekick section to .gitignore'
  printStatus(ctx, 'success', message)
  return 'installed'
}

/**
 * Step 3: Configure persona features and API key.
 */
async function runStep3Personas(wctx: WizardContext): Promise<{ wantPersonas: boolean; apiKeyHealth: ApiKeyHealth }> {
  const { ctx, homeDir, projectDir } = wctx
  const stdout = ctx.stdout

  printHeader(
    ctx,
    'Step 3: Persona Features',
    'Sidekick includes AI personas (Marvin, GLaDOS, Skippy, etc.) that add\npersonality to your coding sessions with snarky messages and contextual nudges.'
  )

  stdout.write('These require an OpenRouter API key (small cost per message).\n\n')

  const wantPersonas = await promptConfirm(ctx, 'Enable persona features?', true)
  let apiKeyHealth: ApiKeyHealth = 'not-required'

  if (!wantPersonas) {
    await writePersonaConfig(projectDir, homeDir, false)
    printStatus(ctx, 'info', 'Personas disabled')
  } else {
    await writePersonaConfig(projectDir, homeDir, true)
    apiKeyHealth = await configureApiKey(wctx)
  }

  return { wantPersonas, apiKeyHealth }
}

/**
 * Configure API key (sub-step of Step 3).
 */
async function configureApiKey(wctx: WizardContext): Promise<ApiKeyHealth> {
  const { ctx, homeDir, projectDir, logger } = wctx
  const stdout = ctx.stdout

  // Check for existing key
  const existingKey = await findExistingApiKey('OPENROUTER_API_KEY', homeDir, projectDir)

  if (existingKey) {
    printStatus(ctx, 'success', 'OPENROUTER_API_KEY found')
    stdout.write('Validating... ')
    const result = await validateOpenRouterKey(existingKey, logger)
    if (result.valid) {
      stdout.write('valid!\n')
      return 'healthy'
    } else {
      stdout.write(`invalid (${result.error})\n`)
      return 'invalid'
    }
  }

  // No existing key - prompt to configure
  printStatus(ctx, 'warning', 'OPENROUTER_API_KEY not found')
  const configureNow = await promptConfirm(ctx, 'Configure API key now?', true)

  if (!configureNow) {
    stdout.write('\n')
    printStatus(ctx, 'warning', 'Persona features will show warnings in the statusline until an API key is configured.')
    stdout.write("Run 'sidekick setup' again or ask Claude to help configure API keys using /sidekick-config.\n")
    return 'missing'
  }

  // User wants to configure key now
  const keyScope = (await promptSelect(ctx, 'Where should the API key be stored?', [
    { value: 'user', label: 'User-level (~/.sidekick/.env)', description: 'Works in all projects' },
    { value: 'project', label: 'Project-level (.sidekick/.env)', description: 'This project only' },
  ])) as 'user' | 'project'

  const apiKey = await promptInput(ctx, 'Paste your OpenRouter API key')

  stdout.write('Validating... ')
  const result = await validateOpenRouterKey(apiKey, logger)
  const envPath =
    keyScope === 'user' ? path.join(homeDir, '.sidekick', '.env') : path.join(projectDir, '.sidekick', '.env')

  if (result.valid) {
    stdout.write('valid!\n')
    await writeApiKeyToEnv(envPath, 'OPENROUTER_API_KEY', apiKey)
    printStatus(ctx, 'success', `API key saved to ${envPath}`)
    return 'healthy'
  } else {
    stdout.write(`invalid (${result.error})\n`)
    printStatus(ctx, 'warning', 'API key validation failed, saving anyway')
    await writeApiKeyToEnv(envPath, 'OPENROUTER_API_KEY', apiKey)
    return 'invalid'
  }
}

/**
 * Step 4: Configure auto-configuration preference.
 */
async function runStep4AutoConfig(wctx: WizardContext): Promise<'auto' | 'ask' | 'manual'> {
  const { ctx } = wctx

  printHeader(ctx, 'Step 4: Project Auto-Configuration')

  const autoConfig = (await promptSelect(ctx, 'When sidekick runs in a new project for the first time:', [
    { value: 'auto', label: 'Auto-configure using my defaults', description: 'Recommended' },
    { value: 'ask', label: 'Ask me each time' },
    { value: 'manual', label: 'Do nothing', description: 'Manual setup only' },
  ])) as 'auto' | 'ask' | 'manual'

  return autoConfig
}

/**
 * Write the status files based on wizard results.
 */
async function writeStatusFiles(wctx: WizardContext, state: WizardState): Promise<void> {
  const { setupService } = wctx
  const { statuslineScope, gitignoreStatus, wantPersonas, apiKeyHealth, autoConfig } = state

  const userStatus: UserSetupStatus = {
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    preferences: {
      autoConfigureProjects: autoConfig === 'auto',
      defaultStatuslineScope: statuslineScope,
      defaultApiKeyScope: wantPersonas ? 'user' : 'skip',
    },
    statusline: 'configured',
    apiKeys: {
      OPENROUTER_API_KEY: apiKeyHealth,
      OPENAI_API_KEY: 'not-required',
    },
  }

  await setupService.writeUserStatus(userStatus)

  // Always write project status now (we track gitignore at project level)
  const projectStatus: ProjectSetupStatus = {
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    autoConfigured: false,
    statusline: statuslineScope === 'project' ? 'configured' : 'user',
    apiKeys: {
      OPENROUTER_API_KEY: apiKeyHealth === 'healthy' ? 'user' : apiKeyHealth,
      OPENAI_API_KEY: 'not-required',
    },
    gitignore: gitignoreStatus,
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
  printStatus(ctx, 'success', `Statusline: ${statuslineScope === 'user' ? 'User-level' : 'Project-level'}`)
  const gitignoreStatusType =
    gitignoreStatus === 'installed' ? 'success' : gitignoreStatus === 'incomplete' ? 'warning' : 'info'
  const gitignoreLabel =
    gitignoreStatus === 'installed' ? 'Configured' : gitignoreStatus === 'incomplete' ? 'Incomplete' : 'Skipped'
  printStatus(ctx, gitignoreStatusType, `Gitignore: ${gitignoreLabel}`)
  printStatus(ctx, wantPersonas ? 'success' : 'info', `Personas: ${wantPersonas ? 'Enabled' : 'Disabled'}`)

  const apiKeyStatusType = getApiKeyStatusType(apiKeyHealth)
  printStatus(ctx, apiKeyStatusType, `API Key: ${apiKeyHealth}`)
  printStatus(ctx, 'success', `Auto-configure: ${autoConfig === 'auto' ? 'Enabled' : 'Disabled'}`)

  stdout.write('\n')
  stdout.write('Restart Claude Code to see your statusline: claude --continue\n')
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
  options: SetupCommandOptions
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

  const statuslineScope = force ? 'user' : await runStep1Statusline(wctx)
  const gitignoreStatus = await runStep2Gitignore(wctx, force)
  const { wantPersonas, apiKeyHealth } = force
    ? { wantPersonas: true, apiKeyHealth: 'not-required' as const }
    : await runStep3Personas(wctx)
  const autoConfig = force ? 'auto' : await runStep4AutoConfig(wctx)

  // In force mode, configure statusline with defaults
  if (force) {
    const statuslinePath = path.join(homeDir, '.claude', 'settings.json')
    await configureStatusline(statuslinePath, logger)
  }

  // Collect state and finalize
  const state: WizardState = { statuslineScope, gitignoreStatus, wantPersonas, apiKeyHealth, autoConfig }
  await writeStatusFiles(wctx, state)

  if (!force) {
    printSummary(wctx, state)
  } else {
    // Force mode: show brief summary of what was configured
    stdout.write('Setup complete (force mode):\n')
    stdout.write(`  Statusline: user-level (~/.claude/settings.json)\n`)
    stdout.write(`  Gitignore: ${gitignoreStatus === 'installed' ? 'configured' : 'skipped'}\n`)
    stdout.write(`  Personas: enabled (API key not configured)\n`)
    stdout.write(`  Auto-configure: enabled\n`)
  }

  return { exitCode: 0 }
}

/**
 * Check if any scripting flags are provided.
 */
function hasScriptingFlags(options: SetupCommandOptions): boolean {
  return (
    options.statuslineScope !== undefined ||
    options.gitignore !== undefined ||
    options.personas !== undefined ||
    options.apiKeyScope !== undefined ||
    options.autoConfig !== undefined
  )
}

/**
 * Run scripted (non-interactive) setup for specified options only.
 */
async function runScripted(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options: SetupCommandOptions
): Promise<SetupCommandResult> {
  const homeDir = options.homeDir ?? os.homedir()
  const setupService = new SetupStatusService(projectDir, { homeDir, logger })
  let configuredCount = 0

  // 1. Configure statusline if specified
  if (options.statuslineScope) {
    const statuslinePath =
      options.statuslineScope === 'user'
        ? path.join(homeDir, '.claude', 'settings.json')
        : path.join(projectDir, '.claude', 'settings.local.json')

    await configureStatusline(statuslinePath, logger)
    stdout.write(`✓ Statusline configured (${options.statuslineScope}-level)\n`)
    configuredCount++
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
    await writePersonaConfig(projectDir, homeDir, options.personas)
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
      statusline: 'skipped', // Default to skipped if no prior setup
      apiKeys: {
        OPENROUTER_API_KEY: 'not-required',
        OPENAI_API_KEY: 'not-required',
      },
    }

    userStatus.preferences.autoConfigureProjects = options.autoConfig === 'auto'
    userStatus.lastUpdatedAt = new Date().toISOString()
    await setupService.writeUserStatus(userStatus)
    stdout.write(`✓ Auto-config set to '${options.autoConfig}'\n`)
    configuredCount++
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
async function runDoctor(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  overrideHomeDir?: string
): Promise<SetupCommandResult> {
  const homeDir = overrideHomeDir ?? os.homedir()
  const setupService = new SetupStatusService(projectDir, { homeDir, logger })

  stdout.write('\nSidekick Doctor\n')
  stdout.write('===============\n\n')

  stdout.write('Checking configuration...\n\n')

  // Run the doctor check which compares actual state vs cache
  const doctorResult = await setupService.runDoctorCheck()

  // Also check gitignore (not part of the cache system)
  const gitignore = await detectGitignoreStatus(projectDir)

  // Check plugin installation status
  const pluginStatus = await setupService.detectPluginInstallation()

  // Report any fixes made
  if (doctorResult.fixes.length > 0) {
    stdout.write('Cache corrections:\n')
    for (const fix of doctorResult.fixes) {
      stdout.write(`  ✓ ${fix}\n`)
    }
    stdout.write('\n')
  }

  // Test plugin liveness (spawns Claude session)
  stdout.write('Checking live status of Sidekick... this may take a few moments.\n')
  const liveness = await setupService.detectPluginLiveness()

  // Display current state
  const pluginIcon = getPluginStatusIcon(pluginStatus)
  const pluginLabel = getPluginStatusLabel(pluginStatus)
  const livenessIcon = getLivenessIcon(liveness)
  const livenessLabel = getLivenessLabel(liveness)
  const statuslineIcon = doctorResult.statusline.actual === 'configured' ? '✓' : '⚠'
  const gitignoreIcon = gitignore === 'installed' ? '✓' : '⚠'
  const openRouterHealth = doctorResult.apiKeys.OPENROUTER_API_KEY.actual
  const apiKeyIcon = openRouterHealth === 'healthy' || openRouterHealth === 'not-required' ? '✓' : '⚠'

  stdout.write('\n')
  stdout.write(`${pluginIcon} Plugin: ${pluginLabel}\n`)
  stdout.write(`${livenessIcon} Plugin Liveness: ${livenessLabel}\n`)
  stdout.write(`${statuslineIcon} Statusline: ${doctorResult.statusline.actual}\n`)
  stdout.write(`${gitignoreIcon} Gitignore: ${gitignore}\n`)
  stdout.write(`${apiKeyIcon} OpenRouter API Key: ${openRouterHealth}\n`)

  const isPluginOk = pluginStatus === 'plugin' || pluginStatus === 'dev-mode'
  const isPluginLive = liveness === 'active'
  const isHealthy = doctorResult.overallHealth === 'healthy' && gitignore === 'installed' && isPluginOk && isPluginLive
  const overallIcon = isHealthy ? '✓' : '⚠'
  stdout.write(`${overallIcon} Overall: ${isHealthy ? 'healthy' : 'needs attention'}\n`)

  if (!isHealthy) {
    stdout.write("\nRun 'sidekick setup' to configure.\n")
  }

  return { exitCode: isHealthy ? 0 : 1 }
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
    return runDoctor(projectDir, logger, stdout, options.homeDir)
  }
  if (hasScriptingFlags(options)) {
    return runScripted(projectDir, logger, stdout, options)
  }
  return runWizard(projectDir, logger, stdout, options)
}
