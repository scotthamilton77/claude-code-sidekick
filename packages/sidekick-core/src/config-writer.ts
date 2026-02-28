/**
 * Config Writer Module
 *
 * Provides programmatic read access to config values via dot-path notation.
 * Supports both cascade-resolved reads (full merge) and scope-specific reads
 * (user, project, local).
 *
 * This module will grow to include configSet, configUnset, and configList
 * in subsequent tasks.
 *
 * @see docs/design/CONFIG-SYSTEM.md
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import type { AssetResolver } from './assets'
import type { Logger } from '@sidekick/types'
import { type ConfigDomain, DOMAIN_FILES, loadConfig, tryReadYaml } from './config'

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
