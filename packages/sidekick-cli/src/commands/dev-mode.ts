/**
 * Dev-Mode Command Handler
 *
 * Manages development hooks for local Sidekick testing.
 *
 * Commands:
 * - enable: Add dev-sidekick to .claude/settings.local.json
 * - disable: Remove dev-sidekick from settings.local.json
 * - status: Show current dev-mode state
 * - clean: Truncate logs, kill daemon, clean state folders
 * - clean-all: Full cleanup including sessions and stale sockets
 */
import { readFile, writeFile, mkdir, readdir, stat, unlink, rm, truncate, cp } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  Logger,
  DaemonClient,
  getSocketPath,
  getTokenPath,
  getLockPath,
  SetupStatusService,
  installGitignoreSection,
  removeGitignoreSection,
  findZombieDaemons,
  killZombieDaemons,
} from '@sidekick/core'
import { fileExists } from '../utils/fs.js'
import { promptConfirm } from '../utils/prompt.js'
import { readSettingsFile, writeSettingsFile } from '../utils/settings.js'

// ANSI colors for terminal output
const colors = {
  red: '\x1b[0;31m',
  green: '\x1b[0;32m',
  yellow: '\x1b[1;33m',
  blue: '\x1b[0;34m',
  reset: '\x1b[0m',
} as const

// Hook type names matching Claude Code's settings structure
const HOOK_TYPES = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'PreCompact',
] as const
type HookType = (typeof HOOK_TYPES)[number]

// All Claude Code hooks + statusline
const HOOK_SCRIPTS = [
  'session-start',
  'session-end',
  'user-prompt-submit',
  'pre-tool-use',
  'post-tool-use',
  'stop',
  'pre-compact',
  'statusline',
]

export interface DevModeCommandResult {
  exitCode: number
  output?: string
}

export interface DevModeOptions {
  /** Skip confirmation prompts for destructive operations */
  force?: boolean
  /** Input stream for prompts (defaults to process.stdin) */
  stdin?: NodeJS.ReadableStream
}

interface ClaudeSettings {
  [key: string]: unknown
  hooks?: Partial<Record<HookType, HookEntry[]>>
  statusLine?: {
    type: string
    command: string
  }
}

interface HookEntry {
  matcher?: string
  hooks: Array<{
    type: string
    command: string
  }>
}

/**
 * Copy all plugin skills from packages/sidekick-plugin/skills/ to .claude/skills/,
 * transforming for dev use. Replaces "npx @scotthamilton77/sidekick" with "pnpm sidekick" in SKILL.md.
 */
async function copySkillsForDev(projectDir: string, stdout: NodeJS.WritableStream): Promise<void> {
  const srcSkillsRoot = path.join(projectDir, 'packages', 'sidekick-plugin', 'skills')

  if (!(await fileExists(srcSkillsRoot))) {
    log(stdout, 'warn', `Plugin skills directory not found at ${srcSkillsRoot}, skipping skill copy`)
    return
  }

  const entries = await readdir(srcSkillsRoot, { withFileTypes: true })
  const skillDirs = entries.filter((e) => e.isDirectory())

  for (const skillDir of skillDirs) {
    const srcDir = path.join(srcSkillsRoot, skillDir.name)
    const destDir = path.join(projectDir, '.claude', 'skills', skillDir.name)

    await rm(destDir, { recursive: true, force: true })
    await cp(srcDir, destDir, { recursive: true })

    // Transform SKILL.md: npx @scotthamilton77/sidekick → pnpm sidekick
    const skillMdPath = path.join(destDir, 'SKILL.md')
    if (await fileExists(skillMdPath)) {
      const content = await readFile(skillMdPath, 'utf-8')
      const transformed = content.replace(/npx @scotthamilton77\/sidekick/g, 'pnpm sidekick')
      await writeFile(skillMdPath, transformed)
    }

    log(stdout, 'info', `Copied ${skillDir.name} skill to ${destDir}`)
  }
}

/**
 * Remove all dev-mode skills that were copied from the plugin.
 */
