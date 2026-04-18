/**
 * Claude CLI Spawn Utility
 *
 * Shared utility for spawning the Claude CLI with proper error handling,
 * timeout management, and retry logic. Used by both AnthropicCliProvider
 * (for LLM completions) and ContextMetricsService (for /context capture).
 *
 * @see docs/design/LLM-PROVIDERS.md
 */

import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { Logger } from '@sidekick/types'
import { AuthError, TimeoutError, ProviderError } from './errors'

// ============================================================================
// Types
// ============================================================================

export interface ClaudeCliSpawnOptions {
  /** Arguments to pass to the claude CLI */
  args: string[]
  /** Working directory for the CLI process */
  cwd?: string
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number
  /** Path to claude CLI (default: 'claude') */
  cliPath?: string
  /** Optional input to send to stdin */
  stdin?: string
  /** Logger instance */
  logger: Logger
  /** Provider ID for error context (default: 'claude-cli') */
  providerId?: string
}

export interface ClaudeCliSpawnResult {
  /** Standard output from the CLI */
  stdout: string
  /** Standard error from the CLI */
  stderr: string
  /** Exit code (0 on success) */
  exitCode: number
}

// ============================================================================
// Utility
// ============================================================================

/**
 * Spawn the Claude CLI with proper error handling and retry logic.
 *
 * @param options - Spawn configuration
 * @returns Promise resolving to stdout/stderr/exitCode
 * @throws ProviderError on failure after all retries
 */
export async function spawnClaudeCli(options: ClaudeCliSpawnOptions): Promise<ClaudeCliSpawnResult> {
  const {
    args,
    cwd = tmpdir(),
    timeout = 60000,
    maxRetries = 3,
    cliPath = 'claude',
    stdin,
    logger,
    providerId = 'claude-cli',
  } = options

  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await executeSpawn({
        args,
        cwd,
        timeout,
        cliPath,
        stdin,
        logger,
        providerId,
        attempt,
      })
      return result
    } catch (error) {
      lastError = error as Error

      // Don't retry auth errors or ENOENT (cli not found)
      if (error instanceof AuthError) {
        throw error
      }
      if (error instanceof ProviderError && error.message.includes('not found')) {
        throw error
      }

      logger.warn('Claude CLI spawn failed, retrying', {
        provider: providerId,
        attempt: attempt + 1,
        maxRetries,
        error: (error as Error).message,
      })

      // Wait before retry with exponential backoff
      if (attempt < maxRetries - 1) {
        await sleep(Math.min(1000 * Math.pow(2, attempt), 10000))
      }
    }
  }

  logger.error('Claude CLI spawn failed after all retries', {
    provider: providerId,
    maxRetries,
    error: lastError?.message,
  })

  throw new ProviderError(
    `Claude CLI failed after ${maxRetries} retries: ${lastError?.message}`,
    providerId,
    false,
    lastError
  )
}

// ============================================================================
// Internal Implementation
// ============================================================================

interface ExecuteSpawnOptions {
  args: string[]
  cwd: string
  timeout: number
  cliPath: string
  stdin?: string
  logger: Logger
  providerId: string
  attempt: number
}

function executeSpawn(options: ExecuteSpawnOptions): Promise<ClaudeCliSpawnResult> {
  const { args, cwd, timeout, cliPath, stdin, logger, providerId, attempt } = options

  return new Promise((resolve, reject) => {
    logger.debug('Spawning Claude CLI process', {
      provider: providerId,
      cliPath,
      args,
      cwd,
      timeout,
      attempt: attempt + 1,
      hasStdin: !!stdin,
    })

    const child = spawn(cliPath, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Recursion guard: Sidekick's own Claude Code hooks fire inside any
      // `claude -p` subprocess we spawn. Without this flag, the subprocess
      // hook handler would dispatch to the daemon, trigger another LLM call,
      // spawn another subprocess, and so on. handleHookCommand short-circuits
      // when SIDEKICK_SUBPROCESS=1 is set. See packages/sidekick-cli/src/commands/hook.ts.
      env: { ...process.env, SIDEKICK_SUBPROCESS: '1' },
    })

    let stdout = ''
    let stderr = ''
    let killed = false

    // Set up timeout
    const timeoutId = setTimeout(() => {
      killed = true
      child.kill('SIGTERM')
      logger.warn('Claude CLI process timed out', {
        provider: providerId,
        timeout,
      })
    }, timeout)

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('error', (error) => {
      clearTimeout(timeoutId)

      if (error.message.includes('ENOENT')) {
        reject(new ProviderError(`Claude CLI not found at path: ${cliPath}`, providerId, false, error))
      } else {
        reject(new ProviderError(`Spawn error: ${error.message}`, providerId, true, error))
      }
    })

    child.on('close', (code) => {
      clearTimeout(timeoutId)

      logger.debug('Claude CLI process exited', {
        provider: providerId,
        exitCode: code,
        killed,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
      })

      if (killed) {
        reject(new TimeoutError(providerId))
        return
      }

      if (code === 0) {
        resolve({ stdout, stderr, exitCode: 0 })
      } else if (code === 124) {
        // Standard timeout exit code
        reject(new TimeoutError(providerId))
      } else if (code === 401 || stderr.includes('authentication') || stderr.includes('unauthorized')) {
        reject(new AuthError(providerId, new Error(stderr)))
      } else {
        reject(
          new ProviderError(
            `CLI exited with code ${code}: ${stderr || 'no error output'}`,
            providerId,
            code ? code >= 500 : false
          )
        )
      }
    })

    // Send input to stdin if provided
    if (stdin) {
      child.stdin.write(stdin)
    }
    child.stdin.end()
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
