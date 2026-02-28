/**
 * Config Writer Module
 *
 * Provides programmatic read/write access to config values via dot-path notation.
 * Supports both cascade-resolved reads (full merge) and scope-specific reads
 * (user, project, local), and comment-preserving YAML writes with validation.
 *
 * @see docs/design/CONFIG-SYSTEM.md
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import YAML from 'yaml'
import type { AssetResolver } from './assets'
import type { Logger } from '@sidekick/types'
import { coerceValue, type ConfigDomain, DOMAIN_FILES, EXTERNAL_DEFAULTS_FILES, loadConfig, tryReadYaml } from './config'

// =============================================================================
// Types
// =============================================================================

export type ConfigScope = 'user' | 'project' | 'local'

export interface ConfigGetOptions {
  scope?: ConfigScope
  projectRoot?: string
  homeDir?: string
  assets?: AssetResolver
  logger?: Logger
}

export interface ConfigGetResult {
  value: unknown
  domain: ConfigDomain
  path: string[]
}

export interface ConfigSetOptions {
  scope?: ConfigScope
  projectRoot?: string
  homeDir?: string
  assets?: AssetResolver
  logger?: Logger
}

export interface ConfigSetResult {
  domain: ConfigDomain
  path: string[]
  value: unknown
  filePath: string
}

export interface ParsedDotPath {
  domain: ConfigDomain
  keyPath: string[]
}

// =============================================================================
// Valid domains for path validation
// =============================================================================

const VALID_DOMAINS = new Set<string>(['core', 'llm', 'transcript', 'features'])

// =============================================================================
// parseDotPath
// =============================================================================

/**
 * Parse a dot-path string into domain and key path components.
 *
 * Examples:
 *   'core.logging.level'   -> { domain: 'core', keyPath: ['logging', 'level'] }
 *   'llm.defaultProfile'   -> { domain: 'llm', keyPath: ['defaultProfile'] }
 *   'core'                 -> { domain: 'core', keyPath: [] }
 *
 * @throws Error if the domain segment is not one of: core, llm, transcript, features
 */
export function parseDotPath(dotPath: string): ParsedDotPath {
  if (!dotPath || dotPath.trim() === '') {
    throw new Error('Config path must not be empty')
  }

  const segments = dotPath.split('.')
  const domainCandidate = segments[0]

  if (!VALID_DOMAINS.has(domainCandidate)) {
    throw new Error(
      `Unknown domain "${domainCandidate}". Valid domains: ${[...VALID_DOMAINS].join(', ')}`
    )
  }

  return {
    domain: domainCandidate as ConfigDomain,
    keyPath: segments.slice(1),
  }
}

// =============================================================================
// getNestedValue
// =============================================================================

/**
 * Navigate a nested object using a key path array.
 * Returns undefined if any intermediate key is missing or not an object.
 */
export function getNestedValue(obj: unknown, keyPath: string[]): unknown {
  if (keyPath.length === 0) {
    return obj
  }

  let current: unknown = obj
  for (const key of keyPath) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }

  return current
}

// =============================================================================
// getScopeFilePath
// =============================================================================

/**
 * Get the file path for a domain+scope combination.
 *
 * Scope file locations:
 *   user    -> ~/.sidekick/{domain-file}
 *   project -> {projectRoot}/.sidekick/{domain-file}
 *   local   -> {projectRoot}/.sidekick/{domain-file.replace('.yaml', '.local.yaml')}
 */
export function getScopeFilePath(
  domain: ConfigDomain,
  scope: ConfigScope,
  projectRoot: string | undefined,
  homeDir: string
): string | null {
  const filename = DOMAIN_FILES[domain]

  switch (scope) {
    case 'user':
      return join(homeDir, '.sidekick', filename)
    case 'project':
      if (!projectRoot) return null
      return join(projectRoot, '.sidekick', filename)
    case 'local':
      if (!projectRoot) return null
      return join(projectRoot, '.sidekick', filename.replace('.yaml', '.local.yaml'))
  }
}

// =============================================================================
// configGet
// =============================================================================

/**
 * Read a config value by dot-path.
 *
 * Without `scope` option: returns the cascade-resolved value (all layers merged).
 * With `scope` option: returns only the value from that specific scope file.
 *
 * Returns undefined if the path does not exist in the resolved config (or scope file).
 */
