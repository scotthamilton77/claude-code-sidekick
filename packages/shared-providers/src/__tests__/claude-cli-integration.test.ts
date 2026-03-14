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

    // CLI exits with 0 - /context output appears on stdout as markdown
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).not.toBe('')
    expect(result.stdout).toContain('Context Usage')

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

    // Find the /context output line — may be in message.content or content directly
    const contextOutputLine = lines.find((line) => {
      try {
        const entry = JSON.parse(line)
        const text = entry.message?.content ?? entry.content ?? ''
        return text.includes('<local-command-stdout>')
      } catch {
        return false
      }
    })

    expect(contextOutputLine).toBeDefined()

    // Parse and verify structure
    const contextEntry = JSON.parse(contextOutputLine!)
    const stdout = contextEntry.message?.content ?? contextEntry.content
    expect(typeof stdout).toBe('string')

    // Verify expected markers
    expect(stdout).toContain('<local-command-stdout>')
    expect(stdout).toContain('System prompt')
    expect(stdout).toContain('System tools')

    // Verify token count format: "18k / 200k (9%)" or "166k/200k tokens (83%)"
    expect(stdout).toMatch(/\d+\.?\d*k?\s*\/\s*\d+\.?\d*k?\s*\w*\s*\(/i)
  })

  it('parses /context output from transcript', async () => {
    // Read the transcript
    const content = await fs.readFile(expectedTranscriptPath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)

    // Find the /context output — may be in message.content or content directly
    const contextLine = lines.find((line) => {
      try {
        const entry = JSON.parse(line)
        const text = entry.message?.content ?? entry.content ?? ''
        return text.includes('<local-command-stdout>')
      } catch {
        return false
      }
    })

    expect(contextLine).toBeDefined()
    const entry = JSON.parse(contextLine!)
    const stdout = entry.message?.content ?? entry.content
    expect(typeof stdout).toBe('string')

    // Verify it has parseable format
    // Either markdown table (| Category | Tokens |) or visual format (Category: Xk tokens)
    const hasMarkdownTable = stdout.includes('|') && stdout.includes('Tokens')
    const hasVisualFormat = /[A-Za-z]+ [a-z]+:\s*[\d.,kKmM]+\s*tokens/i.test(stdout)

    expect(hasMarkdownTable || hasVisualFormat).toBe(true)

    // Test passes if either format is detected
  })
})

// NOTE: Previous "transcript path encoding" tests were removed as they
// only tested inline regex replacement logic in the test file itself,
// not any production code. These were false-positive tests that could
// never catch regressions. If path encoding becomes production code,
// it should be extracted to a utility function with proper tests.
