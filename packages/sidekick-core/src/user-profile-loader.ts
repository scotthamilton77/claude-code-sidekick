/**
 * User Profile Loader
 *
 * Loads optional user profile from ~/.sidekick/user.yaml.
 * No cascade, no defaults — file either exists or it doesn't.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { UserProfileSchema, type UserProfile } from '@sidekick/types'
import type { Logger } from '@sidekick/types'

export interface LoadUserProfileOptions {
  /** Override home directory (for testing) */
  homeDir?: string
  /** Logger for warnings */
  logger?: Logger
}

/**
 * Load user profile from ~/.sidekick/user.yaml.
 * Returns null if file doesn't exist or is invalid.
 */
export function loadUserProfile(options?: LoadUserProfileOptions): UserProfile | null {
  const home = options?.homeDir ?? homedir()
  const filePath = join(home, '.sidekick', 'user.yaml')

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, 'utf-8')
    const parsed: unknown = parseYaml(content)
    const result = UserProfileSchema.safeParse(parsed)

    if (!result.success) {
      options?.logger?.warn('Invalid user profile, ignoring', {
        path: filePath,
        errors: result.error.issues.map((i) => i.message),
      })
      return null
    }

    return result.data
  } catch (err) {
    options?.logger?.warn('Failed to read user profile', {
      path: filePath,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
