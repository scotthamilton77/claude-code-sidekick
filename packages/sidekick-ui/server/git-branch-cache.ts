import { exec } from 'node:child_process'

/** Cache TTL in milliseconds (30 seconds) */
export const GIT_BRANCH_TTL_MS = 30_000

interface CacheEntry {
  branch: string
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<string>>()

/**
 * Get git branch for a project directory, with in-memory TTL caching.
 * Concurrent calls for the same projectDir coalesce into a single git spawn.
 * Returns 'unknown' if git command fails or HEAD is detached.
 */
export function getGitBranch(projectDir: string): Promise<string> {
  const entry = cache.get(projectDir)
  if (entry && Date.now() < entry.expiresAt) {
    return Promise.resolve(entry.branch)
  }

  const pending = inFlight.get(projectDir)
  if (pending) {
    return pending
  }

  let resolve: (value: string) => void
  const promise = new Promise<string>((r) => { resolve = r })
  inFlight.set(projectDir, promise)

  exec('git branch --show-current', { cwd: projectDir }, (err, stdout) => {
    const trimmed = err ? '' : stdout.trim()
    const branch = trimmed || 'unknown'
    cache.set(projectDir, { branch, expiresAt: Date.now() + GIT_BRANCH_TTL_MS })
    inFlight.delete(projectDir)
    resolve!(branch)
  })

  return promise
}

/** Clear the git branch cache (for testing). */
export function clearGitBranchCache(): void {
  cache.clear()
  inFlight.clear()
}
