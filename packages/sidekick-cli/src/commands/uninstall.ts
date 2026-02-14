// packages/sidekick-cli/src/commands/uninstall.ts
/**
 * Uninstall command handler.
 *
 * Reverses setup operations: removes plugin, kills daemons, surgically removes
 * sidekick entries from settings files, cleans up config/transient data, and
 * removes the gitignore section.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { Readable } from 'node:stream'
import type { Writable } from 'node:stream'
import type { Logger } from '@sidekick/types'
import { DaemonClient, removeGitignoreSection } from '@sidekick/core'

export interface UninstallCommandOptions {
  /** Skip confirmation prompts */
  force?: boolean
  /** Show what would be removed without acting */
  dryRun?: boolean
  /** Limit to specific scope */
  scope?: 'user' | 'project'
  /** Override user home for testing */
  userHome?: string
  /** Stdin for interactive prompts */
  stdin?: Readable
}

interface UninstallAction {
  scope: 'user' | 'project'
  artifact: string
  path: string
  action: 'removed' | 'skipped' | 'not-found' | 'kept' | 'would-remove'
}

export async function handleUninstallCommand(
  projectDir: string,
  logger: Logger,
  stdout: Writable,
  options: UninstallCommandOptions = {}
): Promise<{ exitCode: number; output: string }> {
  const { force = false, dryRun = false, scope, userHome = process.env.HOME || '', stdin = process.stdin } = options

  const actions: UninstallAction[] = []

  // Detect what's installed
  const projectDetected = scope !== 'user' && (await detectProjectScope(projectDir))
  const userDetected = scope !== 'project' && (await detectUserScope(userHome))

  if (!projectDetected && !userDetected) {
    stdout.write('No sidekick installation detected.\n')
    return { exitCode: 0, output: '' }
  }

  // Step 1: Detect and uninstall Claude Code plugin
  if (userDetected || projectDetected) {
    await uninstallPlugin(logger, stdout, actions, { force, dryRun })
  }

  // Step 2: Kill daemons (project scope)
  if (projectDetected) {
    await killDaemon(projectDir, logger, stdout, actions, { dryRun })
  }

  // Step 3: Settings.json surgery
  // Install supports three scopes: user (~/.claude/settings.json),
  // project (.claude/settings.json), and local (.claude/settings.local.json).
  // Clean all applicable files.
  if (projectDetected) {
    await cleanSettingsFile(path.join(projectDir, '.claude', 'settings.local.json'), 'project', logger, actions, {
      dryRun,
      removeHooks: true,
    })
    await cleanSettingsFile(path.join(projectDir, '.claude', 'settings.json'), 'project', logger, actions, {
      dryRun,
      removeHooks: true,
    })
  }
  if (userDetected) {
    await cleanSettingsFile(path.join(userHome, '.claude', 'settings.json'), 'user', logger, actions, {
      dryRun,
      removeHooks: false,
    })
  }

  // Step 4: Remove config files
  if (projectDetected) {
    await removeFile(path.join(projectDir, '.sidekick', 'setup-status.json'), 'project', 'setup-status.json', actions, {
      dryRun,
    })
  }
  if (userDetected) {
    await removeFile(path.join(userHome, '.sidekick', 'setup-status.json'), 'user', 'setup-status.json', actions, {
      dryRun,
    })
    await removeFile(path.join(userHome, '.sidekick', 'features.yaml'), 'user', 'features.yaml', actions, { dryRun })
  }

  // Step 5: Handle .env files
  if (projectDetected) {
    await handleEnvFile(path.join(projectDir, '.sidekick', '.env'), 'project', stdout, actions, {
      force,
      dryRun,
      stdin,
    })
  }
  if (userDetected) {
    await handleEnvFile(path.join(userHome, '.sidekick', '.env'), 'user', stdout, actions, { force, dryRun, stdin })
  }

  // Step 6: Remove transient data
  if (projectDetected) {
    await removeDir(path.join(projectDir, '.sidekick', 'logs'), 'project', 'logs/', actions, { dryRun })
    await removeDir(path.join(projectDir, '.sidekick', 'sessions'), 'project', 'sessions/', actions, { dryRun })
    await removeDir(path.join(projectDir, '.sidekick', 'state'), 'project', 'state/', actions, { dryRun })
    // Daemon files (pid, token, lock)
    await removeFile(path.join(projectDir, '.sidekick', 'sidekickd.pid'), 'project', 'sidekickd.pid', actions, {
      dryRun,
    })
    await removeFile(path.join(projectDir, '.sidekick', 'sidekickd.token'), 'project', 'sidekickd.token', actions, {
      dryRun,
    })
    await removeFile(path.join(projectDir, '.sidekick', 'sidekickd.lock'), 'project', 'sidekickd.lock', actions, {
      dryRun,
    })
  }
  if (userDetected) {
    await removeDir(path.join(userHome, '.sidekick', 'state'), 'user', 'state/', actions, { dryRun })
    await removeDir(path.join(userHome, '.sidekick', 'daemons'), 'user', 'daemons/', actions, { dryRun })
  }

  // Step 7: Clean gitignore
  if (projectDetected) {
    if (dryRun) {
      actions.push({
        scope: 'project',
        artifact: '.gitignore section',
        path: path.join(projectDir, '.gitignore'),
        action: 'would-remove',
      })
    } else {
      const removed = await removeGitignoreSection(projectDir)
      actions.push({
        scope: 'project',
        artifact: '.gitignore section',
        path: path.join(projectDir, '.gitignore'),
        action: removed ? 'removed' : 'not-found',
      })
    }
  }

  // Step 8: Report
  printReport(stdout, actions, dryRun)

  return { exitCode: 0, output: '' }
}

