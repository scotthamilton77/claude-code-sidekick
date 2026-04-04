// packages/sidekick-core/src/plugin-detector.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import type { Logger } from '@sidekick/types'
import type { StatuslineStatus } from '@sidekick/types'
import { DOCTOR_TIMEOUTS, getDoctorTimeout } from './api-key-detector.js'
import { toErrorMessage } from './error-utils.js'

/**
 * Plugin installation status for doctor display.
 * - 'timeout': CLI check timed out (plugin may still be installed)
 * - 'error': CLI check failed unexpectedly
 */
export type PluginInstallationStatus = 'plugin' | 'dev-mode' | 'both' | 'none' | 'timeout' | 'error'

/**
 * Plugin liveness check result.
 * - 'active': Hooks responded with the safe word
 * - 'inactive': Hooks did not respond with safe word
 * - 'timeout': Claude command timed out before responding
 * - 'error': Claude command failed unexpectedly
 */
export type PluginLivenessStatus = 'active' | 'inactive' | 'timeout' | 'error'

/**
 * Claude Code settings.json structure (partial, for hook detection).
 */
interface ClaudeSettings {
  statusLine?: {
    type?: string
    command?: string
  }
  hooks?: Record<string, HookEntry[]>
}

interface HookEntry {
  matcher?: string
  hooks: Array<{
    type: string
    command: string
  }>
}

function isSidekickStatuslineCommand(command: string | undefined): boolean {
  return command?.toLowerCase().includes('sidekick') ?? false
}

function isDevModeCommand(command: string): boolean {
  return command.includes('dev-sidekick')
}

/**
 * Spawn a child process with a timeout, collecting stdout.
 * Resolves with { stdout, timedOut, exitCode } to avoid duplicating
 * the spawn+timeout+kill pattern across plugin detection methods.
 */
export function spawnWithTimeout(
  command: string,
  args: string[],
  options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
    logger?: Logger
  }
): Promise<{ stdout: string; stderr: string; timedOut: boolean; exitCode: number | null }> {
  return new Promise((resolve) => {
    let resolved = false
    let timedOut = false
    let killTimer: ReturnType<typeof setTimeout> | undefined

    const SIGKILL_GRACE_MS = 5000

    const safeResolve = (value: {
      stdout: string
      stderr: string
      timedOut: boolean
      exitCode: number | null
    }): void => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        clearTimeout(killTimer)
        resolve(value)
      }
    }

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    const timeout =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true
            options.logger?.warn(`Command timed out after ${options.timeoutMs! / 1000}s`, { command, args })
            child.kill('SIGTERM')

            // If child ignores SIGTERM, escalate to SIGKILL then force-resolve
            killTimer = setTimeout(() => {
              options.logger?.warn('Child ignored SIGTERM, sending SIGKILL', { command, args })
              child.kill('SIGKILL')

              // Force-resolve even if SIGKILL doesn't trigger 'close'
              safeResolve({ stdout, stderr, timedOut: true, exitCode: null })
            }, SIGKILL_GRACE_MS)
            killTimer.unref()
          }, options.timeoutMs)
        : undefined

    child.on('close', (code, signal) => {
      if (timedOut || signal === 'SIGTERM') {
        safeResolve({ stdout, stderr, timedOut: true, exitCode: code })
        return
      }
      safeResolve({ stdout, stderr, timedOut: false, exitCode: code })
    })

    child.on('error', (err) => {
      options.logger?.warn('Spawn error', { command, error: err.message })
      safeResolve({ stdout, stderr, timedOut: false, exitCode: -1 })
    })
  })
}

/**
 * Detect actual statusline configuration by reading Claude settings files.
 * Returns WHERE the statusline is configured, matching PluginInstallationStatus pattern.
 */
export async function detectActualStatusline(projectDir: string, homeDir: string): Promise<StatuslineStatus> {
  const userSettingsPath = path.join(homeDir, '.claude', 'settings.json')
  const projectSettingsPath = path.join(projectDir, '.claude', 'settings.local.json')

  let inUser = false
  let inProject = false

  // Check user-level settings
  try {
    const content = await fs.readFile(userSettingsPath, 'utf-8')
    const settings = JSON.parse(content) as Record<string, unknown>
    const statusLine = settings.statusLine as { command?: string } | undefined
    if (isSidekickStatuslineCommand(statusLine?.command)) {
      inUser = true
    }
  } catch {
    // File doesn't exist or is invalid
  }

  // Check project-level settings
  try {
    const content = await fs.readFile(projectSettingsPath, 'utf-8')
    const settings = JSON.parse(content) as Record<string, unknown>
    const statusLine = settings.statusLine as { command?: string } | undefined
    if (isSidekickStatuslineCommand(statusLine?.command)) {
      inProject = true
    }
  } catch {
    // File doesn't exist or is invalid
  }

  if (inUser && inProject) return 'both'
  if (inProject) return 'project'
  if (inUser) return 'user'
  return 'none'
}

/**
 * Detect plugin installation status.
 *
 * Uses `claude plugin list --json` to detect installed plugins,
 * and checks settings files for dev-mode hooks.
 *
 * @returns Installation status:
 *   - 'plugin': Sidekick plugin installed via Claude marketplace
 *   - 'dev-mode': Dev-mode hooks installed (dev-sidekick path)
 *   - 'both': Both plugin and dev-mode hooks (conflict state)
 *   - 'none': No sidekick hooks detected
 */
