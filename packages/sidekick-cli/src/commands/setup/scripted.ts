// packages/sidekick-cli/src/commands/setup/scripted.ts
/**
 * Scripted (non-interactive) setup mode.
 *
 * Extracted from setup/index.ts to isolate the scripted execution path,
 * which has zero shared local state with the interactive wizard. When
 * CLI scripting flags are provided (--statusline-scope, --gitignore, etc.),
 * this module handles each flag independently without prompting.
 *
 * @see setup/index.ts handleSetupCommand — entry point that delegates here
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import type { Logger } from '@sidekick/types'
import type { UserSetupStatus, ProjectSetupStatus } from '@sidekick/types'
import { SetupStatusService, installGitignoreSection, validateOpenRouterKey } from '@sidekick/core'
import { ensurePluginInstalled, detectInstalledScope } from './plugin-installer.js'
import { detectShell, installAlias, uninstallAlias } from './shell-alias.js'
import { serializeProfileYaml } from './user-profile-setup.js'
import {
  type SetupCommandOptions,
  type SetupCommandResult,
  statuslineSettingsPath,
  configureStatusline,
  writeApiKeyToEnv,
  writePersonaConfig,
} from './helpers.js'

// ============================================================================
// Scripting Flag Detection
// ============================================================================

/**
 * Check if any scripting flags are provided.
 */
export function hasScriptingFlags(options: SetupCommandOptions): boolean {
  return (
    options.marketplaceScope !== undefined ||
    options.pluginScope !== undefined ||
    options.statuslineScope !== undefined ||
    options.gitignore !== undefined ||
    options.personas !== undefined ||
    options.apiKeyScope !== undefined ||
    options.autoConfig !== undefined ||
    options.alias !== undefined ||
    options.userProfileName !== undefined ||
    options.userProfileRole !== undefined ||
    options.userProfileInterests !== undefined
  )
}

// ============================================================================
// Scripted Setup
// ============================================================================

/**
 * Run scripted (non-interactive) setup for specified options only.
 */
export async function runScripted(
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

  // 7. Configure user profile if any profile flags specified
  const hasProfileFlags = options.userProfileName || options.userProfileRole || options.userProfileInterests
  if (hasProfileFlags) {
    if (!options.userProfileName) {
      stdout.write('⚠ --user-profile-name is required when using user profile flags\n')
    } else if (!options.userProfileRole) {
      stdout.write('⚠ --user-profile-role is required when --user-profile-name is provided\n')
    } else {
      const profile = {
        name: options.userProfileName,
        role: options.userProfileRole,
        interests: options.userProfileInterests
          ? options.userProfileInterests
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      }
      const sidekickDir = path.join(homeDir, '.sidekick')
      await fs.mkdir(sidekickDir, { recursive: true })
      const filePath = path.join(sidekickDir, 'user.yaml')
      await fs.writeFile(filePath, serializeProfileYaml(profile), 'utf-8')
      stdout.write(`✓ User profile saved to ${filePath}\n`)
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