// --- Detection ---

async function detectProjectScope(projectDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(projectDir, '.sidekick', 'setup-status.json'))
    return true
  } catch {
    // Also check for sidekick entries in settings.local.json or settings.json
    for (const file of ['settings.local.json', 'settings.json']) {
      try {
        const content = await fs.readFile(path.join(projectDir, '.claude', file), 'utf-8')
        if (content.includes('sidekick')) return true
      } catch {
        // File doesn't exist, try next
      }
    }
    return false
  }
}

async function detectUserScope(userHome: string): Promise<boolean> {
  try {
    await fs.access(path.join(userHome, '.sidekick', 'setup-status.json'))
    return true
  } catch {
    // Also check for sidekick statusline in settings.json
    try {
      const content = await fs.readFile(path.join(userHome, '.claude', 'settings.json'), 'utf-8')
      return content.includes('sidekick')
    } catch {
      return false
    }
  }
}

// --- Plugin ---

async function uninstallPlugin(
  logger: Logger,
  stdout: Writable,
  actions: UninstallAction[],
  options: { force: boolean; dryRun: boolean }
): Promise<void> {
  try {
    const plugins = await execFileAsync('claude', ['plugin', 'list', '--json'])
    const pluginList = JSON.parse(plugins) as Array<{ id: string; scope: string }>
    const sidekickPlugin = pluginList.find((p) => p.id.startsWith('sidekick@'))

    if (!sidekickPlugin) {
      logger.debug('No sidekick plugin found in claude plugin list')
      return
    }

    if (options.dryRun) {
      actions.push({
        scope: sidekickPlugin.scope as 'user' | 'project',
        artifact: `Plugin (${sidekickPlugin.id})`,
        path: 'claude plugin',
        action: 'would-remove',
      })
      return
    }

    logger.info('Uninstalling sidekick plugin', { id: sidekickPlugin.id, scope: sidekickPlugin.scope })
    await execFileAsync('claude', ['plugin', 'uninstall', 'sidekick', '--scope', sidekickPlugin.scope])
    actions.push({
      scope: sidekickPlugin.scope as 'user' | 'project',
      artifact: `Plugin (${sidekickPlugin.id})`,
      path: 'claude plugin',
      action: 'removed',
    })
    stdout.write(`Plugin ${sidekickPlugin.id} uninstalled.\n`)
  } catch (err) {
    logger.warn('Could not detect/uninstall claude plugin (claude CLI may not be available)', {
      error: (err as Error).message,
    })
  }
}

function execFileAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (error, stdout) => {
      if (error) reject(error as Error)
      else resolve(stdout)
    })
  })
}

