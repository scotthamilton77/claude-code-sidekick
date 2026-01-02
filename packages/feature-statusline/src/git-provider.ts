/**
 * GitProvider - Git branch detection with timeout protection
 *
 * Runs `git branch --show-current` with a short timeout to prevent
 * the statusline from hanging in slow/networked filesystems.
 *
 * @see docs/design/FEATURE-STATUSLINE.md §6.3 Git Integration
 */

import { spawn } from 'node:child_process'

/** Default timeout for git commands (ms) */
const DEFAULT_TIMEOUT_MS = 50

/**
 * Configuration for GitProvider.
 */
export interface GitProviderConfig {
  /** Working directory for git command */
  cwd: string
  /** Timeout in ms (default: 50ms) */
  timeoutMs?: number
}

/**
 * Result from git branch detection.
 */
export interface GitBranchResult {
  /** Branch name or empty string if not a git repo / timed out */
  branch: string
  /** Whether the result came from git or is a fallback */
  source: 'git' | 'timeout' | 'error'
}

/**
 * Provides git repository information with timeout protection.
 */
export class GitProvider {
  private readonly cwd: string
  private readonly timeoutMs: number

  constructor(config: GitProviderConfig) {
    this.cwd = config.cwd
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /**
   * Get the current git branch with timeout protection.
   * Returns empty string if not a git repo or if command times out.
   */
  async getCurrentBranch(): Promise<GitBranchResult> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve({ branch: '', source: 'timeout' })
      }, this.timeoutMs)

      const proc = spawn('git', ['branch', '--show-current'], {
        cwd: this.cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        // Don't wait for shell - direct execution
        shell: false,
      })

      let stdout = ''

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.on('close', (code) => {
        clearTimeout(timeoutId)
        if (code === 0) {
          resolve({ branch: stdout.trim(), source: 'git' })
        } else {
          resolve({ branch: '', source: 'error' })
        }
      })

      proc.on('error', () => {
        clearTimeout(timeoutId)
        resolve({ branch: '', source: 'error' })
      })
    })
  }
}

/**
 * Factory function to create GitProvider.
 */
export function createGitProvider(cwd: string, options?: { timeoutMs?: number }): GitProvider {
  return new GitProvider({
    cwd,
    timeoutMs: options?.timeoutMs,
  })
}
