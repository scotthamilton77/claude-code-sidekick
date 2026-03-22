import { exec } from 'node:child_process'

/** Cache TTL in milliseconds (30 seconds) */
export const GIT_BRANCH_TTL_MS = 30_000

interface CacheEntry {
  branch: string
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

/**
 * Get git branch for a project directory, with in-memory TTL caching.
 * Returns 'unknown' if git command fails.
 */
export function getGitBranch(projectDir: string): Promise<string> {
  const entry = cache.get(projectDir)
  if (entry && Date.now() < entry.expiresAt) {
    return Promise.resolve(entry.branch)
  }

  return new Promise((resolve) => {
    exec('git branch --show-current', { cwd: projectDir }, (err, stdout) => {
      const branch = err ? 'unknown' : stdout.trim()
      cache.set(projectDir, { branch, expiresAt: Date.now() + GIT_BRANCH_TTL_MS })
      resolve(branch)
    })
  })
}

/** Clear the git branch cache (for testing). */
export function clearGitBranchCache(): void {
  cache.clear()
}
