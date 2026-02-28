/**
 * Config CLI Command
 *
 * Manages configuration with subcommands:
 *   - config get <path>         Read a config value by dot-path
 *   - config set <path> <value> Write a config value
 *   - config unset <path>       Remove a config override
 *   - config list               List all overrides at a scope
 *
 * All commands support --scope=user|project|local and --format=json.
 */

import type { Writable } from 'node:stream'
import type { Logger, AssetResolver, ConfigScope } from '@sidekick/core'
import { configGet, configSet, configUnset, configList } from '@sidekick/core'

export interface ConfigCommandOptions {
  format?: 'json' | 'text'
  scope?: ConfigScope
  assets?: AssetResolver
}

export interface ConfigCommandResult {
  exitCode: number
  output: string
}

// =============================================================================
// handleGet
// =============================================================================

function handleGet(
  args: (string | number)[],
  projectRoot: string,
  logger: Logger,
  stdout: Writable,
  options: ConfigCommandOptions
): ConfigCommandResult {
  const dotPath = args[0] as string | undefined

  if (!dotPath) {
    const error = 'Error: config get requires a dot-path argument'
    stdout.write(error + '\n')
    stdout.write('Usage: sidekick config get <path> [--scope=user|project|local]\n')
    return { exitCode: 1, output: error }
  }

  logger.debug('Config get', { dotPath, scope: options.scope })

  let result: ReturnType<typeof configGet>
  try {
    result = configGet(String(dotPath), {
      scope: options.scope,
      projectRoot,
      assets: options.assets,
      logger,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const error = `Error: ${message}`
    stdout.write(error + '\n')
    return { exitCode: 1, output: error }
  }

  if (result === undefined) {
    const error = `No value found for "${dotPath}"`
    stdout.write(error + '\n')
    return { exitCode: 1, output: error }
  }

  const { value } = result

  if (options.format === 'json') {
    const output = JSON.stringify(value, null, 2)
    stdout.write(output + '\n')
    return { exitCode: 0, output }
  }

  // Plain text: JSON-stringify objects/arrays, plain string for scalars
  if (value !== null && typeof value === 'object') {
    const output = JSON.stringify(value, null, 2)
    stdout.write(output + '\n')
    return { exitCode: 0, output }
  }

  const output = String(value)
  stdout.write(output + '\n')
  return { exitCode: 0, output }
}

// =============================================================================
// handleSet
// =============================================================================

function handleSet(
  args: (string | number)[],
  projectRoot: string,
  logger: Logger,
  stdout: Writable,
  options: ConfigCommandOptions
): ConfigCommandResult {
  const dotPath = args[0] as string | undefined
  const rawValue = args[1]

  if (!dotPath || rawValue === undefined) {
    const error = 'Error: config set requires a dot-path and a value'
    stdout.write(error + '\n')
    stdout.write('Usage: sidekick config set <path> <value> [--scope=user|project|local]\n')
    return { exitCode: 1, output: error }
  }

  logger.debug('Config set', { dotPath, rawValue, scope: options.scope })

  try {
    const result = configSet(String(dotPath), String(rawValue), {
      scope: options.scope,
      projectRoot,
      assets: options.assets,
      logger,
    })

    const output = `Set ${dotPath} = ${JSON.stringify(result.value)} (in ${result.filePath})`
    stdout.write(output + '\n')
    return { exitCode: 0, output }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const error = `Error: ${message}`
    stdout.write(error + '\n')
    return { exitCode: 1, output: error }
  }
}

// =============================================================================
// handleUnset
// =============================================================================

function handleUnset(
  args: (string | number)[],
  projectRoot: string,
  logger: Logger,
  stdout: Writable,
  options: ConfigCommandOptions
): ConfigCommandResult {
  const dotPath = args[0] as string | undefined

  if (!dotPath) {
    const error = 'Error: config unset requires a dot-path argument'
    stdout.write(error + '\n')
    stdout.write('Usage: sidekick config unset <path> [--scope=user|project|local]\n')
    return { exitCode: 1, output: error }
  }

  logger.debug('Config unset', { dotPath, scope: options.scope })

  try {
    const result = configUnset(String(dotPath), {
      scope: options.scope,
      projectRoot,
    })

    if (result.existed) {
      const output = `Unset ${dotPath} (from ${result.filePath})`
      stdout.write(output + '\n')
      return { exitCode: 0, output }
    }

    const output = `Key "${dotPath}" was not set`
    stdout.write(output + '\n')
    return { exitCode: 0, output }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const error = `Error: ${message}`
    stdout.write(error + '\n')
    return { exitCode: 1, output: error }
  }
}

// =============================================================================
// handleList
// =============================================================================

function handleList(
  projectRoot: string,
  logger: Logger,
  stdout: Writable,
  options: ConfigCommandOptions
): ConfigCommandResult {
  const scope = options.scope ?? 'project'

  logger.debug('Config list', { scope })

  try {
    const result = configList({
      scope,
      projectRoot,
    })

    if (result.entries.length === 0) {
      const output = `No overrides at ${scope} scope`
      stdout.write(output + '\n')
      return { exitCode: 0, output }
    }

    if (options.format === 'json') {
      const output = JSON.stringify(result.entries, null, 2)
      stdout.write(output + '\n')
      return { exitCode: 0, output }
    }

    // Plain text: one entry per line
    const lines = result.entries.map((e) => `${e.path} = ${JSON.stringify(e.value)}`)
    const output = lines.join('\n')
    stdout.write(output + '\n')
    return { exitCode: 0, output }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const error = `Error: ${message}`
    stdout.write(error + '\n')
    return { exitCode: 1, output: error }
  }
}

// =============================================================================
// showConfigHelp
// =============================================================================

function showConfigHelp(stdout: Writable): ConfigCommandResult {
  const helpText = `Usage: sidekick config <subcommand> [options]

Subcommands:
  get <path>                Read a config value by dot-path
  set <path> <value>        Write a config value to a scope file
  unset <path>              Remove a config override from a scope file
  list                      List all overrides at a scope

Options:
  --scope=<scope>           Scope: user, project (default), or local
  --format=<format>         Output format: text (default) or json

Dot-path format:
  <domain>.<key>[.<subkey>...]
  Domains: core, llm, transcript, features

Examples:
  sidekick config get core.logging.level
  sidekick config get core.logging.level --scope=user
  sidekick config set core.logging.level debug
  sidekick config set core.logging.level debug --scope=user
  sidekick config unset core.logging.level
  sidekick config list
  sidekick config list --scope=user
  sidekick config list --format=json
`
  stdout.write(helpText)
  return { exitCode: 0, output: '' }
}

// =============================================================================
// handleConfigCommand (main router)
// =============================================================================

/**
 * Handle the config CLI command with subcommands.
 *
 * Routes to appropriate handler based on subcommand.
 */
export function handleConfigCommand(
  subcommand: string | undefined,
  args: (string | number)[],
  projectRoot: string,
  logger: Logger,
  stdout: Writable,
  options: ConfigCommandOptions
): ConfigCommandResult {
  switch (subcommand) {
    case 'get':
      return handleGet(args, projectRoot, logger, stdout, options)

    case 'set':
      return handleSet(args, projectRoot, logger, stdout, options)

    case 'unset':
      return handleUnset(args, projectRoot, logger, stdout, options)

    case 'list':
      return handleList(projectRoot, logger, stdout, options)

    case 'help':
    case '--help':
    case '-h':
      return showConfigHelp(stdout)

    case undefined:
      stdout.write('Error: config command requires a subcommand\n\n')
      showConfigHelp(stdout)
      return { exitCode: 1, output: '' }

    default:
      stdout.write(`Error: Unknown config subcommand: ${subcommand}\n\n`)
      showConfigHelp(stdout)
      return { exitCode: 1, output: '' }
  }
}