async function removeDevSkills(projectDir: string, stdout: NodeJS.WritableStream): Promise<void> {
  const srcSkillsRoot = path.join(projectDir, 'packages', 'sidekick-plugin', 'skills')

  if (!(await fileExists(srcSkillsRoot))) return

  const entries = await readdir(srcSkillsRoot, { withFileTypes: true })
  const skillDirs = entries.filter((e) => e.isDirectory())

  for (const skillDir of skillDirs) {
    const destDir = path.join(projectDir, '.claude', 'skills', skillDir.name)
    if (await fileExists(destDir)) {
      await rm(destDir, { recursive: true, force: true })
      log(stdout, 'info', `Removed ${skillDir.name} skill from ${destDir}`)
    }
  }
}

/** Output helper for colored log messages. */
function log(stdout: NodeJS.WritableStream, level: 'info' | 'step' | 'warn' | 'error', message: string): void {
  const prefixes = {
    info: `${colors.green}[INFO]${colors.reset}`,
    step: `${colors.blue}[STEP]${colors.reset}`,
    warn: `${colors.yellow}[WARN]${colors.reset}`,
    error: `${colors.red}[ERROR]${colors.reset}`,
  }
  stdout.write(`${prefixes[level]} ${message}\n`)
}

/** Check if a command string references dev-sidekick. */
function isDevHookCommand(command: string | undefined): boolean {
  return command?.includes('dev-sidekick') ?? false
}

/** Clean all files in a state directory. Returns number of files cleaned. */
async function cleanStateFolder(stateDir: string, label: string, stdout: NodeJS.WritableStream): Promise<number> {
  if (!(await fileExists(stateDir))) {
    log(stdout, 'info', `No ${label} state folder found`)
    return 0
  }

  try {
    const files = await readdir(stateDir)
    if (files.length === 0) {
      log(stdout, 'info', `${label} state folder is empty`)
      return 0
    }

    log(stdout, 'info', `Cleaning ${label} state folder (${files.length} files)...`)
    await Promise.all(files.map((file) => unlink(path.join(stateDir, file)).catch(() => {})))
    log(stdout, 'info', `${label} state cleaned`)
    return files.length
  } catch {
    log(stdout, 'info', `No ${label} state folder found`)
    return 0
  }
}

/** Remove a directory if it exists, logging the result. */
async function removeDirectory(dir: string, label: string, stdout: NodeJS.WritableStream): Promise<void> {
  if (await fileExists(dir)) {
    await rm(dir, { recursive: true, force: true })
    log(stdout, 'info', `Removed ${dir}`)
  } else {
    log(stdout, 'info', `No ${label} directory found`)
  }
}

/**
 * Check if any hook command contains "dev-sidekick".
 */
function isDevModeEnabled(settings: ClaudeSettings): boolean {
  // Check statusLine
  if (isDevHookCommand(settings.statusLine?.command)) {
    return true
  }

  // Check all hook entries
  const allEntries = Object.values(settings.hooks ?? {}).flat()
  return allEntries.some((entry) => entry?.hooks.some((h) => isDevHookCommand(h.command)))
}

/**
 * Create a backup of the settings file.
 */
async function backupSettings(settingsPath: string, stdout: NodeJS.WritableStream): Promise<void> {
  if (!(await fileExists(settingsPath))) return

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupPath = `${settingsPath}.backup.${timestamp}`
  const content = await readFile(settingsPath, 'utf-8')
  await writeFile(backupPath, content)
  log(stdout, 'info', `Backup created: ${backupPath}`)
}

/**
 * Enable dev-mode hooks.
 */