// --- Daemon ---

async function killDaemon(
  projectDir: string,
  logger: Logger,
  _stdout: Writable,
  actions: UninstallAction[],
  options: { dryRun: boolean }
): Promise<void> {
  if (options.dryRun) {
    actions.push({ scope: 'project', artifact: 'Daemon process', path: projectDir, action: 'would-remove' })
    return
  }

  try {
    const client = new DaemonClient(projectDir, logger)
    const result = await client.kill()
    logger.info('Daemon kill result', { result })
  } catch (err) {
    logger.debug('Daemon kill failed (may not be running)', { error: (err as Error).message })
  }
}

// --- Settings surgery ---

async function cleanSettingsFile(
  settingsPath: string,
  scope: 'user' | 'project',
  logger: Logger,
  actions: UninstallAction[],
  options: { dryRun: boolean; removeHooks: boolean }
): Promise<void> {
  let content: string
  try {
    content = await fs.readFile(settingsPath, 'utf-8')
  } catch {
    return // File doesn't exist, nothing to clean
  }

  let settings: Record<string, unknown>
  try {
    settings = JSON.parse(content) as Record<string, unknown>
  } catch {
    logger.warn('Could not parse settings file', { path: settingsPath })
    return
  }

  let modified = false

  // Remove sidekick statusline
  const statusLine = settings.statusLine as { command?: string } | undefined
  if (statusLine?.command?.includes('sidekick')) {
    if (options.dryRun) {
      actions.push({ scope, artifact: 'statusLine', path: settingsPath, action: 'would-remove' })
    } else {
      delete settings.statusLine
      modified = true
      actions.push({ scope, artifact: 'statusLine', path: settingsPath, action: 'removed' })
    }
  }

  // Remove sidekick hooks
  if (options.removeHooks && settings.hooks) {
    const hooks = settings.hooks as Record<string, unknown[]>
    let hooksModified = false

    for (const [eventName, eventHandlers] of Object.entries(hooks)) {
      if (!Array.isArray(eventHandlers)) continue

      const filtered = eventHandlers.filter((handler) => {
        const h = handler as { hooks?: Array<{ command?: string }> }
        if (!h.hooks?.length) return true
        // Keep if any hook command is NOT sidekick-related
        return h.hooks.some((hook) => !hook.command?.includes('sidekick') && !hook.command?.includes('dev-sidekick'))
      })

      if (filtered.length !== eventHandlers.length) {
        if (options.dryRun) {
          actions.push({ scope, artifact: `hooks.${eventName}`, path: settingsPath, action: 'would-remove' })
        } else {
          if (filtered.length === 0) {
            delete hooks[eventName]
          } else {
            hooks[eventName] = filtered
          }
          hooksModified = true
        }
      }
    }

    if (hooksModified) {
      // Remove empty hooks object
      if (Object.keys(hooks).length === 0) {
        delete settings.hooks
      }
      modified = true
      actions.push({ scope, artifact: 'hooks', path: settingsPath, action: 'removed' })
    }
  }

  if (modified && !options.dryRun) {
    // Check if settings is now empty
    if (Object.keys(settings).length === 0) {
      await fs.unlink(settingsPath)
      logger.info('Deleted empty settings file', { path: settingsPath })
    } else {
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')
      logger.info('Updated settings file', { path: settingsPath })
    }
  }
}

// --- File/directory removal ---

async function removeFile(
  filePath: string,
  scope: 'user' | 'project',
  artifact: string,
  actions: UninstallAction[],
  options: { dryRun: boolean }
): Promise<void> {
  try {
    await fs.access(filePath)
  } catch {
    return // File doesn't exist
  }

  if (options.dryRun) {
    actions.push({ scope, artifact, path: filePath, action: 'would-remove' })
    return
  }

  try {
    await fs.unlink(filePath)
    actions.push({ scope, artifact, path: filePath, action: 'removed' })
  } catch {
    actions.push({ scope, artifact, path: filePath, action: 'skipped' })
  }
}

