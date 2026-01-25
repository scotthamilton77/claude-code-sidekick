// packages/sidekick-cli/src/commands/setup/index.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import type { Logger } from '@sidekick/types'
import type { UserSetupStatus, ProjectSetupStatus, ApiKeyHealth } from '@sidekick/types'
import { SetupStatusService } from '@sidekick/core'
import { printHeader, printStatus, promptSelect, promptConfirm, promptInput, type PromptContext } from './prompts.js'
import { validateOpenRouterKey } from './validate-api-key.js'

export interface SetupCommandOptions {
  checkOnly?: boolean
  stdin?: NodeJS.ReadableStream
}

export interface SetupCommandResult {
  exitCode: number
  output?: string
}

const STATUSLINE_COMMAND = 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR'

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
 * Run the interactive setup wizard
 */
async function runWizard(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options: SetupCommandOptions
): Promise<SetupCommandResult> {
  const ctx: PromptContext = {
    stdin: options.stdin ?? process.stdin,
    stdout,
  }
  const homeDir = os.homedir()
  const setupService = new SetupStatusService(projectDir, { homeDir, logger })

  // Header
  stdout.write('\n┌─────────────────────────────────────────────────────────┐\n')
  stdout.write('│  Sidekick Setup Wizard                                  │\n')
  stdout.write('│                                                         │\n')
  stdout.write('│  This wizard configures sidekick for Claude Code.       │\n')
  stdout.write("│  Run 'sidekick setup' again anytime to reconfigure.     │\n")
  stdout.write('└─────────────────────────────────────────────────────────┘\n')

  // === Step 1: Statusline ===
  printHeader(ctx, 'Step 1: Statusline Configuration', 'Claude Code plugins cannot provide statusline config directly.')

  const statuslineScope = await promptSelect(ctx, 'Where should sidekick configure your statusline?', [
    { value: 'user', label: 'User-level (~/.claude/settings.json)', description: 'Works in all projects' },
    { value: 'project', label: 'Project-level (.claude/settings.local.json)', description: 'This project only' },
  ])

  // Configure statusline
  const statuslinePath =
    statuslineScope === 'user'
      ? path.join(homeDir, '.claude', 'settings.json')
      : path.join(projectDir, '.claude', 'settings.local.json')

  await configureStatusline(statuslinePath, logger)
  printStatus(ctx, 'success', `Statusline configured in ${statuslinePath}`)

  // === Step 2: Personas ===
  printHeader(
    ctx,
    'Step 2: Persona Features',
    'Sidekick includes AI personas (Marvin, GLaDOS, Skippy, etc.) that add\npersonality to your coding sessions with snarky messages and contextual nudges.'
  )

  stdout.write('These require an OpenRouter API key (small cost per message).\n\n')

  const wantPersonas = await promptConfirm(ctx, 'Enable persona features?', true)

  let apiKeyHealth: ApiKeyHealth = 'not-required'

  if (!wantPersonas) {
    // TODO: Write config to disable personas
    printStatus(ctx, 'info', 'Personas disabled')
  } else {
    // Check for existing key
    const existingKey = await findExistingApiKey('OPENROUTER_API_KEY', homeDir, projectDir)

    if (existingKey) {
      printStatus(ctx, 'success', 'OPENROUTER_API_KEY found')
      stdout.write('Validating... ')
      const result = await validateOpenRouterKey(existingKey, logger)
      if (result.valid) {
        stdout.write('valid!\n')
        apiKeyHealth = 'healthy'
      } else {
        stdout.write(`invalid (${result.error})\n`)
        apiKeyHealth = 'invalid'
      }
    } else {
      printStatus(ctx, 'warning', 'OPENROUTER_API_KEY not found')

      const configureNow = await promptConfirm(ctx, 'Configure API key now?', true)

      if (configureNow) {
        const keyScope = await promptSelect(ctx, 'Where should the API key be stored?', [
          { value: 'user', label: 'User-level (~/.sidekick/.env)', description: 'Works in all projects' },
          { value: 'project', label: 'Project-level (.sidekick/.env)', description: 'This project only' },
        ])

        const apiKey = await promptInput(ctx, 'Paste your OpenRouter API key')

        stdout.write('Validating... ')
        const result = await validateOpenRouterKey(apiKey, logger)
        const envPath =
          keyScope === 'user' ? path.join(homeDir, '.sidekick', '.env') : path.join(projectDir, '.sidekick', '.env')

        if (result.valid) {
          stdout.write('valid!\n')
          await writeApiKeyToEnv(envPath, 'OPENROUTER_API_KEY', apiKey)
          printStatus(ctx, 'success', `API key saved to ${envPath}`)
          apiKeyHealth = 'healthy'
        } else {
          stdout.write(`invalid (${result.error})\n`)
          printStatus(ctx, 'warning', 'API key validation failed, saving anyway')
          await writeApiKeyToEnv(envPath, 'OPENROUTER_API_KEY', apiKey)
          apiKeyHealth = 'invalid'
        }
      } else {
        stdout.write('\n')
        printStatus(
          ctx,
          'warning',
          'Persona features will show warnings in the statusline until an API key is configured.'
        )
        stdout.write("Run 'sidekick setup' again or ask Claude to help configure API keys using /sidekick-config.\n")
        apiKeyHealth = 'missing'
      }
    }
  }

  // === Step 3: Auto-configure ===
  printHeader(ctx, 'Step 3: Project Auto-Configuration')

  const autoConfig = await promptSelect(ctx, 'When sidekick runs in a new project for the first time:', [
    { value: 'auto', label: 'Auto-configure using my defaults', description: 'Recommended' },
    { value: 'ask', label: 'Ask me each time' },
    { value: 'manual', label: 'Do nothing', description: 'Manual setup only' },
  ])

  // === Write status files ===
  const userStatus: UserSetupStatus = {
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    preferences: {
      autoConfigureProjects: autoConfig === 'auto',
      defaultStatuslineScope: statuslineScope as 'user' | 'project',
      defaultApiKeyScope: wantPersonas ? 'user' : 'skip',
    },
    statusline: 'configured',
    apiKeys: {
      OPENROUTER_API_KEY: apiKeyHealth,
      OPENAI_API_KEY: 'not-required',
    },
  }

  await setupService.writeUserStatus(userStatus)

  // Write project status if using project scope
  if (statuslineScope === 'project') {
    const projectStatus: ProjectSetupStatus = {
      version: 1,
      lastUpdatedAt: new Date().toISOString(),
      autoConfigured: false,
      statusline: 'configured',
      apiKeys: {
        OPENROUTER_API_KEY: apiKeyHealth === 'healthy' ? 'user' : apiKeyHealth,
        OPENAI_API_KEY: 'not-required',
      },
    }
    await setupService.writeProjectStatus(projectStatus)
  }

  // === Summary ===
  printHeader(ctx, 'Step 4: Summary')
  printStatus(ctx, 'success', `Statusline: ${statuslineScope === 'user' ? 'User-level' : 'Project-level'}`)
  printStatus(ctx, wantPersonas ? 'success' : 'info', `Personas: ${wantPersonas ? 'Enabled' : 'Disabled'}`)

  const apiKeyStatusType = getApiKeyStatusType(apiKeyHealth)
  printStatus(ctx, apiKeyStatusType, `API Key: ${apiKeyHealth}`)
  printStatus(ctx, 'success', `Auto-configure: ${autoConfig === 'auto' ? 'Enabled' : 'Disabled'}`)

  stdout.write('\n')
  stdout.write('Restart Claude Code to see your statusline: claude --continue\n')

  return { exitCode: 0 }
}

/**
 * Run the doctor/check mode
 */
async function runDoctor(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream
): Promise<SetupCommandResult> {
  const homeDir = os.homedir()
  const setupService = new SetupStatusService(projectDir, { homeDir, logger })

  stdout.write('\nSidekick Doctor\n')
  stdout.write('===============\n\n')

  const statusline = await setupService.getStatuslineHealth()
  const apiKey = await setupService.getEffectiveApiKeyHealth('OPENROUTER_API_KEY')
  const isHealthy = await setupService.isHealthy()

  stdout.write(`Statusline: ${statusline}\n`)
  stdout.write(`OpenRouter API Key: ${apiKey}\n`)
  stdout.write(`Overall: ${isHealthy ? 'healthy' : 'needs attention'}\n`)

  if (!isHealthy) {
    stdout.write("\nRun 'sidekick setup' to configure.\n")
  }

  return { exitCode: isHealthy ? 0 : 1 }
}

/**
 * Main setup command handler
 */
export async function handleSetupCommand(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options: SetupCommandOptions = {}
): Promise<SetupCommandResult> {
  if (options.checkOnly) {
    return runDoctor(projectDir, logger, stdout)
  }
  return runWizard(projectDir, logger, stdout, options)
}