export function configGet(dotPath: string, options: ConfigGetOptions): ConfigGetResult | undefined {
  const { domain, keyPath } = parseDotPath(dotPath)
  const home = options.homeDir ?? homedir()

  if (options.scope) {
    // Scope-specific read: read only the raw YAML from that scope file
    const filePath = getScopeFilePath(domain, options.scope, options.projectRoot, home)
    if (!filePath) {
      return undefined
    }

    const raw = tryReadYaml(filePath)
    if (!raw || Object.keys(raw).length === 0) {
      return undefined
    }

    const value = getNestedValue(raw, keyPath)
    if (value === undefined) {
      return undefined
    }

    return { value, domain, path: keyPath }
  }

  // Cascade-resolved read: load full config and extract
  const config = loadConfig({
    projectRoot: options.projectRoot,
    homeDir: home,
    assets: options.assets,
    logger: options.logger,
  })

  // Get the domain-level object from the full config
  const domainConfig = config[domain]
  const value = getNestedValue(domainConfig, keyPath)

  if (value === undefined) {
    return undefined
  }

  return { value, domain, path: keyPath }
}

// =============================================================================
// configSet
// =============================================================================

/**
 * Set a config value by dot-path, writing to the appropriate scope file.
 *
 * Uses the `yaml` package's Document API to preserve YAML comments when
 * modifying existing files. When creating a new file, seeds from bundled
 * defaults (if available) to include helpful comments.
 *
 * Validates the change against the full cascade config via `loadConfig()`.
 * If validation fails, the original file is restored and an error is thrown.
 *
 * @throws Error if the dot-path points to an entire domain (empty keyPath)
 * @throws Error if the scope file path cannot be resolved (e.g., no projectRoot for project scope)
 * @throws Error if the new value fails cascade validation
 */
export function configSet(dotPath: string, rawValue: string, options: ConfigSetOptions = {}): ConfigSetResult {
  const { domain, keyPath } = parseDotPath(dotPath)

  if (keyPath.length === 0) {
    throw new Error('Cannot set an entire domain. Specify a key path (e.g., "core.logging.level")')
  }

  const home = options.homeDir ?? homedir()
  const scope = options.scope ?? 'project'
  const coercedValue = coerceValue(rawValue)

  // Resolve the target file path
  const filePath = getScopeFilePath(domain, scope, options.projectRoot, home)
  if (!filePath) {
    throw new Error(`Cannot resolve file path for domain "${domain}" at scope "${scope}". Is projectRoot set?`)
  }

  // Save original state for rollback on validation failure
  const fileExisted = existsSync(filePath)
  const originalContent = fileExisted ? readFileSync(filePath, 'utf8') : null

  // Build the YAML document (comment-preserving AST)
  let doc: YAML.Document
  if (fileExisted) {
    doc = YAML.parseDocument(originalContent!)
  } else {
    // Try to seed from bundled defaults
    doc = seedDocumentFromDefaults(domain, options.assets) ?? new YAML.Document({})
  }

  // Set the value in the document AST
  doc.setIn(keyPath, coercedValue)

  // Write the file
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(filePath, doc.toString(), 'utf8')

  // Validate: load the full cascade with the change applied
  try {
    loadConfig({
      projectRoot: options.projectRoot,
      homeDir: home,
      assets: options.assets,
      logger: options.logger,
    })
  } catch (err) {
    // Rollback: restore original file or delete if it didn't exist
    if (fileExisted) {
      writeFileSync(filePath, originalContent!, 'utf8')
    } else {
      try {
        unlinkSync(filePath)
      } catch {
        // Best effort cleanup
      }
    }

    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Configuration validation failed after setting "${dotPath}": ${message}`)
  }

  return {
    domain,
    path: keyPath,
    value: coercedValue,
    filePath,
  }
}

/**
 * Attempt to seed a YAML Document from bundled defaults.
 * Returns null if no defaults file is available.
 */
function seedDocumentFromDefaults(domain: ConfigDomain, assets?: AssetResolver): YAML.Document | null {
  if (!assets) return null

  const defaultsRelPath = EXTERNAL_DEFAULTS_FILES[domain]
  const defaultsAbsPath = assets.resolvePath(defaultsRelPath)
  if (!defaultsAbsPath || !existsSync(defaultsAbsPath)) return null

  const raw = readFileSync(defaultsAbsPath, 'utf8')
  return YAML.parseDocument(raw)
}
