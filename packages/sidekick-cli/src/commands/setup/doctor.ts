// packages/sidekick-cli/src/commands/setup/doctor.ts
/**
 * Doctor (health check) module for sidekick setup.
 *
 * Extracted from setup/index.ts to isolate the doctor execution path,
 * which is a completely separate concern from the interactive wizard
 * and scripted setup modes.
 *
 * @see setup/index.ts handleSetupCommand — entry point that delegates here
 */
import * as path from 'node:path'
import * as os from 'node:os'
import type { Logger } from '@sidekick/types'
import type { UserSetupStatus } from '@sidekick/types'
import {
  SetupStatusService,
  installGitignoreSection,
  detectGitignoreStatus,
  detectLegacyGitignoreSection,
  removeLegacyGitignoreSection,
  findZombieDaemons,
  killZombieDaemons,
  USER_STATUS_FILENAME,
  type ApiKeySource,
  type PluginInstallationStatus,
  toErrorMessage,
  type PluginLivenessStatus,
} from '@sidekick/core'
import { ensurePluginInstalled } from './plugin-installer.js'
import { detectShell, installAlias, isAliasInRcFile } from './shell-alias.js'
import {
  type SetupCommandResult,
  statuslineSettingsPath,
  configureStatusline,
  formatApiKeyScopes,
  formatApiKeySource,
  getPluginStatusIcon,
  getPluginStatusLabel,
  getLivenessIcon,
  getLivenessLabel,
  isPluginPresent,
} from './helpers.js'

// ============================================================================
// Doctor Check Types & Constants
// ============================================================================

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
export type DoctorCheckName = (typeof DOCTOR_CHECK_NAMES)[number]

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

// ============================================================================
// Doctor Fixes
// ============================================================================

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
    stdout.write(`  ✓ Created ~/.sidekick/${USER_STATUS_FILENAME} with defaults\n`)
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

  // Fix: Missing/incomplete/legacy gitignore
  if (shouldFix('gitignore') && gitignore !== null) {
    if (gitignore === 'legacy') {
      stdout.write('Fixing: Gitignore (migrating legacy format)\n')
      const result = await installGitignoreSection(projectDir)
      if (result.status === 'error') {
        stdout.write(`  ⚠ Failed to create .sidekick/.gitignore: ${result.error}\n`)
      } else {
        await removeLegacyGitignoreSection(projectDir)
        stdout.write('  ✓ Migrated to .sidekick/.gitignore and removed legacy root section\n')
        fixedCount++
      }
    } else if (gitignore === 'installed') {
      const hasLegacy = await detectLegacyGitignoreSection(projectDir)
      if (hasLegacy) {
        stdout.write('Fixing: Gitignore (removing redundant legacy section)\n')
        await removeLegacyGitignoreSection(projectDir)
        stdout.write('  ✓ Removed legacy section from root .gitignore\n')
        fixedCount++
      }
    } else {
      // 'missing' or 'incomplete'
      stdout.write('Fixing: Gitignore\n')
      const result = await installGitignoreSection(projectDir)
      if (result.status === 'error') {
        stdout.write(`  ⚠ Failed to update .sidekick/.gitignore: ${result.error}\n`)
      } else {
        stdout.write('  ✓ Gitignore configured\n')
        fixedCount++
      }
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
      stdout.write(`  ⚠ Plugin installation failed: ${toErrorMessage(err)}\n`)
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
        "Plugin Liveness: Hooks not responding. Try running '/sidekick-setup' in Claude Code or 'sidekick setup' from the terminal."
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

// ============================================================================
// Doctor Main
// ============================================================================

/**
 * Run the doctor/check mode.
 * Now checks actual config state against cache and updates cache if mismatched.
 */
export async function runDoctor(
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
    stdout.write(`${toErrorMessage(err)}\n`)
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
          stdout.write(`${setupIcon} User Setup: missing (~/.sidekick/${USER_STATUS_FILENAME} not found)\n`)
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
        const gitignoreMessage =
          result === 'legacy'
            ? `legacy section found in root .gitignore — run sidekick doctor --fix --only=gitignore to migrate`
            : result
        stdout.write(`${gitignoreIcon} Gitignore: ${gitignoreMessage}\n`)
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

        if (shouldRun('liveness') && isPluginPresent(status)) {
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
    const isPluginOk = isPluginPresent(pluginStatus!)
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
