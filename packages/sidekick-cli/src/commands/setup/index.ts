// packages/sidekick-cli/src/commands/setup/index.ts
/**
 * Setup command entry point and interactive wizard.
 *
 * This module is the main entry point for `sidekick setup` / `sidekick install`.
 * It delegates to specialized modules based on the execution path:
 *
 * - Doctor mode (--check, sidekick doctor): ./doctor.ts
 * - Scripted mode (--statusline-scope, --gitignore, etc.): ./scripted.ts
 * - Interactive wizard (default): this file
 *
 * @see ./doctor.ts — health checks and auto-fix
 * @see ./scripted.ts — non-interactive flag-driven setup
 * @see ./helpers.ts — shared display formatters and config writers
 */
import * as path from 'node:path'
import * as os from 'node:os'
import type { Logger } from '@sidekick/types'
import type { UserSetupStatus, ProjectSetupStatus, ApiKeyHealth, GitignoreStatus } from '@sidekick/types'
import {
  SetupStatusService,
  installGitignoreSection,
  detectGitignoreStatus,
  validateOpenRouterKey,
  type AllScopesDetectionResult,
} from '@sidekick/core'
import { printHeader, printStatus, promptSelect, promptConfirm, promptInput, type PromptContext } from './prompts.js'
import { ensurePluginInstalled, getValidPluginScopes, type InstallScope } from './plugin-installer.js'
import { runUserProfileStep } from './user-profile-setup.js'
import { detectShell, installAlias, isAliasInRcFile } from './shell-alias.js'
import { runDoctor } from './doctor.js'
import { hasScriptingFlags, runScripted } from './scripted.js'
import {
  statuslineSettingsPath,
  configureStatusline,
  writeApiKeyToEnv,
  writePersonaConfig,
  getApiKeyStatusType,
  formatApiKeyScopes,
} from './helpers.js'

export type { SetupCommandResult, SetupCommandOptions } from './helpers.js'
import type { SetupCommandOptions, SetupCommandResult } from './helpers.js'

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
  --user-profile-name=<name>    Set user profile name (creates ~/.sidekick/user.yaml)
  --user-profile-role=<role>    Set user profile role (e.g., "Software Architect")
  --user-profile-interests=<i>  Set user interests (comma-separated)

Examples:
  sidekick setup                              Interactive wizard
  sidekick setup --check                      Check current status
  sidekick doctor --only=liveness             Run only the liveness check
  sidekick doctor --only=plugin,liveness      Run plugin and liveness checks
  sidekick setup --statusline-scope=user      Configure statusline only
  sidekick setup --gitignore --personas       Configure gitignore and enable personas
  OPENROUTER_API_KEY=sk-xxx sidekick setup --personas --api-key-scope=user
  sidekick setup --user-profile-name="Scott" --user-profile-role="Software Architect" --user-profile-interests="Sci-Fi,hiking"
`

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
  let currentStatus: GitignoreStatus
  try {
    currentStatus = await detectGitignoreStatus(projectDir)
  } catch {
    // Unexpected fs error — treat as missing so the wizard can offer to install
    currentStatus = 'missing'
  }

  if (currentStatus === 'installed' || currentStatus === 'legacy') {
    if (!force) {
      const message =
        currentStatus === 'legacy'
          ? 'Sidekick entries already present in root .gitignore (legacy — run doctor --fix to migrate)'
          : 'Sidekick already configured (.sidekick/.gitignore)'
      printStatus(ctx, 'success', message)
    }
    return currentStatus
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
    stdout.write("Run 'sidekick setup' again or ask Claude to help configure API keys using /sidekick-setup.\n")
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
// Wizard Entry Point
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
  const _userProfile = force ? { configured: false } : await runUserProfileStep(wctx.ctx, homeDir)

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

// ============================================================================
// Main Entry Point
// ============================================================================

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