async function removeDir(
  dirPath: string,
  scope: 'user' | 'project',
  artifact: string,
  actions: UninstallAction[],
  options: { dryRun: boolean }
): Promise<void> {
  try {
    await fs.access(dirPath)
  } catch {
    return // Dir doesn't exist
  }

  if (options.dryRun) {
    actions.push({ scope, artifact, path: dirPath, action: 'would-remove' })
    return
  }

  try {
    await fs.rm(dirPath, { recursive: true, force: true })
    actions.push({ scope, artifact, path: dirPath, action: 'removed' })
  } catch {
    actions.push({ scope, artifact, path: dirPath, action: 'skipped' })
  }
}

// --- .env handling ---

async function handleEnvFile(
  envPath: string,
  scope: 'user' | 'project',
  stdout: Writable,
  actions: UninstallAction[],
  options: { force: boolean; dryRun: boolean; stdin: Readable }
): Promise<void> {
  let content: string
  try {
    content = await fs.readFile(envPath, 'utf-8')
  } catch {
    return // No .env file
  }

  if (options.dryRun) {
    actions.push({ scope, artifact: '.env', path: envPath, action: 'would-remove' })
    return
  }

  // Show masked key names
  const keyNames = content
    .split('\n')
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => {
      const [key, val] = line.split('=', 2)
      const masked = val ? val.slice(0, 4) + '****' : '****'
      return `  ${key}=${masked}`
    })

  if (keyNames.length > 0 && !options.force) {
    stdout.write(`\n${scope} scope .env contains API keys:\n`)
    stdout.write(keyNames.join('\n') + '\n')
    const answer = await promptYesNo(`Remove ${scope} .env file?`, stdout, options.stdin)
    if (!answer) {
      actions.push({ scope, artifact: '.env', path: envPath, action: 'kept' })
      return
    }
  }

  await fs.unlink(envPath)
  actions.push({ scope, artifact: '.env', path: envPath, action: 'removed' })
}

function promptYesNo(question: string, stdout: Writable, stdin: Readable): Promise<boolean> {
  return new Promise((resolve) => {
    stdout.write(`${question} [y/N] `)
    let data = ''
    const onData = (chunk: Buffer): void => {
      data += chunk.toString()
      if (data.includes('\n')) {
        stdin.removeListener('data', onData)
        const answer = data.trim().toLowerCase()
        resolve(answer === 'y' || answer === 'yes')
      }
    }
    stdin.on('data', onData)
  })
}

// --- Report ---

function printReport(stdout: Writable, actions: UninstallAction[], dryRun: boolean): void {
  if (actions.length === 0) return

  const sortByArtifact = (a: UninstallAction, b: UninstallAction): number => a.artifact.localeCompare(b.artifact)

  if (dryRun) {
    stdout.write('\n[dry-run] Would perform the following actions:\n')
    printScopeGrouped(stdout, actions, (a) => a.artifact, sortByArtifact)
    return
  }

  const removed = actions.filter((a) => a.action === 'removed')
  const kept = actions.filter((a) => a.action === 'kept')
  const skipped = actions.filter((a) => a.action === 'skipped')

  if (removed.length > 0) {
    stdout.write('\nRemoved:\n')
    printScopeGrouped(stdout, removed, (a) => a.artifact, sortByArtifact)
  }

  if (kept.length > 0) {
    stdout.write('\nKept (by request):\n')
    printScopeGrouped(stdout, kept, (a) => a.artifact, sortByArtifact)
  }

  if (skipped.length > 0) {
    stdout.write('\nSkipped (errors):\n')
    printScopeGrouped(stdout, skipped, (a) => a.artifact, sortByArtifact)
  }

  stdout.write('\nSidekick uninstalled. Restart Claude Code to apply changes.\n')
}

/** Print actions grouped by scope (user first, then project), sorted within each group. */
function printScopeGrouped(
  stdout: Writable,
  actions: UninstallAction[],
  label: (a: UninstallAction) => string,
  sort: (a: UninstallAction, b: UninstallAction) => number
): void {
  const scopes: Array<'user' | 'project'> = ['user', 'project']
  for (const scope of scopes) {
    const group = actions.filter((a) => a.scope === scope).sort(sort)
    if (group.length === 0) continue
    stdout.write(`  ${scope}:\n`)
    for (const action of group) {
      stdout.write(`    ${label(action)}\n`)
    }
  }
}