async function doEnable(projectDir: string, stdout: NodeJS.WritableStream): Promise<DevModeCommandResult> {
  log(stdout, 'step', 'Enabling dev-mode hooks...')

  const devHooksDir = path.join(projectDir, 'scripts', 'dev-sidekick')
  const settingsPath = path.join(projectDir, '.claude', 'settings.local.json')
  const cliBin = path.join(projectDir, 'packages', 'sidekick-cli', 'dist', 'bin.js')

  // Check prerequisites
  for (const hook of HOOK_SCRIPTS) {
    const hookPath = path.join(devHooksDir, hook)
    if (!(await fileExists(hookPath))) {
      log(stdout, 'error', `Dev hook script missing: ${hookPath}`)
      return { exitCode: 1 }
    }
  }

  // Check if CLI is built
  if (!(await fileExists(cliBin))) {
    log(stdout, 'warn', `CLI not built at ${cliBin}`)
    log(stdout, 'warn', "Run 'pnpm build' before using dev-mode hooks")
  }

  // Ensure .claude directory exists
  await mkdir(path.join(projectDir, '.claude'), { recursive: true })

  // Copy plugin skills to .claude/skills/, transforming for dev use
  await copySkillsForDev(projectDir, stdout)

  // Install gitignore entries for .sidekick/ tracking files
  const gitignoreResult = await installGitignoreSection(projectDir)
  if (gitignoreResult.status === 'installed') {
    log(stdout, 'info', 'Installed .gitignore entries for .sidekick/')
  } else if (gitignoreResult.status === 'already-installed') {
    log(stdout, 'info', '.gitignore entries already installed')
  } else {
    log(stdout, 'warn', `Failed to install .gitignore entries: ${gitignoreResult.error}`)
  }

  // Backup existing settings
  await backupSettings(settingsPath, stdout)

  // Read current settings
  const settings = await readSettingsFile<ClaudeSettings>(settingsPath)

  if (isDevModeEnabled(settings)) {
    log(stdout, 'warn', 'Dev-mode hooks already enabled')
    return { exitCode: 0 }
  }

  // Use $CLAUDE_PROJECT_DIR for Docker compatibility
  const devHooksPath = '$CLAUDE_PROJECT_DIR/scripts/dev-sidekick'

  // Initialize hooks object if missing
  settings.hooks ??= {}

  // Map of hook type to script name (most use kebab-case of the type name)
  const hookConfig: Array<{ type: HookType; script: string; matcher?: string }> = [
    { type: 'SessionStart', script: 'session-start' },
    { type: 'SessionEnd', script: 'session-end' },
    { type: 'UserPromptSubmit', script: 'user-prompt-submit' },
    { type: 'PreToolUse', script: 'pre-tool-use' },
    { type: 'PostToolUse', script: 'post-tool-use', matcher: '*' },
    { type: 'Stop', script: 'stop' },
    { type: 'PreCompact', script: 'pre-compact' },
  ]

  for (const { type, script, matcher } of hookConfig) {
    const command = `${devHooksPath}/${script}`
    const entries = settings.hooks[type] ?? []
    const exists = entries.some((e) => e.hooks[0]?.command === command)
    if (!exists) {
      const entry: HookEntry = { hooks: [{ type: 'command', command }] }
      if (matcher) entry.matcher = matcher
      entries.push(entry)
    }
    settings.hooks[type] = entries
  }

  // Set statusLine
  settings.statusLine = { type: 'command', command: `${devHooksPath}/statusline` }

  // Write updated settings
  await writeSettingsFile(settingsPath, settings)

  // Update devMode flag in project setup-status.json
  const setupService = new SetupStatusService(projectDir)
  await setupService.setDevMode(true)
  await setupService.updateProjectStatus({ statusline: 'local', gitignore: 'installed' })

  log(stdout, 'info', `Dev-mode hooks enabled in ${settingsPath}`)
  log(stdout, 'info', '')
  log(stdout, 'info', 'Registered hooks:')
  log(stdout, 'info', '  - SessionStart, SessionEnd, UserPromptSubmit')
  log(stdout, 'info', '  - PreToolUse, PostToolUse, Stop, PreCompact')
  log(stdout, 'info', '  - statusLine')
  log(stdout, 'info', '')
  log(stdout, 'info', 'Next steps:')
  log(stdout, 'info', '  1. Ensure CLI is built: pnpm build')
  log(stdout, 'info', '  2. Verify sidekick is active (check statusline or run: pnpm sidekick doctor)')

  return { exitCode: 0 }
}

/**
 * Disable dev-mode hooks.
 */
