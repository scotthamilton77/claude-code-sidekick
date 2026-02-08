/**
 * Tests for Statusline Feature
 *
 * @see docs/design/FEATURE-STATUSLINE.md
 */

import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  calculateContextUsage,
  createFormatter,
  formatBranch,
  formatContextBar,
  formatCost,
  formatCwd,
  formatDuration,
  formatLogs,
  formatTokens,
  getBranchColor,
  getContextBarStatus,
  getThresholdStatus,
  shortenPath,
} from '../formatter.js'
import { StateService } from '@sidekick/core'
import type { MinimalAssetResolver } from '@sidekick/types'
import { getDefaultOverhead, readContextOverhead } from '../context-overhead-reader.js'
import { createStateReader, discoverPreviousResumeMessage } from '../state-reader.js'
import { createStatuslineService, type ClaudeCodeStatusInput, type MinimalSetupStatusService } from '../statusline-service.js'
import { DEFAULT_STATUSLINE_CONFIG, type StatuslineViewModel } from '../types.js'

/**
 * Helper to set up a test directory structure for StateReader tests.
 * Creates project root with .sidekick/sessions/{sessionId}/state/ structure.
 */
async function setupStateReaderTestDir(): Promise<{
  projectRoot: string
  sessionId: string
  stateDir: string
  globalStateDir: string
  stateService: StateService
  setupService: MockSetupStatusService
}> {
  const projectRoot = path.join(tmpdir(), `statusline-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const sessionId = 'test-session-123'
  const stateDir = path.join(projectRoot, '.sidekick', 'sessions', sessionId, 'state')
  const globalStateDir = path.join(projectRoot, '.sidekick', 'state')

  await fs.mkdir(stateDir, { recursive: true })
  await fs.mkdir(globalStateDir, { recursive: true })

  const stateService = new StateService(projectRoot)
  const setupService = createMockSetupService()

  return { projectRoot, sessionId, stateDir, globalStateDir, stateService, setupService }
}

/**
 * Create a test ClaudeCodeStatusInput with sensible defaults.
 * Only specify the fields you care about for your test.
 */
function createTestHookInput(overrides: {
  modelDisplayName?: string
  modelId?: string
  totalInputTokens?: number
  totalOutputTokens?: number
  contextWindowSize?: number
  totalCostUsd?: number
  totalDurationMs?: number
  cwd?: string
}): ClaudeCodeStatusInput {
  return {
    hook_event_name: 'Status',
    session_id: 'test-session',
    transcript_path: '/path/to/transcript.json',
    cwd: overrides.cwd ?? '/test',
    version: '1.0.0',
    model: {
      id: overrides.modelId ?? 'claude-opus-4-1',
      display_name: overrides.modelDisplayName ?? 'Opus',
    },
    workspace: {
      current_dir: overrides.cwd ?? '/test',
      project_dir: '/test',
    },
    output_style: {
      name: 'default',
    },
    cost: {
      total_cost_usd: overrides.totalCostUsd ?? 0,
      total_duration_ms: overrides.totalDurationMs ?? 0,
      total_api_duration_ms: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
    },
    context_window: {
      total_input_tokens: overrides.totalInputTokens ?? 0,
      total_output_tokens: overrides.totalOutputTokens ?? 0,
      context_window_size: overrides.contextWindowSize ?? 200000,
      current_usage: {
        input_tokens: overrides.totalInputTokens ?? 0,
        output_tokens: overrides.totalOutputTokens ?? 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  }
}

/**
 * Create valid persisted transcript metrics test data.
 * Matches PersistedTranscriptStateSchema with all required fields.
 */
function createTestPersistedMetrics(overrides?: {
  sessionId?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  currentContextTokens?: number | null
  isPostCompactIndeterminate?: boolean
  persistedAt?: number
}): {
  sessionId: string
  metrics: {
    turnCount: number
    toolsThisTurn: number
    toolCount: number
    messageCount: number
    tokenUsage: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
      cacheCreationInputTokens: number
      cacheReadInputTokens: number
      cacheTiers: { ephemeral5mInputTokens: number; ephemeral1hInputTokens: number }
      serviceTierCounts: Record<string, number>
      byModel: Record<string, { inputTokens: number; outputTokens: number; requestCount: number }>
    }
    currentContextTokens: number | null
    isPostCompactIndeterminate: boolean
    toolsPerTurn: number
    lastProcessedLine: number
    lastUpdatedAt: number
  }
  persistedAt: number
} {
  return {
    sessionId: overrides?.sessionId ?? 'test-123',
    metrics: {
      turnCount: 1,
      toolsThisTurn: 0,
      toolCount: 0,
      messageCount: 2,
      tokenUsage: {
        inputTokens: overrides?.inputTokens ?? 30000,
        outputTokens: overrides?.outputTokens ?? 15000,
        totalTokens: overrides?.totalTokens ?? 45000,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        cacheTiers: { ephemeral5mInputTokens: 0, ephemeral1hInputTokens: 0 },
        serviceTierCounts: {},
        byModel: {},
      },
      currentContextTokens: overrides?.currentContextTokens ?? 30000,
      isPostCompactIndeterminate: overrides?.isPostCompactIndeterminate ?? false,
      toolsPerTurn: 0,
      lastProcessedLine: 2,
      lastUpdatedAt: Date.now(),
    },
    persistedAt: overrides?.persistedAt ?? Date.now(),
  }
}

/**
 * Mock SetupStatusService that always returns healthy status.
 * Used in tests to bypass real file system checks.
 * Only implements the two methods required by MinimalSetupStatusService.
 */
class MockSetupStatusService implements MinimalSetupStatusService {
  getSetupState(): Promise<'healthy'> {
    return Promise.resolve('healthy')
  }

  getEffectiveApiKeyHealth(): Promise<'healthy'> {
    return Promise.resolve('healthy')
  }
}

/**
 * Create a mock SetupStatusService for tests.
 */
function createMockSetupService(): MockSetupStatusService {
  return new MockSetupStatusService()
}

// ============================================================================
// Formatter Tests
// ============================================================================

describe('Formatter utilities', () => {
  describe('formatTokens', () => {
    it('formats small numbers', () => {
      expect(formatTokens(500)).toBe('500')
    })

    it('formats thousands with k suffix', () => {
      expect(formatTokens(45000)).toBe('45k')
      expect(formatTokens(1000)).toBe('1k')
    })

    it('formats millions with M suffix', () => {
      expect(formatTokens(1_500_000)).toBe('1.5M')
    })
  })

  describe('formatCost', () => {
    it('formats costs with dollar sign', () => {
      expect(formatCost(0.15)).toBe('$0.15')
      expect(formatCost(1.5)).toBe('$1.50')
    })

    it('shows $0.00 for very small costs', () => {
      expect(formatCost(0.001)).toBe('$0.00')
    })
  })

  describe('formatDuration', () => {
    it('formats seconds', () => {
      expect(formatDuration(5000)).toBe('5s')
    })

    it('formats minutes', () => {
      expect(formatDuration(120000)).toBe('2m')
      expect(formatDuration(90000)).toBe('1m')
    })

    it('formats hours and minutes', () => {
      expect(formatDuration(3720000)).toBe('1h2m')
    })
  })

  describe('shortenPath', () => {
    it('replaces home dir with tilde', () => {
      expect(shortenPath('/home/user/project', '/home/user')).toBe('~/project')
    })

    it('shortens long paths to ellipsis + last two segments', () => {
      // Path > 20 chars gets shortened
      expect(shortenPath('/home/user/projects/my-app')).toBe('…/projects/my-app')
    })

    it('falls back to last segment when two segments too long', () => {
      // Two segments too long, falls back to just the last segment
      expect(shortenPath('/home/user/very-long-folder/another-long-name')).toBe('…/another-long-name')
    })

    it('hard truncates when even one segment is too long', () => {
      // Even one segment is too long - hard truncate, no trailing ellipsis
      expect(shortenPath('/home/user/this-is-a-ridiculously-long-folder-name')).toBe('…/this-is-a-ridiculo')
    })

    it('returns short paths as-is', () => {
      expect(shortenPath('/home/project')).toBe('/home/project')
    })

    it('returns paths under 20 chars as-is even with many segments', () => {
      expect(shortenPath('/a/b/c/d/e')).toBe('/a/b/c/d/e')
    })

    it('handles single segment path that is too long', () => {
      // A path like "/verylongsinglesegment" (single slash) that exceeds 20 chars
      const longSegment = '/this-is-a-super-long-single-segment-path'
      const result = shortenPath(longSegment)
      // Should use ellipsis + truncated content
      expect(result.startsWith('…')).toBe(true)
      expect(result.length).toBeLessThanOrEqual(20)
    })

    it('handles single segment without slashes that is too long', () => {
      // A path without any slashes (just a very long segment name)
      // This is an edge case for paths like relative names
      const longSegmentNoSlash = 'this-is-a-very-long-segment-without-any-slashes'
      const result = shortenPath(longSegmentNoSlash)
      // Should hard truncate with leading ellipsis
      expect(result.startsWith('…')).toBe(true)
      expect(result.length).toBeLessThanOrEqual(20)
    })
  })

  describe('formatBranch', () => {
    it('returns empty string for empty branch', () => {
      expect(formatBranch('', 'full')).toBe('')
    })

    it('formats branch based on symbol mode', () => {
      expect(formatBranch('main', 'full')).toBe('⎇ main')
      expect(formatBranch('main', 'safe')).toBe('∗ main')
      expect(formatBranch('main', 'ascii')).toBe('* main')
    })
  })

  describe('getBranchColor', () => {
    it('returns empty string for empty branch', () => {
      expect(getBranchColor('')).toBe('')
    })

    it('returns green for main/master', () => {
      expect(getBranchColor('main')).toBe('green')
      expect(getBranchColor('master')).toBe('green')
    })

    it('returns blue for feature branches', () => {
      expect(getBranchColor('feature/auth')).toBe('blue')
      expect(getBranchColor('feat/new-thing')).toBe('blue')
    })

    it('returns red for hotfix/fix branches', () => {
      expect(getBranchColor('hotfix/urgent')).toBe('red')
      expect(getBranchColor('fix/bug-123')).toBe('red')
    })

    it('returns magenta for other branches', () => {
      expect(getBranchColor('develop')).toBe('magenta')
      expect(getBranchColor('some-branch')).toBe('magenta')
    })
  })

  describe('getThresholdStatus', () => {
    const thresholds = { warning: 100, critical: 200 }

    it('returns normal below warning', () => {
      expect(getThresholdStatus(50, thresholds)).toBe('normal')
    })

    it('returns warning at warning threshold', () => {
      expect(getThresholdStatus(100, thresholds)).toBe('warning')
      expect(getThresholdStatus(150, thresholds)).toBe('warning')
    })

    it('returns critical at critical threshold', () => {
      expect(getThresholdStatus(200, thresholds)).toBe('critical')
      expect(getThresholdStatus(300, thresholds)).toBe('critical')
    })
  })

  describe('calculateContextUsage', () => {
    it('returns undefined when context window size is missing', () => {
      expect(calculateContextUsage(1000, 500, undefined)).toBeUndefined()
      expect(calculateContextUsage(1000, 500, 0)).toBeUndefined()
    })

    it('calculates effective limit from buffer tokens', () => {
      // 200k window - 45k buffer = 155k effective
      const result = calculateContextUsage(50000, 45000, 200000)
      expect(result).toBeDefined()
      expect(result!.effectiveLimit).toBe(155000) // 200000 - 45000
      expect(result!.contextTokens).toBe(50000)
      expect(result!.bufferTokens).toBe(45000)
      expect(result!.totalTokens).toBe(95000) // context + buffer
    })

    it('calculates correct usage fraction', () => {
      // 50k context / 155k effective = ~0.323
      const result = calculateContextUsage(50000, 45000, 200000)
      expect(result).toBeDefined()
      expect(result!.usageFraction).toBeCloseTo(0.323, 2)
    })

    it('sets status based on usage fraction', () => {
      // Low usage (< 50%)
      const low = calculateContextUsage(10000, 45000, 200000)
      expect(low!.status).toBe('low')

      // Medium usage (50-80%)
      const medium = calculateContextUsage(85000, 45000, 200000)
      expect(medium!.status).toBe('medium')

      // High usage (> 80%)
      const high = calculateContextUsage(130000, 45000, 200000)
      expect(high!.status).toBe('high')
    })

    it('handles zero effective limit gracefully', () => {
      // Buffer equals context window
      const result = calculateContextUsage(1000, 200000, 200000)
      expect(result).toBeDefined()
      expect(result!.effectiveLimit).toBe(0)
      expect(result!.usageFraction).toBe(1) // Fallback to 1 when effectiveLimit is 0
    })
  })

  describe('getContextBarStatus', () => {
    it('returns low for under 50% usage', () => {
      expect(getContextBarStatus(0)).toBe('low')
      expect(getContextBarStatus(0.25)).toBe('low')
      expect(getContextBarStatus(0.49)).toBe('low')
    })

    it('returns medium for 50-80% usage', () => {
      expect(getContextBarStatus(0.5)).toBe('medium')
      expect(getContextBarStatus(0.65)).toBe('medium')
      expect(getContextBarStatus(0.79)).toBe('medium')
    })

    it('returns high for 80%+ usage', () => {
      expect(getContextBarStatus(0.8)).toBe('high')
      expect(getContextBarStatus(0.9)).toBe('high')
      expect(getContextBarStatus(1.0)).toBe('high')
    })

    it('handles values above 100%', () => {
      // Over-budget scenarios (context exceeds effective limit)
      expect(getContextBarStatus(1.5)).toBe('high')
      expect(getContextBarStatus(2.0)).toBe('high')
    })
  })

  describe('formatContextBar', () => {
    it('returns empty string when no usage data', () => {
      expect(formatContextBar(undefined, false)).toBe('')
      expect(formatContextBar(undefined, true)).toBe('')
    })

    it('includes coin icon prefix', () => {
      const usage = calculateContextUsage(10000, 45000, 200000)
      const bar = formatContextBar(usage, false)
      expect(bar).toMatch(/^🪙 /)
    })

    it('contains bar characters for usage visualization', () => {
      const usage = calculateContextUsage(80000, 45000, 200000)
      const bar = formatContextBar(usage, false)
      // Should contain some filled, buffer, and empty characters
      expect(bar).toContain('▓') // filled (context)
      expect(bar).toContain('▒') // buffer
      expect(bar).toContain('░') // empty
    })

    it('shows more filled characters as usage increases', () => {
      const lowUsage = calculateContextUsage(10000, 45000, 200000)
      const highUsage = calculateContextUsage(130000, 45000, 200000)

      const lowBar = formatContextBar(lowUsage, false)
      const highBar = formatContextBar(highUsage, false)

      // Count filled characters (▓)
      const countFilled = (s: string): number => (s.match(/▓/g) || []).length
      expect(countFilled(highBar)).toBeGreaterThan(countFilled(lowBar))
    })

    it('applies ANSI colors when enabled', () => {
      const usage = calculateContextUsage(50000, 45000, 200000)
      const coloredBar = formatContextBar(usage, true)
      const plainBar = formatContextBar(usage, false)

      // Colored bar should contain ANSI escape sequences
      expect(coloredBar).toContain('\x1b[')
      // Plain bar should not
      expect(plainBar).not.toContain('\x1b[')
    })

    it('handles low usage (green color when colored)', () => {
      // Use enough context tokens to have at least one filled character (▓)
      // With 200k window and 8-char bar, each position = 25k tokens
      const usage = calculateContextUsage(30000, 45000, 200000) // ~19% usage, 1+ filled char
      expect(usage!.status).toBe('low')
      const bar = formatContextBar(usage, true)
      // Should contain green ANSI code for low status applied to context portion
      expect(bar).toContain('\x1b[32m') // green
    })

    it('handles medium usage (yellow color when colored)', () => {
      const usage = calculateContextUsage(85000, 45000, 200000) // ~55% usage
      expect(usage!.status).toBe('medium')
      const bar = formatContextBar(usage, true)
      // Should contain yellow ANSI code for medium status
      expect(bar).toContain('\x1b[33m') // yellow
    })

    it('handles high usage (red color when colored)', () => {
      const usage = calculateContextUsage(130000, 45000, 200000) // ~84% usage
      expect(usage!.status).toBe('high')
      const bar = formatContextBar(usage, true)
      // Should contain red ANSI code for high status
      expect(bar).toContain('\x1b[31m') // red
    })

    it('applies dim style to buffer portion', () => {
      const usage = calculateContextUsage(50000, 45000, 200000)
      const bar = formatContextBar(usage, true)
      // Should contain dim ANSI code for buffer characters
      expect(bar).toContain('\x1b[2m') // dim
    })

    describe('symbol mode support', () => {
      it('uses coin emoji in full mode (default)', () => {
        const usage = calculateContextUsage(80000, 45000, 200000)
        const bar = formatContextBar(usage, false, 'full')
        expect(bar).toMatch(/^🪙 /)
        expect(bar).toContain('▓') // Unicode bar chars
      })

      it('omits emoji in safe mode but keeps Unicode bar chars', () => {
        const usage = calculateContextUsage(80000, 45000, 200000)
        const bar = formatContextBar(usage, false, 'safe')
        expect(bar).not.toContain('🪙')
        expect(bar).toContain('▓') // Unicode bar chars still used
        expect(bar).not.toMatch(/^\[/) // No brackets
      })

      it('uses ASCII characters in ascii mode', () => {
        const usage = calculateContextUsage(80000, 45000, 200000)
        const bar = formatContextBar(usage, false, 'ascii')
        expect(bar).toMatch(/^\[.*\]$/) // Wrapped in brackets
        expect(bar).toContain('#') // ASCII filled
        expect(bar).not.toContain('🪙') // No emoji
        expect(bar).not.toContain('▓') // No Unicode bar chars
      })
    })
  })

  describe('formatLogs symbol mode', () => {
    it('uses Unicode symbols in full mode', () => {
      expect(formatLogs(3, 1, 'full')).toBe('⚠3 ✗1')
    })

    it('uses safe BMP symbols in safe mode', () => {
      expect(formatLogs(3, 1, 'safe')).toBe('△3 ×1')
    })

    it('uses ASCII in ascii mode', () => {
      expect(formatLogs(3, 1, 'ascii')).toBe('W:3 E:1')
    })
  })

  describe('formatCwd symbol mode', () => {
    it('includes folder emoji in full mode', () => {
      const cwd = formatCwd('/home/user/project', '/home/user', 'full')
      expect(cwd).toMatch(/^📁 /)
    })

    it('omits icon in safe mode', () => {
      const cwd = formatCwd('/home/user/project', '/home/user', 'safe')
      expect(cwd).not.toContain('📁')
      expect(cwd).toBe('~/project')
    })

    it('omits icon in ascii mode', () => {
      const cwd = formatCwd('/home/user/project', '/home/user', 'ascii')
      expect(cwd).not.toContain('📁')
      expect(cwd).toBe('~/project')
    })
  })
})

describe('getDefaultOverhead', () => {
  // Note: We don't assert specific numeric values here because they're defined
  // in @sidekick/types and may change. Testing exact values would just mirror
  // those constants without providing regression protection.

  it('returns complete overhead structure', () => {
    const overhead = getDefaultOverhead()

    // Verify required properties exist
    expect(overhead).toHaveProperty('systemPromptTokens')
    expect(overhead).toHaveProperty('systemToolsTokens')
    expect(overhead).toHaveProperty('autocompactBufferTokens')
    expect(overhead).toHaveProperty('mcpToolsTokens')
    expect(overhead).toHaveProperty('customAgentsTokens')
    expect(overhead).toHaveProperty('memoryFilesTokens')
    expect(overhead).toHaveProperty('usingDefaults')
    expect(overhead).toHaveProperty('totalOverhead')
  })

  it('marks overhead as using defaults', () => {
    const overhead = getDefaultOverhead()
    expect(overhead.usingDefaults).toBe(true)
  })

  it('calculates totalOverhead as sum of component values', () => {
    const overhead = getDefaultOverhead()
    const expectedTotal = overhead.systemPromptTokens + overhead.systemToolsTokens + overhead.autocompactBufferTokens
    expect(overhead.totalOverhead).toBe(expectedTotal)
  })

  it('returns positive values for system components', () => {
    const overhead = getDefaultOverhead()
    expect(overhead.systemPromptTokens).toBeGreaterThan(0)
    expect(overhead.systemToolsTokens).toBeGreaterThan(0)
    expect(overhead.autocompactBufferTokens).toBeGreaterThan(0)
    expect(overhead.totalOverhead).toBeGreaterThan(0)
  })
})

describe('readContextOverhead', () => {
  let userConfigDir: string
  let projectDir: string

  beforeEach(async () => {
    userConfigDir = path.join(tmpdir(), `context-overhead-user-${Date.now()}`)
    projectDir = path.join(tmpdir(), `context-overhead-project-${Date.now()}`)
    await fs.mkdir(path.join(userConfigDir, 'state'), { recursive: true })
    await fs.mkdir(path.join(projectDir, '.sidekick', 'state'), { recursive: true })
  })

  it('returns defaults when no files exist', async () => {
    const overhead = await readContextOverhead({
      userConfigDir,
      projectDir,
    })

    // Should use defaults when files don't exist
    expect(overhead.usingDefaults).toBe(true)
    expect(overhead.systemPromptTokens).toBeGreaterThan(0)
    expect(overhead.systemToolsTokens).toBeGreaterThan(0)
    expect(overhead.autocompactBufferTokens).toBeGreaterThan(0)
  })

  it('reads base metrics from valid file', async () => {
    // Write valid base metrics file
    const baseMetrics = {
      systemPromptTokens: 4000,
      systemToolsTokens: 20000,
      autocompactBufferTokens: 50000,
      capturedAt: Date.now(),
      capturedFrom: 'context_command',
      sessionId: 'test-session',
    }
    await fs.writeFile(
      path.join(userConfigDir, 'state', 'baseline-user-context-token-metrics.json'),
      JSON.stringify(baseMetrics)
    )

    const overhead = await readContextOverhead({
      userConfigDir,
      projectDir,
    })

    expect(overhead.usingDefaults).toBe(false)
    expect(overhead.systemPromptTokens).toBe(4000)
    expect(overhead.systemToolsTokens).toBe(20000)
    expect(overhead.autocompactBufferTokens).toBe(50000)
  })

  it('reads project metrics from valid file', async () => {
    // Write valid project metrics file
    const projectMetrics = {
      mcpToolsTokens: 1500,
      customAgentsTokens: 2000,
      memoryFilesTokens: 500,
      lastUpdatedAt: Date.now(),
    }
    await fs.writeFile(
      path.join(projectDir, '.sidekick', 'state', 'baseline-project-context-token-metrics.json'),
      JSON.stringify(projectMetrics)
    )

    const overhead = await readContextOverhead({
      userConfigDir,
      projectDir,
    })

    expect(overhead.mcpToolsTokens).toBe(1500)
    expect(overhead.customAgentsTokens).toBe(2000)
    expect(overhead.memoryFilesTokens).toBe(500)
  })

  it('combines base and project metrics into total overhead', async () => {
    // Write both files
    const baseMetrics = {
      systemPromptTokens: 3000,
      systemToolsTokens: 18000,
      autocompactBufferTokens: 45000,
      capturedAt: Date.now(),
      capturedFrom: 'context_command',
    }
    await fs.writeFile(
      path.join(userConfigDir, 'state', 'baseline-user-context-token-metrics.json'),
      JSON.stringify(baseMetrics)
    )

    const projectMetrics = {
      mcpToolsTokens: 1000,
      customAgentsTokens: 500,
      memoryFilesTokens: 200,
      lastUpdatedAt: Date.now(),
    }
    await fs.writeFile(
      path.join(projectDir, '.sidekick', 'state', 'baseline-project-context-token-metrics.json'),
      JSON.stringify(projectMetrics)
    )

    const overhead = await readContextOverhead({
      userConfigDir,
      projectDir,
    })

    // Total = base (3000 + 18000 + 45000) + project (1000 + 500 + 200)
    const expectedTotal = 3000 + 18000 + 1000 + 500 + 200 + 45000
    expect(overhead.totalOverhead).toBe(expectedTotal)
  })

  it('falls back to defaults for invalid base metrics JSON', async () => {
    await fs.writeFile(path.join(userConfigDir, 'state', 'baseline-user-context-token-metrics.json'), 'not valid json')

    const overhead = await readContextOverhead({
      userConfigDir,
      projectDir,
    })

    expect(overhead.usingDefaults).toBe(true)
  })

  it('falls back to defaults for schema-invalid base metrics', async () => {
    // Valid JSON but missing required fields
    await fs.writeFile(
      path.join(userConfigDir, 'state', 'baseline-user-context-token-metrics.json'),
      JSON.stringify({ wrongField: 123 })
    )

    const overhead = await readContextOverhead({
      userConfigDir,
      projectDir,
    })

    expect(overhead.usingDefaults).toBe(true)
  })

  it('falls back to defaults for invalid project metrics JSON', async () => {
    // Write valid base but invalid project
    const baseMetrics = {
      systemPromptTokens: 3000,
      systemToolsTokens: 18000,
      autocompactBufferTokens: 45000,
      capturedAt: Date.now(),
      capturedFrom: 'context_command',
    }
    await fs.writeFile(
      path.join(userConfigDir, 'state', 'baseline-user-context-token-metrics.json'),
      JSON.stringify(baseMetrics)
    )
    await fs.writeFile(
      path.join(projectDir, '.sidekick', 'state', 'baseline-project-context-token-metrics.json'),
      'invalid json'
    )

    const overhead = await readContextOverhead({
      userConfigDir,
      projectDir,
    })

    // Base metrics should be used, project should fall back to defaults
    expect(overhead.systemPromptTokens).toBe(3000)
    expect(overhead.mcpToolsTokens).toBe(0) // default project value
    expect(overhead.customAgentsTokens).toBe(0) // default project value
  })

  it('falls back to defaults for schema-invalid project metrics', async () => {
    await fs.writeFile(
      path.join(projectDir, '.sidekick', 'state', 'baseline-project-context-token-metrics.json'),
      JSON.stringify({ invalidField: 'test' })
    )

    const overhead = await readContextOverhead({
      userConfigDir,
      projectDir,
    })

    // Should use default project metrics (0 for all project-specific values)
    expect(overhead.mcpToolsTokens).toBe(0)
    expect(overhead.customAgentsTokens).toBe(0)
    expect(overhead.memoryFilesTokens).toBe(0)
  })
})

describe('Formatter class', () => {
  it('formats template with view model', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    const viewModel = {
      model: 'claude-3-5-sonnet',
      contextWindow: '200k',
      tokenUsageActual: '45k',
      tokenUsageEffective: '90k',
      tokenPercentageActual: '22%',
      tokenPercentageEffective: '45%',
      tokensStatus: 'normal' as const,
      cost: '$0.15',
      costStatus: 'normal' as const,
      duration: '12m',
      cwd: '~/project',
      branch: '⎇ main',
      branchColor: 'green',
      displayMode: 'session_summary' as const,
      summary: 'Fixing auth bug',
      title: 'Auth bug fix',
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
      personaName: '',
    }

    const result = formatter.format('[{model}] | {tokenUsageActual} | {summary}', viewModel)
    expect(result).toBe('[claude-3-5-sonnet] | 45k | Fixing auth bug')
  })

  it('cleans up empty tokens with pipe separator', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    const viewModel = {
      model: 'claude-3-5-sonnet',
      contextWindow: '200k',
      tokenUsageActual: '45k',
      tokenUsageEffective: '90k',
      tokenPercentageActual: '22%',
      tokenPercentageEffective: '45%',
      tokensStatus: 'normal' as const,
      cost: '$0.15',
      costStatus: 'normal' as const,
      duration: '12m',
      cwd: '~/project',
      branch: '',
      branchColor: '',
      displayMode: 'session_summary' as const,
      summary: 'Test summary',
      title: '', // Empty title
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
      personaName: '',
    }

    // Empty {title} between two separators should be cleaned up
    const result = formatter.format('{model} | {title} | {summary}', viewModel)
    expect(result).toBe('claude-3-5-sonnet | Test summary')
  })

  it('cleans up empty tokens with newline separator', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    const viewModel = {
      model: 'claude-3-5-sonnet',
      contextWindow: '200k',
      tokenUsageActual: '45k',
      tokenUsageEffective: '90k',
      tokenPercentageActual: '22%',
      tokenPercentageEffective: '45%',
      tokensStatus: 'normal' as const,
      cost: '$0.15',
      costStatus: 'normal' as const,
      duration: '12m',
      cwd: '~/project',
      branch: '',
      branchColor: '',
      displayMode: 'session_summary' as const,
      summary: 'Test summary',
      title: '', // Empty title
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
      personaName: '',
    }

    // Empty {title} between newline separators should be cleaned up
    const result = formatter.format('{model}\n{title}\n{summary}', viewModel)
    expect(result).toBe('claude-3-5-sonnet | Test summary')
  })

  it('preserves pipe characters inside token values', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    const viewModel = {
      model: 'claude-3-5-sonnet',
      contextWindow: '200k',
      tokenUsageActual: '45k',
      tokenUsageEffective: '90k',
      tokenPercentageActual: '22%',
      tokenPercentageEffective: '45%',
      tokensStatus: 'normal' as const,
      cost: '$0.15',
      costStatus: 'normal' as const,
      duration: '12m',
      cwd: '~/project',
      branch: '',
      branchColor: '',
      displayMode: 'session_summary' as const,
      summary: 'Working hard | or hardly working?', // Contains pipe
      title: 'Test',
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
      personaName: '',
    }

    const result = formatter.format('{title} | {summary}', viewModel)
    expect(result).toBe('Test | Working hard | or hardly working?')
  })

  it('handles mixed empty tokens and separators', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    const viewModel = {
      model: 'claude-3-5-sonnet',
      contextWindow: '200k',
      tokenUsageActual: '45k',
      tokenUsageEffective: '90k',
      tokenPercentageActual: '22%',
      tokenPercentageEffective: '45%',
      tokensStatus: 'normal' as const,
      cost: '$0.15',
      costStatus: 'normal' as const,
      duration: '',
      cwd: '~/project',
      branch: '',
      branchColor: '',
      displayMode: 'session_summary' as const,
      summary: '',
      title: 'Test title',
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
      personaName: '',
    }

    // Multiple empty tokens should all be cleaned up
    const result = formatter.format('{model} | {duration} | {title} | {summary}', viewModel)
    expect(result).toBe('claude-3-5-sonnet | Test title')
  })

  it('preserves separator when concatenated empty token precedes it', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    const viewModel = {
      model: 'claude-3-5-sonnet',
      contextWindow: '200k',
      tokenUsageActual: '45k',
      tokenUsageEffective: '90k',
      tokenPercentageActual: '22%',
      tokenPercentageEffective: '45%',
      tokensStatus: 'normal' as const,
      cost: '$0.15',
      costStatus: 'normal' as const,
      duration: '12m',
      cwd: '~/project',
      branch: '', // Empty branch directly concatenated to cwd
      branchColor: '',
      displayMode: 'session_summary' as const,
      summary: 'Test summary',
      title: 'Test title',
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
      personaName: '',
    }

    // Template: {cwd}{branch} | {title} - branch is empty but separator should be preserved
    // Bug: Previously, EMPTY_MARKER | was removed entirely, causing cwd to run into title
    const result = formatter.format('{cwd}{branch} | {title}', viewModel)
    expect(result).toBe('~/project | Test title')
  })
})

describe('Formatter prefix/suffix syntax', () => {
  const makeViewModel = (overrides: Record<string, unknown> = {}): StatuslineViewModel => ({
    model: 'claude-3-5-sonnet',
    contextWindow: '200k',
    tokenUsageActual: '45k',
    tokenUsageEffective: '90k',
    tokenPercentageActual: '22%',
    tokenPercentageEffective: '45%',
    tokensStatus: 'normal' as const,
    cost: '$0.15',
    costStatus: 'normal' as const,
    duration: '12m',
    cwd: '~/project',
    branch: '⎇ main',
    branchColor: 'green',
    displayMode: 'session_summary' as const,
    summary: 'Test summary',
    title: 'Test title',
    warningCount: 0,
    errorCount: 0,
    logStatus: 'normal' as const,
    personaName: '',
    ...overrides,
  })

  const formatter = createFormatter({
    theme: DEFAULT_STATUSLINE_CONFIG.theme,
    useColors: false,
  })

  it('renders prefix and suffix when value is non-empty', () => {
    const viewModel = makeViewModel({ personaName: 'jarvis' })
    const result = formatter.format("{personaName,prefix='[',suffix=']'}", viewModel)
    expect(result).toBe('[jarvis]')
  })

  it('omits prefix and suffix when value is empty', () => {
    const viewModel = makeViewModel({ personaName: '' })
    const result = formatter.format("{personaName,prefix='[',suffix=']'} | {model}", viewModel)
    expect(result).toBe('claude-3-5-sonnet')
  })

  it('renders prefix only when specified', () => {
    const viewModel = makeViewModel({ personaName: 'jarvis' })
    const result = formatter.format("{personaName,prefix='→ '}", viewModel)
    expect(result).toBe('→ jarvis')
  })

  it('renders suffix only when specified', () => {
    const viewModel = makeViewModel({ personaName: 'jarvis' })
    const result = formatter.format("{personaName,suffix=' ←'}", viewModel)
    expect(result).toBe('jarvis ←')
  })

  it('handles suffix with pipe separator', () => {
    const viewModel = makeViewModel({ personaName: 'jarvis' })
    const result = formatter.format("{personaName,prefix='[',suffix='] | '}{model}", viewModel)
    expect(result).toBe('[jarvis] | claude-3-5-sonnet')
  })

  it('cleans up when value with suffix is empty', () => {
    const viewModel = makeViewModel({ personaName: '' })
    // Empty personaName should result in just the model, no orphan separators
    const result = formatter.format("{personaName,prefix='[',suffix='] | '}{model,prefix='[',suffix=']'}", viewModel)
    expect(result).toBe('[claude-3-5-sonnet]')
  })

  it('handles escaped quotes in prefix', () => {
    const viewModel = makeViewModel({ personaName: 'test' })
    const result = formatter.format("{personaName,prefix='it\\'s '}", viewModel)
    expect(result).toBe("it's test")
  })

  it('handles escaped backslash in suffix', () => {
    const viewModel = makeViewModel({ personaName: 'test' })
    const result = formatter.format("{personaName,suffix=' \\\\'}", viewModel)
    expect(result).toBe('test \\')
  })

  it('allows suffix before prefix in options', () => {
    const viewModel = makeViewModel({ personaName: 'jarvis' })
    const result = formatter.format("{personaName,suffix=']',prefix='['}", viewModel)
    expect(result).toBe('[jarvis]')
  })

  it('backward compatible with simple {token} syntax', () => {
    const viewModel = makeViewModel({ personaName: 'jarvis' })
    const result = formatter.format('{personaName} | {model}', viewModel)
    expect(result).toBe('jarvis | claude-3-5-sonnet')
  })

  it('handles multiple tokens with prefix/suffix', () => {
    const viewModel = makeViewModel({ personaName: 'jarvis', title: 'Auth fix' })
    const result = formatter.format(
      "{personaName,prefix='[',suffix='] | '}{model,prefix='[',suffix='] | '}{title}",
      viewModel
    )
    expect(result).toBe('[jarvis] | [claude-3-5-sonnet] | Auth fix')
  })

  it('handles all empty tokens with prefix/suffix gracefully', () => {
    const viewModel = makeViewModel({ personaName: '', title: '' })
    const result = formatter.format(
      "{personaName,prefix='[',suffix='] | '}{title,prefix='(',suffix=')'} | {model}",
      viewModel
    )
    expect(result).toBe('claude-3-5-sonnet')
  })
})

describe('Formatter with colors enabled', () => {
  const ANSI = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
  }

  it('applies green color for normal threshold status', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: true,
    })

    const viewModel = {
      model: 'claude-3-5-sonnet',
      contextWindow: '200k',
      tokenUsageActual: '45k',
      tokenUsageEffective: '90k',
      tokenPercentageActual: '22%',
      tokenPercentageEffective: '45%',
      tokensStatus: 'normal' as const,
      cost: '$0.15',
      costStatus: 'normal' as const,
      duration: '12m',
      cwd: '~/project',
      branch: '',
      branchColor: '',
      displayMode: 'session_summary' as const,
      summary: 'Test',
      title: 'Test',
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
      personaName: '',
    }

    const result = formatter.format('{tokenUsageActual}', viewModel)
    expect(result).toContain(ANSI.green)
    expect(result).toContain(ANSI.reset)
  })

  it('applies yellow color for warning threshold status', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: true,
    })

    const viewModel = {
      model: 'claude-3-5-sonnet',
      contextWindow: '200k',
      tokenUsageActual: '120k',
      tokenUsageEffective: '165k',
      tokenPercentageActual: '60%',
      tokenPercentageEffective: '82%',
      tokensStatus: 'warning' as const,
      cost: '$0.15',
      costStatus: 'normal' as const,
      duration: '12m',
      cwd: '~/project',
      branch: '',
      branchColor: '',
      displayMode: 'session_summary' as const,
      summary: 'Test',
      title: 'Test',
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
      personaName: '',
    }

    const result = formatter.format('{tokenUsageActual}', viewModel)
    expect(result).toContain(ANSI.yellow)
  })

  it('applies red color for critical threshold status', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: true,
    })

    const viewModel = {
      model: 'claude-3-5-sonnet',
      contextWindow: '200k',
      tokenUsageActual: '180k',
      tokenUsageEffective: '225k',
      tokenPercentageActual: '90%',
      tokenPercentageEffective: '112%',
      tokensStatus: 'critical' as const,
      cost: '$0.15',
      costStatus: 'normal' as const,
      duration: '12m',
      cwd: '~/project',
      branch: '',
      branchColor: '',
      displayMode: 'session_summary' as const,
      summary: 'Test',
      title: 'Test',
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
      personaName: '',
    }

    const result = formatter.format('{tokenUsageActual}', viewModel)
    expect(result).toContain(ANSI.red)
  })

  it('applies named theme color to model', () => {
    const formatter = createFormatter({
      theme: {
        ...DEFAULT_STATUSLINE_CONFIG.theme,
        colors: { model: 'blue', tokens: 'green', summary: 'magenta', title: 'cyan', cwd: 'white', duration: 'white' },
      },
      useColors: true,
    })

    const viewModel = {
      model: 'claude-3-5-sonnet',
      contextWindow: '200k',
      tokenUsageActual: '45k',
      tokenUsageEffective: '90k',
      tokenPercentageActual: '22%',
      tokenPercentageEffective: '45%',
      tokensStatus: 'normal' as const,
      cost: '$0.15',
      costStatus: 'normal' as const,
      duration: '12m',
      cwd: '~/project',
      branch: '',
      branchColor: '',
      displayMode: 'session_summary' as const,
      summary: 'Test',
      title: 'Test',
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
      personaName: '',
    }

    const result = formatter.format('{model}', viewModel)
    expect(result).toContain(ANSI.blue)
  })

  it('applies named theme color to summary', () => {
    const formatter = createFormatter({
      theme: {
        ...DEFAULT_STATUSLINE_CONFIG.theme,
        colors: { model: 'blue', tokens: 'green', summary: 'magenta', title: 'cyan', cwd: 'white', duration: 'white' },
      },
      useColors: true,
    })

    const viewModel = {
      model: 'claude-3-5-sonnet',
      contextWindow: '200k',
      tokenUsageActual: '45k',
      tokenUsageEffective: '90k',
      tokenPercentageActual: '22%',
      tokenPercentageEffective: '45%',
      tokensStatus: 'normal' as const,
      cost: '$0.15',
      costStatus: 'normal' as const,
      duration: '12m',
      cwd: '~/project',
      branch: '',
      branchColor: '',
      displayMode: 'session_summary' as const,
      summary: 'Working on auth',
      title: 'Test',
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
      personaName: '',
    }

    const result = formatter.format('{summary}', viewModel)
    expect(result).toContain(ANSI.magenta)
  })

  it('handles unknown color name gracefully (no crash, no color)', () => {
    const formatter = createFormatter({
      theme: {
        ...DEFAULT_STATUSLINE_CONFIG.theme,
        colors: {
          model: 'nonexistent_color',
          tokens: 'green',
          summary: 'magenta',
          title: 'cyan',
          cwd: 'white',
          duration: 'white',
        },
      },
      useColors: true,
    })

    const viewModel = {
      model: 'claude-3-5-sonnet',
      contextWindow: '200k',
      tokenUsageActual: '45k',
      tokenUsageEffective: '90k',
      tokenPercentageActual: '22%',
      tokenPercentageEffective: '45%',
      tokensStatus: 'normal' as const,
      cost: '$0.15',
      costStatus: 'normal' as const,
      duration: '12m',
      cwd: '~/project',
      branch: '',
      branchColor: '',
      displayMode: 'session_summary' as const,
      summary: 'Test',
      title: 'Test',
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
      personaName: '',
    }

    // Should not throw, should return text without color codes for model
    const result = formatter.format('{model}', viewModel)
    expect(result).toBe('claude-3-5-sonnet')
    expect(result).not.toContain('\x1b[')
  })

  it('skips colorization for empty summary text', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: true,
    })

    const viewModel = {
      model: 'claude-3-5-sonnet',
      contextWindow: '200k',
      tokenUsageActual: '45k',
      tokenUsageEffective: '90k',
      tokenPercentageActual: '22%',
      tokenPercentageEffective: '45%',
      tokensStatus: 'normal' as const,
      cost: '$0.15',
      costStatus: 'normal' as const,
      duration: '12m',
      cwd: '~/project',
      branch: '',
      branchColor: '',
      displayMode: 'session_summary' as const,
      summary: '',
      title: 'Test',
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
      personaName: '',
    }

    const result = formatter.format('{summary}', viewModel)
    // Empty summary should not have color codes
    expect(result).toBe('')
  })

  it('applies branch color based on pattern', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: true,
    })

    const viewModel = {
      model: 'claude-3-5-sonnet',
      contextWindow: '200k',
      tokenUsageActual: '45k',
      tokenUsageEffective: '90k',
      tokenPercentageActual: '22%',
      tokenPercentageEffective: '45%',
      tokensStatus: 'normal' as const,
      cost: '$0.15',
      costStatus: 'normal' as const,
      duration: '12m',
      cwd: '~/project',
      branch: '⎇ main',
      branchColor: 'green',
      displayMode: 'session_summary' as const,
      summary: 'Test',
      title: 'Test',
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
      personaName: '',
    }

    const result = formatter.format('{branch}', viewModel)
    expect(result).toContain(ANSI.green)
    expect(result).toContain('⎇ main')
  })
})

// ============================================================================
// Markdown to ANSI Conversion Tests
// ============================================================================

describe('Formatter.convertMarkdown', () => {
  const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    italic: '\x1b[3m',
    dim: '\x1b[2m',
    // Turn-off codes (preserve surrounding color)
    noBold: '\x1b[22m',
    noItalic: '\x1b[23m',
    noDim: '\x1b[22m',
  }

  it('converts **bold** to ANSI bold', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    const result = formatter.convertMarkdown('This is **bold** text')
    expect(result).toBe(`This is ${ANSI.bold}bold${ANSI.noBold} text`)
  })

  it('converts *italic* to ANSI italic', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    const result = formatter.convertMarkdown('This is *italic* text')
    expect(result).toBe(`This is ${ANSI.italic}italic${ANSI.noItalic} text`)
  })

  it('converts _italic_ to ANSI italic', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    const result = formatter.convertMarkdown('This is _italic_ text')
    expect(result).toBe(`This is ${ANSI.italic}italic${ANSI.noItalic} text`)
  })

  it('converts `code` to ANSI dim', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    const result = formatter.convertMarkdown('Run `npm install` command')
    expect(result).toBe(`Run ${ANSI.dim}npm install${ANSI.noDim} command`)
  })

  it('handles mixed markdown: **bold** and *italic*', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    const result = formatter.convertMarkdown('This is **bold** and *italic* text')
    expect(result).toBe(`This is ${ANSI.bold}bold${ANSI.noBold} and ${ANSI.italic}italic${ANSI.noItalic} text`)
  })

  it('handles multiple of same type: **a** **b**', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    const result = formatter.convertMarkdown('**first** and **second**')
    expect(result).toBe(`${ANSI.bold}first${ANSI.noBold} and ${ANSI.bold}second${ANSI.noBold}`)
  })

  it('leaves text unchanged when bold flag disabled', () => {
    const formatter = createFormatter({
      theme: {
        ...DEFAULT_STATUSLINE_CONFIG.theme,
        supportedMarkdown: { bold: false, italic: true, code: true },
      },
      useColors: false,
    })

    const result = formatter.convertMarkdown('This is **bold** text')
    expect(result).toBe('This is **bold** text')
  })

  it('leaves text unchanged when italic flag disabled', () => {
    const formatter = createFormatter({
      theme: {
        ...DEFAULT_STATUSLINE_CONFIG.theme,
        supportedMarkdown: { bold: true, italic: false, code: true },
      },
      useColors: false,
    })

    const result = formatter.convertMarkdown('This is *italic* text')
    expect(result).toBe('This is *italic* text')
  })

  it('leaves text unchanged when code flag disabled', () => {
    const formatter = createFormatter({
      theme: {
        ...DEFAULT_STATUSLINE_CONFIG.theme,
        supportedMarkdown: { bold: true, italic: true, code: false },
      },
      useColors: false,
    })

    const result = formatter.convertMarkdown('Run `npm install` command')
    expect(result).toBe('Run `npm install` command')
  })

  it('leaves text unchanged when all flags disabled', () => {
    const formatter = createFormatter({
      theme: {
        ...DEFAULT_STATUSLINE_CONFIG.theme,
        supportedMarkdown: { bold: false, italic: false, code: false },
      },
      useColors: false,
    })

    const result = formatter.convertMarkdown('**bold** *italic* `code`')
    expect(result).toBe('**bold** *italic* `code`')
  })

  it('handles empty string', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    const result = formatter.convertMarkdown('')
    expect(result).toBe('')
  })

  it('handles text without markdown', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    const result = formatter.convertMarkdown('Plain text without formatting')
    expect(result).toBe('Plain text without formatting')
  })

  it('does not convert single asterisk mid-word', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    // asterisk not at word boundary shouldn't be converted
    const result = formatter.convertMarkdown('file*name')
    expect(result).toBe('file*name')
  })

  it('converts markdown in summary field via format()', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    const viewModel = {
      model: 'claude',
      contextWindow: '200k',
      tokenUsageActual: '45k',
      tokenUsageEffective: '90k',
      tokenPercentageActual: '22%',
      tokenPercentageEffective: '45%',
      tokensStatus: 'normal' as const,
      cost: '$0.15',
      costStatus: 'normal' as const,
      duration: '12m',
      cwd: '~/project',
      branch: '',
      branchColor: '',
      displayMode: 'session_summary' as const,
      summary: 'Working on **important** stuff',
      title: 'Test',
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
      personaName: '',
    }

    const result = formatter.format('{summary}', viewModel)
    expect(result).toContain(ANSI.bold)
    expect(result).toContain('important')
  })

  it('converts markdown in title field via format()', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    const viewModel = {
      model: 'claude',
      contextWindow: '200k',
      tokenUsageActual: '45k',
      tokenUsageEffective: '90k',
      tokenPercentageActual: '22%',
      tokenPercentageEffective: '45%',
      tokensStatus: 'normal' as const,
      cost: '$0.15',
      costStatus: 'normal' as const,
      duration: '12m',
      cwd: '~/project',
      branch: '',
      branchColor: '',
      displayMode: 'session_summary' as const,
      summary: 'Test summary',
      title: 'Fix *critical* bug',
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
      personaName: '',
    }

    const result = formatter.format('{title}', viewModel)
    expect(result).toContain(ANSI.italic)
    expect(result).toContain('critical')
  })

  it('handles missing supportedMarkdown config (backwards compat)', () => {
    // Simulate old config without supportedMarkdown field
    const themeWithoutMarkdown = {
      useNerdFonts: true,
      colors: {
        model: 'blue',
        tokens: 'green',
        title: 'cyan',
        summary: 'magenta',
        cwd: 'white',
        duration: 'white',
      },
    } as typeof DEFAULT_STATUSLINE_CONFIG.theme

    const formatter = createFormatter({
      theme: themeWithoutMarkdown,
      useColors: false,
    })

    // Should not throw, should convert markdown with defaults (all enabled)
    const result = formatter.convertMarkdown('**bold** and *italic*')
    expect(result).toContain(ANSI.bold)
    expect(result).toContain(ANSI.italic)
  })
})

// ============================================================================
// StateReader Tests
// ============================================================================

describe('StateReader', () => {
  let stateDir: string
  let globalStateDir: string
  let sessionId: string
  let stateService: StateService

  beforeEach(async () => {
    const setup = await setupStateReaderTestDir()
    stateDir = setup.stateDir
    globalStateDir = setup.globalStateDir
    sessionId = setup.sessionId
    stateService = setup.stateService
  })

  it('returns default when file missing', async () => {
    const reader = createStateReader(stateService, sessionId)
    const result = await reader.getTranscriptMetrics()

    expect(result.source).toBe('default')
    expect(result.data.tokens.total).toBe(0)
  })

  it('reads valid session state', async () => {
    const state = createTestPersistedMetrics({ totalTokens: 45000 })
    await fs.writeFile(path.join(stateDir, 'transcript-metrics.json'), JSON.stringify(state))

    const reader = createStateReader(stateService, sessionId)
    const result = await reader.getTranscriptMetrics()

    expect(result.source).toBe('fresh')
    expect(result.data.tokens.total).toBe(45000)
    // Note: cost/duration/model come from hook metrics, not transcript-metrics.json
    // TranscriptMetricsState only contains token data
  })

  it('returns default for invalid JSON', async () => {
    await fs.writeFile(path.join(stateDir, 'transcript-metrics.json'), 'not json')

    const reader = createStateReader(stateService, sessionId)
    const result = await reader.getTranscriptMetrics()

    expect(result.source).toBe('default')
  })

  it('returns default for schema-invalid transcript metrics', async () => {
    // Valid JSON but doesn't match PersistedTranscriptStateSchema
    await fs.writeFile(path.join(stateDir, 'transcript-metrics.json'), JSON.stringify({ invalidField: 'value' }))

    const reader = createStateReader(stateService, sessionId)
    const result = await reader.getTranscriptMetrics()

    expect(result.source).toBe('default')
    expect(result.data.tokens.total).toBe(0)
  })

  it('reads snarky message', async () => {
    await fs.writeFile(
      path.join(stateDir, 'snarky-message.json'),
      JSON.stringify({ message: 'Time to debug!', timestamp: new Date().toISOString() })
    )

    const reader = createStateReader(stateService, sessionId)
    const result = await reader.getSnarkyMessage()

    expect(result.source).toBe('fresh')
    expect(result.data).toBe('Time to debug!')
  })

  it('reads session summary with valid data', async () => {
    await fs.writeFile(
      path.join(stateDir, 'session-summary.json'),
      JSON.stringify({
        session_id: 'test-123',
        timestamp: new Date().toISOString(),
        session_title: 'Working on tests',
        session_title_confidence: 0.85,
        latest_intent: 'Adding more coverage',
        latest_intent_confidence: 0.9,
      })
    )

    const reader = createStateReader(stateService, sessionId)
    const result = await reader.getSessionSummary()

    expect(result.source).toBe('fresh')
    expect(result.data.session_title).toBe('Working on tests')
    expect(result.data.latest_intent).toBe('Adding more coverage')
  })

  it('returns default for schema-invalid session summary', async () => {
    // Valid JSON but missing required fields
    await fs.writeFile(path.join(stateDir, 'session-summary.json'), JSON.stringify({ wrong_field: 'value' }))

    const reader = createStateReader(stateService, sessionId)
    const result = await reader.getSessionSummary()

    expect(result.source).toBe('default')
  })

  it('reads resume message with valid data', async () => {
    await fs.writeFile(
      path.join(stateDir, 'resume-message.json'),
      JSON.stringify({
        last_task_id: 'task-1',
        session_title: 'Previous Work',
        snarky_comment: 'Back for more?',
        timestamp: new Date().toISOString(),
      })
    )

    const reader = createStateReader(stateService, sessionId)
    const result = await reader.getResumeMessage()

    expect(result.source).toBe('fresh')
    expect(result.data?.session_title).toBe('Previous Work')
    expect(result.data?.snarky_comment).toBe('Back for more?')
  })

  it('returns default for schema-invalid resume message', async () => {
    // Valid JSON but missing required fields
    await fs.writeFile(path.join(stateDir, 'resume-message.json'), JSON.stringify({ invalid: true }))

    const reader = createStateReader(stateService, sessionId)
    const result = await reader.getResumeMessage()

    expect(result.source).toBe('default')
    expect(result.data).toBeNull()
  })

  describe('getLogMetrics', () => {
    it('returns default when no log files exist', async () => {
      const reader = createStateReader(stateService, sessionId)
      const result = await reader.getLogMetrics()

      expect(result.source).toBe('default')
      expect(result.data.warningCount).toBe(0)
      expect(result.data.errorCount).toBe(0)
    })

    it('reads daemon log metrics from valid file', async () => {
      await fs.writeFile(
        path.join(stateDir, 'daemon-log-metrics.json'),
        JSON.stringify({
          sessionId: 'test-123',
          warningCount: 5,
          errorCount: 2,
          lastUpdatedAt: Date.now(),
        })
      )

      const reader = createStateReader(stateService, sessionId)
      const result = await reader.getLogMetrics()

      expect(result.source).toBe('fresh')
      expect(result.data.warningCount).toBe(5)
      expect(result.data.errorCount).toBe(2)
    })

    it('reads CLI log metrics and sums with daemon metrics', async () => {
      await fs.writeFile(
        path.join(stateDir, 'daemon-log-metrics.json'),
        JSON.stringify({
          sessionId: 'test-123',
          warningCount: 3,
          errorCount: 1,
          lastUpdatedAt: Date.now(),
        })
      )
      await fs.writeFile(
        path.join(stateDir, 'cli-log-metrics.json'),
        JSON.stringify({
          sessionId: 'test-123',
          warningCount: 2,
          errorCount: 1,
          lastUpdatedAt: Date.now(),
        })
      )

      const reader = createStateReader(stateService, sessionId)
      const result = await reader.getLogMetrics()

      expect(result.source).toBe('fresh')
      expect(result.data.warningCount).toBe(5) // 3 + 2
      expect(result.data.errorCount).toBe(2) // 1 + 1
    })

    it('reads global daemon metrics from project state dir', async () => {
      // Write all three files explicitly with distinct values
      await fs.writeFile(
        path.join(stateDir, 'daemon-log-metrics.json'),
        JSON.stringify({
          sessionId: 'test-123',
          warningCount: 1,
          errorCount: 1,
          lastUpdatedAt: Date.now(),
        })
      )
      await fs.writeFile(
        path.join(stateDir, 'cli-log-metrics.json'),
        JSON.stringify({
          sessionId: 'test-123',
          warningCount: 2,
          errorCount: 0,
          lastUpdatedAt: Date.now(),
        })
      )
      await fs.writeFile(
        path.join(globalStateDir, 'daemon-global-log-metrics.json'),
        JSON.stringify({
          sessionId: '',
          warningCount: 3,
          errorCount: 2,
          lastUpdatedAt: Date.now(),
        })
      )

      const reader = createStateReader(stateService, sessionId)
      const result = await reader.getLogMetrics()

      expect(result.source).toBe('fresh')
      expect(result.data.warningCount).toBe(6) // 1 (daemon) + 2 (cli) + 3 (global)
      expect(result.data.errorCount).toBe(3) // 1 (daemon) + 0 (cli) + 2 (global)
    })

    it('returns stale when log metrics are old', async () => {
      const twoMinutesAgo = Date.now() - 120_000
      await fs.writeFile(
        path.join(stateDir, 'daemon-log-metrics.json'),
        JSON.stringify({
          sessionId: 'test-123',
          warningCount: 1,
          errorCount: 1,
          lastUpdatedAt: twoMinutesAgo,
        })
      )

      const reader = createStateReader(stateService, sessionId)
      const result = await reader.getLogMetrics()

      expect(result.source).toBe('stale')
    })

    it('returns default for invalid log metrics JSON', async () => {
      // Write invalid JSON to both log metrics files to ensure combined result is 'default'
      await fs.writeFile(path.join(stateDir, 'daemon-log-metrics.json'), 'not valid json')
      await fs.writeFile(path.join(stateDir, 'cli-log-metrics.json'), 'not valid json')

      const reader = createStateReader(stateService, sessionId)
      const result = await reader.getLogMetrics()

      expect(result.source).toBe('default')
      expect(result.data.warningCount).toBe(0)
      expect(result.data.errorCount).toBe(0)
    })

    it('returns default for schema-invalid log metrics', async () => {
      await fs.writeFile(path.join(stateDir, 'daemon-log-metrics.json'), JSON.stringify({ wrongField: 'value' }))

      const reader = createStateReader(stateService, sessionId)
      const result = await reader.getLogMetrics()

      expect(result.source).toBe('default')
    })
  })
})

// ============================================================================
// discoverPreviousResumeMessage Tests
// ============================================================================

describe('discoverPreviousResumeMessage', () => {
  let projectRoot: string
  let sessionsDir: string

  beforeEach(async () => {
    // Create proper project structure: <projectRoot>/.sidekick/sessions/
    // discoverPreviousResumeMessage expects sessionsDir to be at this location
    // so it can compute projectRoot as path.dirname(path.dirname(sessionsDir))
    projectRoot = path.join(tmpdir(), `discover-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    sessionsDir = path.join(projectRoot, '.sidekick', 'sessions')
    await fs.mkdir(sessionsDir, { recursive: true })
  })

  it('returns not_found when sessions directory is empty', async () => {
    const result = await discoverPreviousResumeMessage(sessionsDir, 'current-session')

    expect(result.source).toBe('not_found')
    expect(result.data).toBeNull()
    expect(result.sessionId).toBeNull()
  })

  it('returns not_found when only current session exists', async () => {
    // Create current session with resume message
    const currentDir = path.join(sessionsDir, 'current-session', 'state')
    await fs.mkdir(currentDir, { recursive: true })
    await fs.writeFile(
      path.join(currentDir, 'resume-message.json'),
      JSON.stringify({
        last_task_id: null,
        session_title: 'Current Session',
        snarky_comment: 'Hello!',
        timestamp: new Date().toISOString(),
      })
    )

    const result = await discoverPreviousResumeMessage(sessionsDir, 'current-session')

    expect(result.source).toBe('not_found')
    expect(result.data).toBeNull()
  })

  it('discovers resume message from previous session', async () => {
    // Create previous session with resume message
    const prevDir = path.join(sessionsDir, 'prev-session', 'state')
    await fs.mkdir(prevDir, { recursive: true })
    await fs.writeFile(
      path.join(prevDir, 'resume-message.json'),
      JSON.stringify({
        last_task_id: 'task-123',
        session_title: 'Auth Refactor',
        snarky_comment: 'Back for more punishment?',
        timestamp: '2024-01-15T10:30:00Z',
      })
    )

    const result = await discoverPreviousResumeMessage(sessionsDir, 'current-session')

    expect(result.source).toBe('discovered')
    expect(result.sessionId).toBe('prev-session')
    expect(result.data?.snarky_comment).toBe('Back for more punishment?')
  })

  it('returns most recent resume message when multiple exist', async () => {
    // Create older session
    const olderDir = path.join(sessionsDir, 'older-session', 'state')
    await fs.mkdir(olderDir, { recursive: true })
    const olderFile = path.join(olderDir, 'resume-message.json')
    await fs.writeFile(
      olderFile,
      JSON.stringify({
        last_task_id: null,
        session_title: 'Older Session',
        snarky_comment: 'Old news',
        timestamp: '2024-01-10T10:00:00Z',
      })
    )
    // Implementation note: discoverPreviousResumeMessage uses file mtime for ordering.
    // This is an implementation detail (could change to use JSON timestamp field).
    // This test verifies the current behavior but may need updating if the ordering
    // mechanism changes. Platform-specific mtime behavior is generally reliable.
    const oldTime = new Date(Date.now() - 3600_000)
    await fs.utimes(olderFile, oldTime, oldTime)

    // Create newer session
    const newerDir = path.join(sessionsDir, 'newer-session', 'state')
    await fs.mkdir(newerDir, { recursive: true })
    await fs.writeFile(
      path.join(newerDir, 'resume-message.json'),
      JSON.stringify({
        last_task_id: null,
        session_title: 'Newer Session',
        snarky_comment: 'Fresh content',
        timestamp: '2024-01-15T10:00:00Z',
      })
    )

    const result = await discoverPreviousResumeMessage(sessionsDir, 'current-session')

    expect(result.source).toBe('discovered')
    expect(result.sessionId).toBe('newer-session')
  })

  it('skips sessions with invalid resume-message.json', async () => {
    // Create session with invalid JSON
    const invalidDir = path.join(sessionsDir, 'invalid-session', 'state')
    await fs.mkdir(invalidDir, { recursive: true })
    await fs.writeFile(path.join(invalidDir, 'resume-message.json'), 'not valid json')

    // Create session with valid JSON
    const validDir = path.join(sessionsDir, 'valid-session', 'state')
    await fs.mkdir(validDir, { recursive: true })
    await fs.writeFile(
      path.join(validDir, 'resume-message.json'),
      JSON.stringify({
        last_task_id: null,
        session_title: 'Valid Session',
        snarky_comment: 'Works!',
        timestamp: new Date().toISOString(),
      })
    )

    const result = await discoverPreviousResumeMessage(sessionsDir, 'current-session')

    expect(result.source).toBe('discovered')
    expect(result.sessionId).toBe('valid-session')
  })

  it('skips sessions without resume-message.json', async () => {
    // Create session without resume message
    const noResumeDir = path.join(sessionsDir, 'no-resume-session', 'state')
    await fs.mkdir(noResumeDir, { recursive: true })
    await fs.writeFile(path.join(noResumeDir, 'session-state.json'), '{}')

    // Create session with resume message
    const withResumeDir = path.join(sessionsDir, 'with-resume-session', 'state')
    await fs.mkdir(withResumeDir, { recursive: true })
    await fs.writeFile(
      path.join(withResumeDir, 'resume-message.json'),
      JSON.stringify({
        last_task_id: null,
        session_title: 'Has Resume Session',
        snarky_comment: 'Found me!',
        timestamp: new Date().toISOString(),
      })
    )

    const result = await discoverPreviousResumeMessage(sessionsDir, 'current-session')

    expect(result.source).toBe('discovered')
    expect(result.sessionId).toBe('with-resume-session')
  })

  it('returns not_found when all sessions have invalid resume messages', async () => {
    // Create sessions with invalid (schema-mismatch) resume messages
    const invalidDir1 = path.join(sessionsDir, 'invalid-session-1', 'state')
    await fs.mkdir(invalidDir1, { recursive: true })
    await fs.writeFile(
      path.join(invalidDir1, 'resume-message.json'),
      JSON.stringify({ wrongField: 'value' }) // Invalid schema
    )

    const invalidDir2 = path.join(sessionsDir, 'invalid-session-2', 'state')
    await fs.mkdir(invalidDir2, { recursive: true })
    await fs.writeFile(
      path.join(invalidDir2, 'resume-message.json'),
      JSON.stringify({ anotherWrongField: 123 }) // Invalid schema
    )

    const result = await discoverPreviousResumeMessage(sessionsDir, 'current-session')

    expect(result.source).toBe('not_found')
    expect(result.data).toBeNull()
    expect(result.sessionId).toBeNull()
  })

  it('returns not_found when sessions directory does not exist', async () => {
    const result = await discoverPreviousResumeMessage('/nonexistent/path', 'current')

    expect(result.source).toBe('not_found')
    expect(result.data).toBeNull()
  })
})

