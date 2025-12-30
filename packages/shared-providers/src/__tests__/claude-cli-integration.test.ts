/**
 * Integration Tests for Claude CLI /context Capture
 *
 * These tests actually invoke the Claude CLI to verify:
 * 1. CLI can be spawned successfully
 * 2. Transcript files are created in expected locations
 * 3. /context output can be captured from transcripts
 *
 * IMPORTANT: These tests are EXCLUDED from default test runs because they:
 * - Require the Claude CLI to be installed and authenticated
 * - Make actual API calls (expensive)
 * - Create files on disk
 *
 * Run manually with: INTEGRATION_TESTS=1 npx vitest run packages/shared-providers/src/__tests__/claude-cli-integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnClaudeCli } from '../claude-cli-spawn.js'
import { createLogManager } from '@sidekick/core'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// Skip tests unless INTEGRATION_TESTS env var is set
const shouldRun = process.env.INTEGRATION_TESTS === '1'
const describeIntegration = shouldRun ? describe : describe.skip

describeIntegration('claude-cli /context integration', () => {
  const logger = createLogManager({
    destinations: { console: { enabled: false } },
  }).getLogger()

  let testSessionId: string
  let testCwd: string
  let expectedTranscriptPath: string

  beforeAll(async () => {
    testSessionId = randomUUID()
    testCwd = '/tmp/sidekick/cli-integration-test'

    // Create test directory
    await fs.mkdir(testCwd, { recursive: true })

    // Compute expected transcript path
    // Claude uses /-encoded paths: /private/tmp/foo → -private-tmp-foo
    // Note: macOS resolves /tmp to /private/tmp
    const resolvedCwd = await fs.realpath(testCwd)
    const encodedPath = resolvedCwd.replace(/\//g, '-').replace(/^-/, '-')
    expectedTranscriptPath = path.join(homedir(), '.claude', 'projects', encodedPath, `${testSessionId}.jsonl`)
  })

  afterAll(async () => {
    // Cleanup test directory
    try {
      await fs.rm(testCwd, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }

    // Note: We don't clean up the transcript file to allow debugging
  })

  it('spawns claude CLI and creates transcript file', async () => {
    // Run claude with /context command
    const result = await spawnClaudeCli({
      args: ['--session-id', testSessionId, '-p', '/context'],
      cwd: testCwd,
      timeout: 30000,
      maxRetries: 1,
      logger,
      providerId: 'integration-test',
    })

    // CLI exits with 0 - stdout is empty/whitespace because output goes to transcript
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('') // Key insight: stdout is empty!

    // Wait a moment for file system
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Verify transcript file exists
    const transcriptExists = await fs
      .access(expectedTranscriptPath)
      .then(() => true)
      .catch(() => false)
    expect(transcriptExists).toBe(true)
  }, 45000) // 45s timeout for CLI

  it('transcript contains /context output in expected format', async () => {
    // Read the transcript
    const content = await fs.readFile(expectedTranscriptPath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)

    expect(lines.length).toBeGreaterThan(0)

    // Find the /context output line
    const contextOutputLine = lines.find((line) => {
      try {
        const entry = JSON.parse(line)
        return entry.message?.content?.includes('<local-command-stdout>')
      } catch {
        return false
      }
    })

    expect(contextOutputLine).toBeDefined()

    // Parse and verify structure
    const contextEntry = JSON.parse(contextOutputLine!)
    const stdout = contextEntry.message.content as string

    // Verify expected markers
    expect(stdout).toContain('<local-command-stdout>')
    expect(stdout).toContain('System prompt')
    expect(stdout).toContain('System tools')

    // Verify token count format: "63.2k / 200.0k (32%)"
    expect(stdout).toMatch(/\d+\.?\d*k?\s*\/\s*\d+\.?\d*k?\s*\(/i)
  })

  it('parses /context output from transcript', async () => {
    // Read the transcript
    const content = await fs.readFile(expectedTranscriptPath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)

    // Find the /context output
    const contextLine = lines.find((line) => {
      try {
        const entry = JSON.parse(line)
        return entry.message?.content?.includes('<local-command-stdout>')
      } catch {
        return false
      }
    })

    const entry = JSON.parse(contextLine!)
    const stdout = entry.message.content as string

    // Verify it has parseable format
    // Either markdown table (| Category | Tokens |) or visual format (Category: Xk tokens)
    const hasMarkdownTable = stdout.includes('|') && stdout.includes('Tokens')
    const hasVisualFormat = /[A-Za-z]+ [a-z]+:\s*[\d.,kKmM]+\s*tokens/i.test(stdout)

    expect(hasMarkdownTable || hasVisualFormat).toBe(true)

    // Test passes if either format is detected
  })
})

/**
 * Unit tests for transcript path encoding
 */
describe('transcript path encoding', () => {
  it('encodes simple path', () => {
    const cwd = '/tmp/sidekick/test'
    const encoded = cwd.replace(/\//g, '-').replace(/^-/, '-')

    expect(encoded).toBe('-tmp-sidekick-test')
  })

  it('handles private directory prefix (macOS)', () => {
    const cwd = '/private/tmp/sidekick/test'
    const encoded = cwd.replace(/\//g, '-').replace(/^-/, '-')

    expect(encoded).toBe('-private-tmp-sidekick-test')
  })

  it('handles home directory path', () => {
    const cwd = '/Users/scott/projects/myapp'
    const encoded = cwd.replace(/\//g, '-').replace(/^-/, '-')

    expect(encoded).toBe('-Users-scott-projects-myapp')
  })
})