async function doDisable(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream
): Promise<DevModeCommandResult> {
  log(stdout, 'step', 'Disabling dev-mode hooks...')

  const settingsPath = path.join(projectDir, '.claude', 'settings.local.json')

  if (!(await fileExists(settingsPath))) {
    log(stdout, 'info', 'No settings.local.json found - nothing to disable')
    return { exitCode: 0 }
  }

  const settings = await readSettingsFile<ClaudeSettings>(settingsPath)

  if (!isDevModeEnabled(settings)) {
    log(stdout, 'info', 'Dev-mode hooks not currently enabled')
    return { exitCode: 0 }
  }

  await backupSettings(settingsPath, stdout)

  // Remove hooks containing "dev-sidekick" in command path
  if (settings.hooks) {
    for (const hookType of HOOK_TYPES) {
      const entries = settings.hooks[hookType]
      if (!entries) continue

      const filtered = entries.filter((entry) => !entry.hooks.some((h) => isDevHookCommand(h.command)))
      if (filtered.length === 0) {
        delete settings.hooks[hookType]
      } else {
        settings.hooks[hookType] = filtered
      }
    }

    // Remove hooks object if empty
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks
    }
  }

  // Remove statusLine if it points to dev-sidekick
  if (isDevHookCommand(settings.statusLine?.command)) {
    delete settings.statusLine
  }

  // Update devMode flag in project setup-status.json
  const setupService = new SetupStatusService(projectDir)
  await setupService.setDevMode(false)

  // Write or remove settings file based on remaining content
  const writeResult = await writeSettingsFile(settingsPath, settings)
  if (writeResult === 'deleted') {
    log(stdout, 'info', `Settings now empty, removed ${settingsPath}`)
  } else {
    log(stdout, 'info', `Dev-mode hooks removed from ${settingsPath}`)
  }

  // Remove plugin skills copied during enable
  await removeDevSkills(projectDir, stdout)

  // Conditionally remove gitignore entries
  const pluginInstalled = await setupService.isPluginInstalled()
  if (pluginInstalled) {
    log(stdout, 'info', 'Skipping .gitignore cleanup — plugin is still installed')
  } else {
    const removed = await removeGitignoreSection(projectDir)
    if (removed) {
      log(stdout, 'info', 'Removed .gitignore entries for .sidekick/')
    }
  }

  // Kill running daemon to avoid orphaned processes
  const daemonClient = new DaemonClient(projectDir, logger)
  const killResult = await daemonClient.kill()
  if (killResult.killed) {
    log(stdout, 'info', `Killed daemon (PID ${killResult.pid})`)
  }

  log(stdout, 'info', '')
  log(stdout, 'info', 'Dev-mode disabled.')

  return { exitCode: 0 }
}

/**
 * Show current dev-mode status.
 */
async function doStatus(projectDir: string, stdout: NodeJS.WritableStream): Promise<DevModeCommandResult> {
  const devHooksDir = path.join(projectDir, 'scripts', 'dev-sidekick')
  const settingsPath = path.join(projectDir, '.claude', 'settings.local.json')
  const cliBin = path.join(projectDir, 'packages', 'sidekick-cli', 'dist', 'bin.js')

  stdout.write('Dev-Mode Status\n')
  stdout.write('===============\n\n')

  if (!(await fileExists(settingsPath))) {
    stdout.write(`Settings file: ${settingsPath} (not found)\n`)
    stdout.write('Dev-mode: DISABLED\n')
  } else {
    stdout.write(`Settings file: ${settingsPath}\n`)
    const settings = await readSettingsFile<ClaudeSettings>(settingsPath)

    if (isDevModeEnabled(settings)) {
      stdout.write(`Dev-mode: ${colors.green}ENABLED${colors.reset}\n\n`)
      stdout.write('Registered dev-sidekick:\n')

      // List registered hooks
      if (settings.hooks) {
        for (const [hookType, entries] of Object.entries(settings.hooks)) {
          for (const entry of entries ?? []) {
            for (const hook of entry.hooks) {
              if (isDevHookCommand(hook.command)) {
                stdout.write(`  - ${hookType}: ${hook.command}\n`)
              }
            }
          }
        }
      }

      if (settings.statusLine && isDevHookCommand(settings.statusLine.command)) {
        stdout.write(`  - statusLine: ${settings.statusLine.command}\n`)
      }
    } else {
      stdout.write(`Dev-mode: ${colors.yellow}DISABLED${colors.reset}\n`)
    }
  }

  stdout.write('\n')

  // CLI build status
  const cliBuildStatus = (await fileExists(cliBin))
    ? `${colors.green}OK${colors.reset} (${cliBin})`
    : `${colors.red}MISSING${colors.reset} - run 'pnpm build'`
  stdout.write(`CLI build: ${cliBuildStatus}\n\n`)

  stdout.write(`Hook scripts in ${devHooksDir}:\n`)

  for (const hook of HOOK_SCRIPTS) {
    const hookPath = path.join(devHooksDir, hook)
    try {
      const stats = await stat(hookPath)
      const isExecutable = (stats.mode & constants.S_IXUSR) !== 0
      const status = isExecutable
        ? `${colors.green}+${colors.reset} ${hook}`
        : `${colors.red}-${colors.reset} ${hook} (not executable)`
      stdout.write(`  ${status}\n`)
    } catch {
      stdout.write(`  ${colors.red}-${colors.reset} ${hook} (missing)\n`)
    }
  }

  return { exitCode: 0 }
}

