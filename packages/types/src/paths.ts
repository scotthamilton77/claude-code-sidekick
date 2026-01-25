/**
 * Runtime Paths Type Definition
 *
 * Paths resolved during bootstrap for config and asset resolution.
 *
 * @see docs/design/CORE-RUNTIME.md §4.1 Runtime Context
 */

/**
 * Runtime paths resolved during bootstrap.
 */
export interface RuntimePaths {
  /** Project root directory (if in project context) */
  projectDir?: string
  /** User config directory (~/.sidekick) */
  userConfigDir: string
  /** Project config directory (.sidekick) */
  projectConfigDir?: string
}