export async function detectPluginInstallation(
  projectDir: string,
  homeDir: string,
  logger?: Logger
): Promise<PluginInstallationStatus> {
  // Check for installed plugin via claude CLI
  const cliResult = await detectPluginFromCLI(projectDir, logger)

  // Check for dev-mode hooks in settings files
  const hasDevMode = await detectDevModeFromSettings(projectDir, homeDir)

  // If CLI timed out or errored, still report dev-mode if found, otherwise propagate the failure
  if (cliResult === 'timeout') return hasDevMode ? 'dev-mode' : 'timeout'
  if (cliResult === 'error') return hasDevMode ? 'dev-mode' : 'error'

  const hasPlugin = cliResult === 'found'
  if (hasPlugin && hasDevMode) return 'both'
  if (hasPlugin) return 'plugin'
  if (hasDevMode) return 'dev-mode'
  return 'none'
}

/**
 * Detect if sidekick plugin is installed via `claude plugin list --json`.
 * Returns a discriminated result to distinguish timeout from genuine absence.
 */
async function detectPluginFromCLI(
  projectDir: string,
  logger?: Logger
): Promise<'found' | 'not-found' | 'timeout' | 'error'> {
  logger?.info('Plugin detection started (claude plugin list --json)')

  const { stdout, timedOut, exitCode } = await spawnWithTimeout('claude', ['plugin', 'list', '--json'], {
    cwd: projectDir,
    timeoutMs: getDoctorTimeout(DOCTOR_TIMEOUTS.pluginDetection),
    logger,
  })

  if (timedOut) {
    logger?.info('Plugin detection completed', { result: 'timeout' })
    return 'timeout'
  }

  if (exitCode !== 0) {
    logger?.warn('claude plugin list failed', { code: exitCode })
    logger?.info('Plugin detection completed', { result: 'error' })
    return 'error'
  }

  try {
    const plugins = JSON.parse(stdout) as Array<{ id: string; scope?: string; enabled?: boolean }>
    const hasSidekick = plugins.some((p) => p.id.toLowerCase().includes('sidekick'))
    logger?.debug('Plugin detection parsed', { pluginCount: plugins.length, hasSidekick })
    const result = hasSidekick ? 'found' : 'not-found'
    logger?.info('Plugin detection completed', { result })
    return result
  } catch (err) {
    logger?.warn('Failed to parse plugin list JSON', {
      error: toErrorMessage(err),
    })
    logger?.info('Plugin detection completed', { result: 'error' })
    return 'error'
  }
}

/**
 * Detect if dev-mode hooks are installed by checking settings files.
 */
async function detectDevModeFromSettings(projectDir: string, homeDir: string): Promise<boolean> {
  const settingsPaths = [
    path.join(homeDir, '.claude', 'settings.json'),
    path.join(projectDir, '.claude', 'settings.local.json'),
  ]

  for (const settingsPath of settingsPaths) {
    try {
      const content = await fs.readFile(settingsPath, 'utf-8')
      const settings = JSON.parse(content) as ClaudeSettings
      if (hasDevModeHooks(settings)) {
        return true
      }
    } catch {
      // File doesn't exist or is invalid - continue checking
    }
  }

  return false
}

/**
 * Check a Claude settings object for dev-mode hooks.
 */
function hasDevModeHooks(settings: ClaudeSettings): boolean {
  // Check statusLine
  const statusLineCommand = settings.statusLine?.command
  if (statusLineCommand && isDevModeCommand(statusLineCommand)) {
    return true
  }

  // Check all hooks
  if (settings.hooks) {
    for (const hookEntries of Object.values(settings.hooks)) {
      if (!Array.isArray(hookEntries)) continue
      for (const entry of hookEntries) {
        if (!entry?.hooks) continue
        for (const hook of entry.hooks) {
          if (hook?.command && isDevModeCommand(hook.command)) {
            return true
          }
        }
      }
    }
  }

  return false
}

/**
 * Detect if sidekick hooks are actually responding by spawning Claude
 * with a safe word and checking if it appears in the response.
 *
 * This tests actual hook execution, not just config file presence.
 * Useful for detecting plugins loaded via --plugin-dir that don't
 * appear in settings.json.
 *
 * @returns 'active' if hooks respond, 'inactive' if not, 'timeout' on timeout, 'error' on failure
 */
export async function detectPluginLiveness(projectDir: string, logger?: Logger): Promise<PluginLivenessStatus> {
  // Generate a random safe word to avoid false positives
  const safeWord = crypto.randomUUID().slice(0, 8)

  const prompt =
    "From just your context, if you can, answer the following question. Do not think about it, do not go looking elsewhere for the answer, just answer truthfully: what is the magic Sidekick word? (If you don't know, just say so.)"

  logger?.info('Plugin liveness check started', { safeWord })

  const { stdout, stderr, timedOut, exitCode } = await spawnWithTimeout('claude', ['-p', prompt], {
    cwd: projectDir,
    env: { ...process.env, SIDEKICK_LIVENESS_CHECK: safeWord },
    timeoutMs: getDoctorTimeout(DOCTOR_TIMEOUTS.pluginLiveness),
    logger,
  })

  if (timedOut) {
    logger?.info('Plugin liveness check completed', { result: 'timeout' })
    return 'timeout'
  }

  if (exitCode !== 0) {
    logger?.warn('Plugin liveness check failed', { code: exitCode, stderr: stderr.slice(0, 200) })
    logger?.info('Plugin liveness check completed', { result: 'error' })
    return 'error'
  }

  const isActive = stdout.includes(safeWord)
  logger?.debug('Plugin liveness check response', {
    isActive,
    stdoutLength: stdout.length,
    response: stdout.slice(0, 500),
  })
  const result = isActive ? 'active' : 'inactive'
  logger?.info('Plugin liveness check completed', { result })
  return result
}