/**
 * Clean up logs, kill daemon, check for zombies.
 */
async function doClean(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options: DevModeOptions = {}
): Promise<DevModeCommandResult> {
  const { force = false, stdin = process.stdin } = options
  log(stdout, 'step', 'Cleaning up sidekick state...')

  const sidekickDir = path.join(projectDir, '.sidekick')
  const logsDir = path.join(sidekickDir, 'logs')

  // Kill project-local daemon if running
  const daemonClient = new DaemonClient(projectDir, logger)
  const killResult = await daemonClient.kill()
  if (killResult.killed) {
    log(stdout, 'info', `Killed daemon (PID ${killResult.pid})`)
  } else {
    log(stdout, 'info', 'No running daemon found for this project')
  }

  // Clean up daemon files
  const daemonFiles = [getSocketPath(projectDir), getTokenPath(projectDir), getLockPath(projectDir)]
  await Promise.all(daemonFiles.map((file) => unlink(file).catch(() => {})))

  // Truncate log files
  if (await fileExists(logsDir)) {
    log(stdout, 'info', `Cleaning log files in ${logsDir}...`)
    try {
      const files = await readdir(logsDir)
      for (const file of files) {
        if (file.endsWith('.log')) {
          await truncate(path.join(logsDir, file), 0)
          log(stdout, 'info', `  Truncated: ${file}`)
        }
      }
    } catch (err) {
      logger.debug('Failed to truncate logs', { error: err })
    }
  } else {
    log(stdout, 'info', 'No logs directory found')
  }

  // Clean state folders
  await cleanStateFolder(path.join(sidekickDir, 'state'), 'Project', stdout)
  await cleanStateFolder(path.join(os.homedir(), '.sidekick', 'state'), 'Global', stdout)

  // Check for zombie daemon processes using @sidekick/core
  stdout.write('\n')
  log(stdout, 'step', 'Checking for zombie daemon processes...')

  const zombies = await findZombieDaemons(logger)
  if (zombies.length === 0) {
    log(stdout, 'info', 'No zombie daemon processes found')
  } else {
    stdout.write('\n')
    stdout.write(`${colors.yellow}Found ${zombies.length} potential zombie daemon process(es):${colors.reset}\n`)
    for (const zombie of zombies) {
      stdout.write(`  - PID ${zombie.pid}: ${zombie.command}\n`)
    }
    stdout.write('\n')

    // Prompt for confirmation unless --force
    const shouldKill = force || (await promptConfirm({ stdin, stdout }, 'Kill these processes?'))

    if (shouldKill) {
      const results = await killZombieDaemons(logger, zombies)
      const killedCount = results.filter((r) => r.killed).length
      log(stdout, 'info', `Killed ${killedCount} zombie daemon(s)`)
    } else {
      log(stdout, 'info', 'Skipping zombie cleanup')
    }
  }

  stdout.write('\n')
  log(stdout, 'info', 'Clean complete.')

  return { exitCode: 0 }
}

/**
 * Full cleanup including sessions and stale sockets.
 */
