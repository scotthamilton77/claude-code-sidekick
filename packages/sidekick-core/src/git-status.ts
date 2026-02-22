/**
 * Git status utility for detecting file changes
 *
 * Runs `git status --porcelain` with timeout protection.
 * Used by reminders feature to detect Bash-made file modifications.
 *
 * @see docs/plans/2026-02-16-bash-vc-detection-design.md
 */
import { spawn } from 'node:child_process'

/** Default timeout for git status command (ms) */
const DEFAULT_TIMEOUT_MS = 500

/**
 * Parse git status --porcelain output into file paths.
 *
 * Format: XY filename
 * - XY is a 2-char status code (e.g. ' M', '??', 'A ', 'D ', 'R ')
 * - For renames: XY old -> new (take new path)
 *
 * @param output - Raw output from `git status --porcelain`
 * @returns Array of file paths with changes
 */
export function parseGitStatusOutput(output: string): string[] {
  if (!output.trim()) return []

  return output
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      let filePart = line.slice(3)
      // Handle renames: "old.ts -> new.ts"
      const arrowIndex = filePart.indexOf(' -> ')
      if (arrowIndex !== -1) filePart = filePart.slice(arrowIndex + 4)
      // Strip quotes from paths with special characters
      if (filePart.startsWith('"') && filePart.endsWith('"')) {
        filePart = filePart.slice(1, -1)
      }
      return filePart
    })
}

/**
 * Get list of changed files from git status.
 *
 * Returns file paths from `git status --porcelain`.
 * Returns empty array on timeout, error, or if not a git repo.
 *
 * @param cwd - Working directory for git command
 * @param timeoutMs - Timeout in milliseconds (default: 500ms)
 * @returns Array of changed file paths, or empty array on failure
 */
export async function getGitFileStatus(cwd: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string[]> {
  return new Promise((resolve) => {
    let settled = false

    const proc = spawn('git', ['status', '--porcelain'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    const timeoutId = setTimeout(() => {
      settled = true
      proc.kill()
      resolve([])
    }, timeoutMs)

    let stdout = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.on('close', (code) => {
      clearTimeout(timeoutId)
      if (settled) return
      settled = true
      if (code === 0) {
        resolve(parseGitStatusOutput(stdout))
      } else {
        resolve([])
      }
    })

    proc.on('error', () => {
      clearTimeout(timeoutId)
      if (settled) return
      settled = true
      resolve([])
    })
  })
}