// ============================================================================
// GitProvider Tests
// ============================================================================

describe('GitProvider', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `git-provider-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
  })

  it('returns git source with branch name in a git repository', async () => {
    // Initialize a git repo in temp dir
    const { execSync } = await import('node:child_process')
    execSync('git init', { cwd: testDir, stdio: 'ignore' })
    execSync('git checkout -b test-branch', { cwd: testDir, stdio: 'ignore' })

    const { createGitProvider } = await import('../git-provider.js')
    const provider = createGitProvider(testDir, { timeoutMs: 1000 })
    const result = await provider.getCurrentBranch()

    expect(result.source).toBe('git')
    expect(result.branch).toBe('test-branch')
  })

  it('returns error source when not a git repository', async () => {
    const { createGitProvider } = await import('../git-provider.js')
    const provider = createGitProvider(testDir, { timeoutMs: 1000 })
    const result = await provider.getCurrentBranch()

    expect(result.source).toBe('error')
    expect(result.branch).toBe('')
  })

  // Note: Timeout behavior is not tested here because it requires external control
  // over git command timing. The timeout functionality is an implementation detail
  // that guards against hung processes. Testing it reliably would require a fake
  // git provider that never resolves, which would test the wrapper, not git-provider.
})

// ============================================================================
// StatuslineService Tests
// ============================================================================

describe('StatuslineService', () => {
  let projectRoot: string
  let stateDir: string
  let sessionId: string
  let stateService: StateService
  let setupService: MockSetupStatusService

  beforeEach(async () => {
    const setup = await setupStateReaderTestDir()
    projectRoot = setup.projectRoot
    stateDir = setup.stateDir
    sessionId = setup.sessionId
    stateService = setup.stateService
    setupService = setup.setupService
  })

  it('renders with default values when no state files', async () => {
    const service = createStatuslineService({
      stateService,
      setupService,
      sessionId,
      cwd: '/home/user/project',
      homeDir: '/home/user',
      useColors: false,
    })

    const result = await service.render()

    expect(result.displayMode).toBe('empty_summary')
    expect(result.viewModel.summary).toBe('New Session')
  })

  it('renders session summary when available', async () => {
    // Write session state
    await fs.writeFile(
      path.join(stateDir, 'transcript-metrics.json'),
      JSON.stringify({
        sessionId: 'test-123',
        metrics: {
          turnCount: 1,
          toolsThisTurn: 0,
          toolCount: 0,
          messageCount: 2,
          tokenUsage: {
            inputTokens: 30000,
            outputTokens: 15000,
            totalTokens: 45000,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
          },
          currentContextTokens: 45000,
          isPostCompactIndeterminate: false,
          toolsPerTurn: 0,
          lastProcessedLine: 2,
          lastUpdatedAt: Date.now(),
        },
        persistedAt: Date.now(),
      })
    )

    // Write session summary
    await fs.writeFile(
      path.join(stateDir, 'session-summary.json'),
      JSON.stringify({
        session_id: 'test-123',
        timestamp: new Date().toISOString(),
        session_title: 'Auth bug fix',
        session_title_confidence: 0.9,
        latest_intent: 'Fixing authentication issue',
        latest_intent_confidence: 0.85,
      })
    )

    const service = createStatuslineService({
      stateService,
      setupService,
      sessionId,
      cwd: '/home/user/project',
      homeDir: '/home/user',
      useColors: false,
      // Model comes from hook input, not transcript-metrics.json
      hookInput: createTestHookInput({
        modelDisplayName: 'claude-3-5-sonnet',
        totalInputTokens: 30000,
        totalOutputTokens: 15000,
        cwd: '/home/user/project',
      }),
    })

    const result = await service.render()

    expect(result.displayMode).toBe('session_summary')
    expect(result.viewModel.model).toBe('3-5-sonnet')
    // Token display format: tokenUsageActual = context, tokenUsageEffective = context + buffer
    // - tokenUsageActual = 30k (from totalInputTokens in hookInput)
    // - tokenUsageEffective = 30k + ~45k buffer = 75k
    // This test implicitly depends on the default autocompact buffer value.
    // If defaults change in @sidekick/types, update expected total accordingly.
    expect(result.viewModel.tokenUsageActual).toBe('30k')
    expect(result.viewModel.tokenUsageEffective).toBe('75k')
    expect(result.viewModel.title).toBe('Auth bug fix')
  })

  it('prefers snarky message over intent', async () => {
    await fs.writeFile(
      path.join(stateDir, 'session-summary.json'),
      JSON.stringify({
        session_id: 'test-123',
        timestamp: new Date().toISOString(),
        session_title: 'Auth bug fix',
        session_title_confidence: 0.9,
        latest_intent: 'Fixing auth',
        latest_intent_confidence: 0.85,
      })
    )
    await fs.writeFile(
      path.join(stateDir, 'snarky-message.json'),
      JSON.stringify({ message: 'Battling the auth gremlins!', timestamp: new Date().toISOString() })
    )

    const service = createStatuslineService({
      stateService,
      setupService,
      sessionId,
      cwd: '/test',
      useColors: false,
    })

    const result = await service.render()

    expect(result.viewModel.summary).toBe('Battling the auth gremlins!')
  })

  it('appends (stale) indicator when data is stale', async () => {
    // Write state file with old persistedAt timestamp (simulate stale data)
    // Staleness is now based on persistedAt in the content, not file mtime
    const twoMinutesAgo = Date.now() - 120_000
    const stateFile = path.join(stateDir, 'transcript-metrics.json')
    const state = createTestPersistedMetrics({ totalTokens: 1000, persistedAt: twoMinutesAgo })
    await fs.writeFile(stateFile, JSON.stringify(state))

    const service = createStatuslineService({
      stateService,
      setupService,
      sessionId,
      cwd: '/test',
      useColors: false,
    })

    const result = await service.render()

    expect(result.staleData).toBe(true)
    expect(result.text).toContain('(stale)')
  })

  it('does not append (stale) when data is fresh', async () => {
    const state = createTestPersistedMetrics({ totalTokens: 1000 })
    await fs.writeFile(path.join(stateDir, 'transcript-metrics.json'), JSON.stringify(state))

    const service = createStatuslineService({
      stateService,
      setupService,
      sessionId,
      cwd: '/test',
      useColors: false,
    })

    const result = await service.render()

    expect(result.staleData).toBe(false)
    expect(result.text).not.toContain('(stale)')
  })

  describe('formatModelName edge cases', () => {
    it('returns non-claude model names unchanged', async () => {
      // Model name comes from hook input, not transcript-metrics.json
      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        hookInput: createTestHookInput({
          modelDisplayName: 'gpt-4o',
          totalInputTokens: 1000,
          totalOutputTokens: 0,
        }),
      })

      const result = await service.render()
      expect(result.viewModel.model).toBe('gpt-4o')
    })

    it('strips claude- prefix from claude model names', async () => {
      // Model name comes from hook input, not transcript-metrics.json
      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        hookInput: createTestHookInput({
          modelDisplayName: 'claude-3-opus',
          totalInputTokens: 1000,
          totalOutputTokens: 0,
        }),
      })

      const result = await service.render()
      expect(result.viewModel.model).toBe('3-opus')
    })
  })

  describe('artifact discovery for new sessions', () => {
    let discoveryProjectRoot: string
    let sessionsDir: string
    let discoveryStateService: StateService

    beforeEach(async () => {
      // Set up project structure for discovery tests
      discoveryProjectRoot = path.join(
        tmpdir(),
        `discovery-project-${Date.now()}-${Math.random().toString(36).slice(2)}`
      )
      sessionsDir = path.join(discoveryProjectRoot, '.sidekick', 'sessions')
      await fs.mkdir(sessionsDir, { recursive: true })
      discoveryStateService = new StateService(discoveryProjectRoot)
    })

    it('discovers resume message from previous session when current has no summary', async () => {
      const currentSessionId = 'current-session'
      const currentStateDir = path.join(sessionsDir, currentSessionId, 'state')
      await fs.mkdir(currentStateDir, { recursive: true })

      // Create previous session with resume message
      const prevDir = path.join(sessionsDir, 'prev-session', 'state')
      await fs.mkdir(prevDir, { recursive: true })
      await fs.writeFile(
        path.join(prevDir, 'resume-message.json'),
        JSON.stringify({
          last_task_id: null,
          session_title: 'Feature X',
          snarky_comment: 'Back for more?',
          timestamp: new Date().toISOString(),
        })
      )

      const service = createStatuslineService({
        stateService: discoveryStateService,
        setupService: createMockSetupService(),
        sessionId: currentSessionId,
        cwd: '/test',
        useColors: false,
        sessionsDir,
      })

      const result = await service.render()

      // Should discover and display the previous session's resume message
      // title includes "Last Session:" prefix, summary from snarky_comment
      expect(result.displayMode).toBe('resume_message')
      expect(result.viewModel.title).toBe('Last Session: Feature X')
      expect(result.viewModel.summary).toBe('Back for more?')
    })

    it('does not discover when current session has a summary', async () => {
      const currentSessionId = 'current-session'
      const currentStateDir = path.join(sessionsDir, currentSessionId, 'state')
      await fs.mkdir(currentStateDir, { recursive: true })

      // Current session has a summary
      await fs.writeFile(
        path.join(currentStateDir, 'session-summary.json'),
        JSON.stringify({
          session_id: currentSessionId,
          timestamp: new Date().toISOString(),
          session_title: 'Current work',
          session_title_confidence: 0.9,
          latest_intent: 'Doing stuff',
          latest_intent_confidence: 0.85,
        })
      )

      // Previous session has resume message
      const prevDir = path.join(sessionsDir, 'prev-session', 'state')
      await fs.mkdir(prevDir, { recursive: true })
      await fs.writeFile(
        path.join(prevDir, 'resume-message.json'),
        JSON.stringify({
          last_task_id: null,
          session_title: 'Old Work Session',
          snarky_comment: 'Old stuff',
          timestamp: new Date().toISOString(),
        })
      )

      const service = createStatuslineService({
        stateService: discoveryStateService,
        setupService: createMockSetupService(),
        sessionId: currentSessionId,
        cwd: '/test',
        useColors: false,
        sessionsDir,
      })

      const result = await service.render()

      // Should use current session's summary, not discover previous
      expect(result.displayMode).toBe('session_summary')
      expect(result.viewModel.title).toBe('Current work')
    })

    it('falls back gracefully when discovery config not provided', async () => {
      // No sessionsDir or currentSessionId provided
      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
      })

      const result = await service.render()

      // Should work normally without discovery
      expect(result.displayMode).toBe('empty_summary')
    })
  })

  describe('hook input edge cases', () => {
    it('uses transcript metrics when hook current_usage is null', async () => {
      // Write transcript metrics with currentContextTokens
      const state = createTestPersistedMetrics({ totalTokens: 70000, currentContextTokens: 55000 })
      await fs.writeFile(path.join(stateDir, 'transcript-metrics.json'), JSON.stringify(state))

      // Create hook input with null current_usage
      const hookInput: ClaudeCodeStatusInput = {
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.json',
        cwd: '/test',
        version: '1.0.0',
        model: { id: 'claude-opus-4-1', display_name: 'Opus' },
        workspace: { current_dir: '/test', project_dir: '/test' },
        output_style: { name: 'default' },
        cost: {
          total_cost_usd: 0.5,
          total_duration_ms: 60000,
          total_api_duration_ms: 30000,
          total_lines_added: 100,
          total_lines_removed: 20,
        },
        context_window: {
          total_input_tokens: 50000,
          total_output_tokens: 20000,
          context_window_size: 200000,
          current_usage: null, // null current_usage
        },
      }

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        hookInput,
      })

      const result = await service.render()

      // Should fall back to transcript metrics currentContextTokens
      expect(result.viewModel.tokenUsageActual).toContain('55k')
    })

    it('uses baseline when hook current_usage is zero and no transcript data', async () => {
      // No transcript metrics file - will return empty state
      const hookInput: ClaudeCodeStatusInput = {
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.json',
        cwd: '/test',
        version: '1.0.0',
        model: { id: 'claude-opus-4-1', display_name: 'Opus' },
        workspace: { current_dir: '/test', project_dir: '/test' },
        output_style: { name: 'default' },
        cost: {
          total_cost_usd: 0,
          total_duration_ms: 0,
          total_api_duration_ms: 0,
          total_lines_added: 0,
          total_lines_removed: 0,
        },
        context_window: {
          total_input_tokens: 0,
          total_output_tokens: 0,
          context_window_size: 200000,
          current_usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      }

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        hookInput,
      })

      const result = await service.render()

      // Should use baseline metrics (non-zero tokens from system defaults)
      expect(result.viewModel.tokenUsageActual).not.toBe('0')
    })

    it('falls back to baseline when null current_usage and transcript has zero tokens', async () => {
      // Transcript with zero currentContextTokens
      await fs.writeFile(
        path.join(stateDir, 'transcript-metrics.json'),
        JSON.stringify({
          sessionId: 'test-123',
          metrics: {
            turnCount: 0,
            toolsThisTurn: 0,
            toolCount: 0,
            messageCount: 0,
            tokenUsage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              cacheCreationInputTokens: 0,
              cacheReadInputTokens: 0,
            },
            currentContextTokens: 0,
            isPostCompactIndeterminate: false,
            toolsPerTurn: 0,
            lastProcessedLine: 0,
            lastUpdatedAt: Date.now(),
          },
          persistedAt: Date.now(),
        })
      )

      const hookInput: ClaudeCodeStatusInput = {
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.json',
        cwd: '/test',
        version: '1.0.0',
        model: { id: 'claude-opus-4-1', display_name: 'Opus' },
        workspace: { current_dir: '/test', project_dir: '/test' },
        output_style: { name: 'default' },
        cost: {
          total_cost_usd: 0,
          total_duration_ms: 0,
          total_api_duration_ms: 0,
          total_lines_added: 0,
          total_lines_removed: 0,
        },
        context_window: {
          total_input_tokens: 0,
          total_output_tokens: 0,
          context_window_size: 200000,
          current_usage: null,
        },
      }

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        hookInput,
      })

      const result = await service.render()
      // Should use baseline (not show 0)
      expect(result.viewModel.tokenUsageActual).not.toBe('0')
    })

    it('shows post-compact indeterminate status', async () => {
      // Write transcript with isPostCompactIndeterminate: true
      // Note: This tests the no-hookInput path since isPostCompactIndeterminate
      // only comes from transcript metrics state, not from Claude Code hook input
      const state = createTestPersistedMetrics({ totalTokens: 1000, isPostCompactIndeterminate: true })
      await fs.writeFile(path.join(stateDir, 'transcript-metrics.json'), JSON.stringify(state))

      // No hookInput - uses transcript state directly which includes isPostCompactIndeterminate
      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        // No hookInput
      })

      const result = await service.render()

      expect(result.viewModel.tokenUsageActual).toBe('⟳ compacted')
      expect(result.viewModel.tokensStatus).toBe('normal')
    })
  })

  describe('stale indicator with colors', () => {
    it('applies dim ANSI formatting to stale indicator when colors enabled', async () => {
      const twoMinutesAgo = Date.now() - 120_000
      const state = createTestPersistedMetrics({ totalTokens: 1000, persistedAt: twoMinutesAgo })
      await fs.writeFile(path.join(stateDir, 'transcript-metrics.json'), JSON.stringify(state))

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: true, // Enable colors
      })

      const result = await service.render()

      expect(result.staleData).toBe(true)
      // Should have dim ANSI code for stale indicator
      expect(result.text).toContain('\x1b[2m(stale)\x1b[0m')
    })
  })

  describe('configService usage', () => {
    it('uses configService settings when provided', async () => {
      const mockConfigService = {
        core: { logging: { level: 'info', components: {} }, development: { enabled: false } },
        llm: { defaultProfile: 'default', profiles: {}, fallbacks: {} },
        getAll: () => ({}),
        getFeature: <T>(name: string): { enabled: boolean; settings: T } => {
          if (name === 'statusline') {
            return {
              enabled: true,
              settings: {
                theme: {
                  ...DEFAULT_STATUSLINE_CONFIG.theme,
                  useNerdFonts: true,
                },
              } as T,
            }
          }
          return { enabled: true, settings: {} as T }
        },
      }

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        configService: mockConfigService,
      })

      const result = await service.render()
      expect(result.displayMode).toBe('empty_summary')
    })
  })

  describe('log status in viewModel', () => {
    it('shows critical log status when errors exceed threshold', async () => {
      await fs.writeFile(
        path.join(stateDir, 'daemon-log-metrics.json'),
        JSON.stringify({
          sessionId: 'test-123',
          warningCount: 0,
          errorCount: 5, // Above default critical threshold of 1
          lastUpdatedAt: Date.now(),
        })
      )

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        hookInput: createTestHookInput({}),
      })

      const result = await service.render()

      expect(result.viewModel.logStatus).toBe('critical')
      expect(result.viewModel.errorCount).toBe(5)
    })

    it('shows warning log status when warnings exceed threshold', async () => {
      await fs.writeFile(
        path.join(stateDir, 'daemon-log-metrics.json'),
        JSON.stringify({
          sessionId: 'test-123',
          warningCount: 10, // Above default warning threshold
          errorCount: 0,
          lastUpdatedAt: Date.now(),
        })
      )

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        hookInput: createTestHookInput({}),
      })

      const result = await service.render()

      expect(result.viewModel.logStatus).toBe('warning')
      expect(result.viewModel.warningCount).toBe(10)
    })
  })

  describe('logger debug output', () => {
    /** Create a mock logger that captures debug messages */
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    function createMockLogger() {
      const logMessages: string[] = []

      const mockLogger: any = {
        debug: (msg: string) => {
          logMessages.push(msg)
        },
        info: () => {},
        warn: () => {},
        error: () => {},
        trace: () => {},
        fatal: () => {},
        child: () => mockLogger,
        flush: async () => {},
      }
      return { logger: mockLogger, messages: logMessages }
    }

    it('logs baseline metrics when using baseline fallback', async () => {
      const { logger: mockLogger, messages: logMessages } = createMockLogger()

      // Hook input with zero tokens - will trigger baseline fallback
      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        logger: mockLogger,
        hookInput: createTestHookInput({
          totalInputTokens: 0,
          totalOutputTokens: 0,
        }),
      })

      await service.render()

      // Should have logged about token calculation
      expect(logMessages.some((m) => m.includes('token calculation'))).toBe(true)
    })

    it('logs transcript metrics when falling back to transcript data', async () => {
      const { logger: mockLogger, messages: logMessages } = createMockLogger()

      // Write transcript with currentContextTokens
      await fs.writeFile(
        path.join(stateDir, 'transcript-metrics.json'),
        JSON.stringify({
          sessionId: 'test-123',
          metrics: {
            turnCount: 1,
            toolsThisTurn: 0,
            toolCount: 0,
            messageCount: 1,
            tokenUsage: {
              inputTokens: 30000,
              outputTokens: 10000,
              totalTokens: 40000,
              cacheCreationInputTokens: 0,
              cacheReadInputTokens: 0,
            },
            currentContextTokens: 35000,
            isPostCompactIndeterminate: false,
            toolsPerTurn: 0,
            lastProcessedLine: 1,
            lastUpdatedAt: Date.now(),
          },
          persistedAt: Date.now(),
        })
      )

      // Hook input with null current_usage - will fall back to transcript
      const hookInput: ClaudeCodeStatusInput = {
        hook_event_name: 'Status',
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.json',
        cwd: '/test',
        version: '1.0.0',
        model: { id: 'claude-opus-4-1', display_name: 'Opus' },
        workspace: { current_dir: '/test', project_dir: '/test' },
        output_style: { name: 'default' },
        cost: {
          total_cost_usd: 0,
          total_duration_ms: 0,
          total_api_duration_ms: 0,
          total_lines_added: 0,
          total_lines_removed: 0,
        },
        context_window: {
          total_input_tokens: 0,
          total_output_tokens: 0,
          context_window_size: 200000,
          current_usage: null,
        },
      }

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        logger: mockLogger,
        hookInput,
      })

      await service.render()

      // Should have logged about token calculation
      expect(logMessages.some((m) => m.includes('token calculation'))).toBe(true)
    })
  })

  describe('resume message edge cases', () => {
    it('uses default title when resume message has no session_title', async () => {
      await fs.writeFile(
        path.join(stateDir, 'resume-message.json'),
        JSON.stringify({
          last_task_id: 'task-1',
          session_title: '', // Empty session title
          snarky_comment: 'Welcome back!',
          timestamp: new Date().toISOString(),
        })
      )

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        isResumedSession: true,
      })

      const result = await service.render()

      expect(result.displayMode).toBe('resume_message')
      expect(result.viewModel.title).toBe('New Session') // Falls back to default
      expect(result.viewModel.summary).toBe('Welcome back!')
    })

    it('uses emptySessionMessage when resume has no snarky_comment', async () => {
      await fs.writeFile(
        path.join(stateDir, 'resume-message.json'),
        JSON.stringify({
          last_task_id: 'task-1',
          session_title: 'Previous Work',
          snarky_comment: '', // Empty snarky comment
          timestamp: new Date().toISOString(),
        })
      )

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        isResumedSession: true,
      })

      const result = await service.render()

      expect(result.displayMode).toBe('resume_message')
      // Summary should fall back to emptySessionMessage (default: "New Session")
      expect(result.viewModel.summary).toBe('New Session')
    })
  })

  describe('display mode determination', () => {
    it('returns session_summary when title matches DEFAULT_PLACEHOLDERS.newSession', async () => {
      // Session summary with "New Session" title should still be treated as empty
      await fs.writeFile(
        path.join(stateDir, 'session-summary.json'),
        JSON.stringify({
          session_id: 'test-123',
          timestamp: new Date().toISOString(),
          session_title: 'New Session',
          session_title_confidence: 0,
          latest_intent: 'Awaiting first turn...',
          latest_intent_confidence: 0,
        })
      )

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
      })

      const result = await service.render()

      // Should be empty_summary because title is placeholder
      expect(result.displayMode).toBe('empty_summary')
    })

    it('returns resume_message when resumed session has resume message', async () => {
      await fs.writeFile(
        path.join(stateDir, 'resume-message.json'),
        JSON.stringify({
          last_task_id: 'task-1',
          session_title: 'Previous Work',
          snarky_comment: 'Welcome back!',
          timestamp: new Date().toISOString(),
        })
      )

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        isResumedSession: true, // Mark as resumed
      })

      const result = await service.render()

      expect(result.displayMode).toBe('resume_message')
      expect(result.viewModel.title).toBe('Last Session: Previous Work')
      expect(result.viewModel.summary).toBe('Welcome back!')
    })

    it('shows latest_intent when no snarky message available', async () => {
      await fs.writeFile(
        path.join(stateDir, 'session-summary.json'),
        JSON.stringify({
          session_id: 'test-123',
          timestamp: new Date().toISOString(),
          session_title: 'Auth Bug Fix',
          session_title_confidence: 0.9,
          latest_intent: 'Debugging authentication flow',
          latest_intent_confidence: 0.85,
        })
      )
      // No snarky-message.json file

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
      })

      const result = await service.render()

      expect(result.displayMode).toBe('session_summary')
      expect(result.viewModel.summary).toBe('Debugging authentication flow')
    })
  })

  describe('random empty session messages', () => {
    /** Create a mock asset resolver that returns content for a specific path */
    function createMockAssets(content: string | null): MinimalAssetResolver {
      return {
        cascadeLayers: ['mock'],
        resolve: (relativePath: string): string | null => {
          if (relativePath === 'defaults/features/statusline-empty-messages.txt') {
            return content
          }
          return null
        },
      }
    }

    it('uses placeholder when no persona is selected (persona system behavior)', async () => {
      // When no persona is selected, empty session messages come from SESSION_SUMMARY_PLACEHOLDERS
      // rather than random messages from assets. This is per docs/design/PERSONA-PROFILES-DESIGN.md §4.
      // Assets are only used as fallback when a persona IS selected but has no statusline_empty_messages.
      const messages = ['Message one', 'Message two', 'Message three']
      const assets = createMockAssets(messages.join('\n'))

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        assets,
      })

      const result = await service.render()

      expect(result.displayMode).toBe('empty_summary')
      // No persona state = placeholder, not random asset message
      expect(result.viewModel.summary).toBe('New Session')
    })

    it('falls back to default when assets not provided', async () => {
      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        // no assets
      })

      const result = await service.render()

      expect(result.displayMode).toBe('empty_summary')
      expect(result.viewModel.summary).toBe('New Session')
    })

    it('falls back to default when messages file is missing', async () => {
      const assets = createMockAssets(null) // file not found

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        assets,
      })

      const result = await service.render()

      expect(result.displayMode).toBe('empty_summary')
      expect(result.viewModel.summary).toBe('New Session')
    })

    it('falls back to default when messages file is empty', async () => {
      const assets = createMockAssets('')

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        assets,
      })

      const result = await service.render()

      expect(result.displayMode).toBe('empty_summary')
      expect(result.viewModel.summary).toBe('New Session')
    })

    it('uses placeholder when no persona - blank lines in asset file are irrelevant', async () => {
      // Per persona system, when no persona is selected, we use placeholders not assets.
      // The blank line handling is still in place but only applies when a persona exists
      // without its own statusline_empty_messages.
      const messages = ['Message one', '', '  ', 'Message two']
      const assets = createMockAssets(messages.join('\n'))

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        assets,
      })

      const result = await service.render()

      // No persona state = placeholder, not random asset message
      expect(result.viewModel.summary).toBe('New Session')
    })

    it('uses same message for entire service instance', async () => {
      // Contract test: Random message is chosen at service construction, not per-render.
      // This prevents UI flickering when the statusline refreshes multiple times.
      // Users see the same "New Session" message until they actually start working.
      const messages = ['A', 'B', 'C', 'D', 'E']
      const assets = createMockAssets(messages.join('\n'))

      const service = createStatuslineService({
        stateService,
        setupService,
        sessionId,
        cwd: '/test',
        useColors: false,
        assets,
      })

      // Multiple renders should return the same message
      const result1 = await service.render()
      const result2 = await service.render()
      const result3 = await service.render()

      expect(result1.viewModel.summary).toBe(result2.viewModel.summary)
      expect(result2.viewModel.summary).toBe(result3.viewModel.summary)
    })
  })
})