async function doCleanAll(
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options: DevModeOptions = {}
): Promise<DevModeCommandResult> {
  const { force = false, stdin = process.stdin } = options

  // First run standard clean (pass options for zombie prompt)
  await doClean(projectDir, logger, stdout, options)

  const sidekickDir = path.join(projectDir, '.sidekick')

  stdout.write('\n')
  log(stdout, 'step', 'Removing logs, sessions, and state directories...')

  // Delete logs directory (no prompt needed - logs are transient)
  await removeDirectory(path.join(sidekickDir, 'logs'), 'logs', stdout)

  // Sessions directory needs special handling - prompt for confirmation
  const sessionsDir = path.join(sidekickDir, 'sessions')
  if (await fileExists(sessionsDir)) {
    try {
      const sessions = await readdir(sessionsDir)
      const sessionCount = sessions.filter((s) => !s.startsWith('.')).length

      if (sessionCount > 0) {
        log(stdout, 'info', `Found ${sessionCount} session directories`)

        // Prompt for confirmation unless --force
        const shouldRemove = force || (await promptConfirm({ stdin, stdout }, 'Remove all session directories?'))

        if (shouldRemove) {
          await rm(sessionsDir, { recursive: true, force: true })
          log(stdout, 'info', `Removed ${sessionsDir}`)
        } else {
          log(stdout, 'info', 'Skipping session cleanup')
        }
      } else {
        // Empty directory, just remove it
        await rm(sessionsDir, { recursive: true, force: true })
        log(stdout, 'info', `Removed empty ${sessionsDir}`)
      }
    } catch {
      log(stdout, 'info', 'No sessions directory found')
    }
  } else {
    log(stdout, 'info', 'No sessions directory found')
  }

  await removeDirectory(path.join(sidekickDir, 'state'), 'state', stdout)

  // Remove setup-status.json (created by dev-mode enable)
  const setupStatusPath = path.join(sidekickDir, 'setup-status.json')
  if (await fileExists(setupStatusPath)) {
    await unlink(setupStatusPath)
    log(stdout, 'info', `Removed ${setupStatusPath}`)
  }

  // Clean stale sockets in /tmp
  const tmpDir = os.tmpdir()
  try {
    const files = await readdir(tmpDir)
    const sockets = files.filter((f) => f.startsWith('sidekick-') && f.endsWith('.sock'))
    if (sockets.length > 0) {
      log(stdout, 'info', `Found ${sockets.length} stale socket(s) in ${tmpDir}`)
      await Promise.all(sockets.map((socket) => unlink(path.join(tmpDir, socket)).catch(() => {})))
      log(stdout, 'info', 'Stale sockets removed')
    }
  } catch {
    // tmpdir read failed, skip
  }

  stdout.write('\n')
  log(stdout, 'info', 'Full clean complete.')

  return { exitCode: 0 }
}

const USAGE_TEXT = `Usage: sidekick dev-mode <command> [options]

Commands:
  enable     Add dev-sidekick to .claude/settings.local.json
  disable    Remove dev-sidekick from settings.local.json
  status     Show current dev-mode state
  clean      Truncate logs, kill daemon, clean state folders
  clean-all  Full cleanup: clean + remove logs/sessions/state dirs

Options:
  --force    Skip confirmation prompts for destructive operations
`

/**
 * Main command handler.
 */
export async function handleDevModeCommand(
  subcommand: string,
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options: DevModeOptions = {}
): Promise<DevModeCommandResult> {
  switch (subcommand) {
    case 'enable':
      return doEnable(projectDir, stdout)
    case 'disable':
      return doDisable(projectDir, logger, stdout)
    case 'status':
      return doStatus(projectDir, stdout)
    case 'clean':
      return doClean(projectDir, logger, stdout, options)
    case 'clean-all':
      return doCleanAll(projectDir, logger, stdout, options)
    case 'help':
    case '--help':
    case '-h':
      stdout.write(USAGE_TEXT)
      return { exitCode: 0 }
    default:
      stdout.write(`Unknown dev-mode subcommand: ${subcommand}\n\n${USAGE_TEXT}`)
      return { exitCode: 1 }
  }
}
