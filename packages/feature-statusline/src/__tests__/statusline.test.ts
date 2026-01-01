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
  formatCost,
  formatDuration,
  formatTokens,
  getBranchColor,
  getThresholdStatus,
  shortenPath,
} from '../formatter.js'
import { getDefaultOverhead } from '../context-overhead-reader.js'
import { createStateReader, discoverPreviousResumeMessage } from '../state-reader.js'
import { createStatuslineService, type ClaudeCodeStatusInput } from '../statusline-service.js'
import { DEFAULT_STATUSLINE_CONFIG } from '../types.js'

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
  })

  describe('formatBranch', () => {
    it('returns empty string for empty branch', () => {
      expect(formatBranch('', true)).toBe('')
    })

    it('formats branch with ⎇ icon', () => {
      expect(formatBranch('main', true)).toBe('⎇ main')
      expect(formatBranch('main', false)).toBe('⎇ main')
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
})

describe('getDefaultOverhead', () => {
  it('returns expected default values', () => {
    const overhead = getDefaultOverhead()
    expect(overhead.systemPromptTokens).toBe(3200)
    expect(overhead.systemToolsTokens).toBe(17900)
    expect(overhead.autocompactBufferTokens).toBe(45000)
    expect(overhead.mcpToolsTokens).toBe(0)
    expect(overhead.customAgentsTokens).toBe(0)
    expect(overhead.memoryFilesTokens).toBe(0)
    expect(overhead.usingDefaults).toBe(true)
  })

  it('calculates total overhead correctly', () => {
    const overhead = getDefaultOverhead()
    expect(overhead.totalOverhead).toBe(3200 + 17900 + 45000) // 66100
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
      tokens: '45k',
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
    }

    const result = formatter.format('[{model}] | {tokens} | {summary}', viewModel)
    expect(result).toBe('[claude-3-5-sonnet] | 45k | Fixing auth bug')
  })

  it('cleans up empty tokens with pipe separator', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: false,
    })

    const viewModel = {
      model: 'claude-3-5-sonnet',
      tokens: '45k',
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
      tokens: '45k',
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
      tokens: '45k',
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
      tokens: '45k',
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
    }

    // Multiple empty tokens should all be cleaned up
    const result = formatter.format('{model} | {duration} | {title} | {summary}', viewModel)
    expect(result).toBe('claude-3-5-sonnet | Test title')
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
      tokens: '45k',
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
    }

    const result = formatter.format('{tokens}', viewModel)
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
      tokens: '120k',
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
    }

    const result = formatter.format('{tokens}', viewModel)
    expect(result).toContain(ANSI.yellow)
  })

  it('applies red color for critical threshold status', () => {
    const formatter = createFormatter({
      theme: DEFAULT_STATUSLINE_CONFIG.theme,
      useColors: true,
    })

    const viewModel = {
      model: 'claude-3-5-sonnet',
      tokens: '180k',
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
    }

    const result = formatter.format('{tokens}', viewModel)
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
      tokens: '45k',
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
      tokens: '45k',
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
      tokens: '45k',
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
      tokens: '45k',
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
      tokens: '45k',
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
    }

    const result = formatter.format('{branch}', viewModel)
    expect(result).toContain(ANSI.green)
    expect(result).toContain('⎇ main')
  })
})

// ============================================================================
// StateReader Tests
// ============================================================================

describe('StateReader', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `statusline-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
  })

  it('returns default when file missing', async () => {
    const reader = createStateReader(testDir)
    const result = await reader.getSessionState()

    expect(result.source).toBe('default')
    expect(result.data.tokens.total).toBe(0)
  })

  it('reads valid session state', async () => {
    const state = {
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
        currentContextTokens: 30000,
        isPostCompactIndeterminate: false,
        toolsPerTurn: 0,
        lastProcessedLine: 2,
        lastUpdatedAt: Date.now(),
      },
      persistedAt: Date.now(),
    }
    await fs.writeFile(path.join(testDir, 'transcript-metrics.json'), JSON.stringify(state))

    const reader = createStateReader(testDir)
    const result = await reader.getSessionState()

    expect(result.source).toBe('fresh')
    expect(result.data.tokens.total).toBe(45000)
    // Note: cost/duration/model come from hook metrics, not transcript-metrics.json
    // TranscriptMetricsState only contains token data
  })

  it('returns default for invalid JSON', async () => {
    await fs.writeFile(path.join(testDir, 'transcript-metrics.json'), 'not json')

    const reader = createStateReader(testDir)
    const result = await reader.getSessionState()

    expect(result.source).toBe('default')
  })

  it('reads snarky message', async () => {
    await fs.writeFile(path.join(testDir, 'snarky-message.txt'), 'Time to debug!')

    const reader = createStateReader(testDir)
    const result = await reader.getSnarkyMessage()

    expect(result.source).toBe('fresh')
    expect(result.data).toBe('Time to debug!')
  })
})

// ============================================================================
// discoverPreviousResumeMessage Tests
// ============================================================================

describe('discoverPreviousResumeMessage', () => {
  let sessionsDir: string

  beforeEach(async () => {
    sessionsDir = path.join(tmpdir(), `sessions-test-${Date.now()}`)
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
        resume_last_goal_message: 'Current session message',
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
        resume_last_goal_message: 'Working on auth refactor',
        snarky_comment: 'Back for more punishment?',
        timestamp: '2024-01-15T10:30:00Z',
      })
    )

    const result = await discoverPreviousResumeMessage(sessionsDir, 'current-session')

    expect(result.source).toBe('discovered')
    expect(result.sessionId).toBe('prev-session')
    expect(result.data?.resume_last_goal_message).toBe('Working on auth refactor')
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
        resume_last_goal_message: 'Older message',
        snarky_comment: 'Old news',
        timestamp: '2024-01-10T10:00:00Z',
      })
    )
    // Set mtime to past
    const oldTime = new Date(Date.now() - 3600_000)
    await fs.utimes(olderFile, oldTime, oldTime)

    // Create newer session
    const newerDir = path.join(sessionsDir, 'newer-session', 'state')
    await fs.mkdir(newerDir, { recursive: true })
    await fs.writeFile(
      path.join(newerDir, 'resume-message.json'),
      JSON.stringify({
        last_task_id: null,
        resume_last_goal_message: 'Newer message',
        snarky_comment: 'Fresh content',
        timestamp: '2024-01-15T10:00:00Z',
      })
    )

    const result = await discoverPreviousResumeMessage(sessionsDir, 'current-session')

    expect(result.source).toBe('discovered')
    expect(result.sessionId).toBe('newer-session')
    expect(result.data?.resume_last_goal_message).toBe('Newer message')
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
        resume_last_goal_message: 'Valid message',
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
        resume_last_goal_message: 'Has resume',
        snarky_comment: 'Found me!',
        timestamp: new Date().toISOString(),
      })
    )

    const result = await discoverPreviousResumeMessage(sessionsDir, 'current-session')

    expect(result.source).toBe('discovered')
    expect(result.sessionId).toBe('with-resume-session')
  })

  it('returns not_found when sessions directory does not exist', async () => {
    const result = await discoverPreviousResumeMessage('/nonexistent/path', 'current')

    expect(result.source).toBe('not_found')
    expect(result.data).toBeNull()
  })
})

// ============================================================================
// StateReader First-Prompt Summary Tests (Phase 3)
// ============================================================================

describe('StateReader.getFirstPromptSummary', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `first-prompt-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
  })

  it('returns null when file is missing', async () => {
    const reader = createStateReader(testDir)
    const result = await reader.getFirstPromptSummary()

    expect(result.source).toBe('default')
    expect(result.data).toBeNull()
  })

  it('reads valid first-prompt-summary.json', async () => {
    await fs.writeFile(
      path.join(testDir, 'first-prompt-summary.json'),
      JSON.stringify({
        session_id: 'test-123',
        timestamp: new Date().toISOString(),
        message: 'Refactoring auth... what could go wrong?',
        classification: 'actionable',
        source: 'llm',
        model: 'claude-3-5-haiku',
        latency_ms: 4823,
        user_prompt: 'refactor the authentication module',
        had_resume_context: false,
      })
    )

    const reader = createStateReader(testDir)
    const result = await reader.getFirstPromptSummary()

    expect(result.source).toBe('fresh')
    expect(result.data).not.toBeNull()
    expect(result.data?.message).toBe('Refactoring auth... what could go wrong?')
    expect(result.data?.classification).toBe('actionable')
    expect(result.data?.source).toBe('llm')
  })

  it('returns null for invalid JSON', async () => {
    await fs.writeFile(path.join(testDir, 'first-prompt-summary.json'), 'not valid json')

    const reader = createStateReader(testDir)
    const result = await reader.getFirstPromptSummary()

    expect(result.source).toBe('default')
    expect(result.data).toBeNull()
  })

  it('returns fresh for old first-prompt summary (content artifacts never stale)', async () => {
    // Content artifacts (like first-prompt summary) don't have staleness.
    // They remain valid until regenerated - file age doesn't matter.
    const filePath = path.join(testDir, 'first-prompt-summary.json')
    await fs.writeFile(
      filePath,
      JSON.stringify({
        session_id: 'test-123',
        timestamp: new Date().toISOString(),
        message: 'Old message',
        source: 'llm',
        user_prompt: 'test',
        had_resume_context: false,
      })
    )
    // Set mtime to 2 minutes ago - should NOT affect staleness for content artifacts
    const twoMinutesAgo = new Date(Date.now() - 120_000)
    await fs.utimes(filePath, twoMinutesAgo, twoMinutesAgo)

    const reader = createStateReader(testDir)
    const result = await reader.getFirstPromptSummary()

    expect(result.source).toBe('fresh') // Content artifacts are never stale
    expect(result.data?.message).toBe('Old message')
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

  it('returns timeout source when command exceeds timeout', async () => {
    // Use an extremely short timeout to trigger timeout path
    // We need a directory where git might be slow or hang
    const { createGitProvider } = await import('../git-provider.js')
    const provider = createGitProvider(testDir, { timeoutMs: 0 })
    const result = await provider.getCurrentBranch()

    // With 0ms timeout, it should almost always timeout before git responds
    // However, this is inherently racy. Accept either timeout or error.
    expect(['timeout', 'error']).toContain(result.source)
    expect(result.branch).toBe('')
  })
})

// ============================================================================
// StatuslineService Tests
// ============================================================================

describe('StatuslineService', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `statusline-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
  })

  it('renders with default values when no state files', async () => {
    const service = createStatuslineService({
      sessionStateDir: testDir,
      cwd: '/home/user/project',
      homeDir: '/home/user',
      useColors: false,
    })

    const result = await service.render()

    expect(result.displayMode).toBe('empty_summary')
    expect(result.viewModel.summary).toBe('New session')
  })

  it('renders session summary when available', async () => {
    // Write session state
    await fs.writeFile(
      path.join(testDir, 'transcript-metrics.json'),
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
      path.join(testDir, 'session-summary.json'),
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
      sessionStateDir: testDir,
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
    // Token count shows context|total format: 30k context + 45k buffer = 75k total
    expect(result.viewModel.tokens).toBe('30k|75k')
    expect(result.viewModel.title).toBe('Auth bug fix')
  })

  it('prefers snarky message over intent', async () => {
    await fs.writeFile(
      path.join(testDir, 'session-summary.json'),
      JSON.stringify({
        session_id: 'test-123',
        timestamp: new Date().toISOString(),
        session_title: 'Auth bug fix',
        session_title_confidence: 0.9,
        latest_intent: 'Fixing auth',
        latest_intent_confidence: 0.85,
      })
    )
    await fs.writeFile(path.join(testDir, 'snarky-message.txt'), 'Battling the auth gremlins!')

    const service = createStatuslineService({
      sessionStateDir: testDir,
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
    const stateFile = path.join(testDir, 'transcript-metrics.json')
    await fs.writeFile(
      stateFile,
      JSON.stringify({
        sessionId: 'test-123',
        metrics: {
          turnCount: 1,
          toolsThisTurn: 0,
          toolCount: 0,
          messageCount: 1,
          tokenUsage: {
            inputTokens: 1000,
            outputTokens: 0,
            totalTokens: 1000,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
          },
          currentContextTokens: 1000,
          isPostCompactIndeterminate: false,
          toolsPerTurn: 0,
          lastProcessedLine: 1,
          lastUpdatedAt: twoMinutesAgo,
        },
        persistedAt: twoMinutesAgo, // Old persistedAt triggers staleness
      })
    )

    const service = createStatuslineService({
      sessionStateDir: testDir,
      cwd: '/test',
      useColors: false,
    })

    const result = await service.render()

    expect(result.staleData).toBe(true)
    expect(result.text).toContain('(stale)')
  })

  it('does not append (stale) when data is fresh', async () => {
    await fs.writeFile(
      path.join(testDir, 'transcript-metrics.json'),
      JSON.stringify({
        sessionId: 'test-123',
        metrics: {
          turnCount: 1,
          toolsThisTurn: 0,
          toolCount: 0,
          messageCount: 1,
          tokenUsage: {
            inputTokens: 1000,
            outputTokens: 0,
            totalTokens: 1000,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
          },
          currentContextTokens: 1000,
          isPostCompactIndeterminate: false,
          toolsPerTurn: 0,
          lastProcessedLine: 1,
          lastUpdatedAt: Date.now(),
        },
        persistedAt: Date.now(),
      })
    )

    const service = createStatuslineService({
      sessionStateDir: testDir,
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
        sessionStateDir: testDir,
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
        sessionStateDir: testDir,
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
    let sessionsDir: string

    beforeEach(async () => {
      sessionsDir = path.join(tmpdir(), `sessions-discovery-${Date.now()}`)
      await fs.mkdir(sessionsDir, { recursive: true })
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
          resume_last_goal_message: 'Working on feature X',
          snarky_comment: 'Back for more?',
          timestamp: new Date().toISOString(),
        })
      )

      const service = createStatuslineService({
        sessionStateDir: currentStateDir,
        cwd: '/test',
        useColors: false,
        sessionsDir,
        currentSessionId,
      })

      const result = await service.render()

      // Should discover and display the previous session's resume message
      expect(result.displayMode).toBe('resume_message')
      expect(result.viewModel.summary).toBe('Working on feature X')
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
          resume_last_goal_message: 'Old work',
          snarky_comment: 'Old stuff',
          timestamp: new Date().toISOString(),
        })
      )

      const service = createStatuslineService({
        sessionStateDir: currentStateDir,
        cwd: '/test',
        useColors: false,
        sessionsDir,
        currentSessionId,
      })

      const result = await service.render()

      // Should use current session's summary, not discover previous
      expect(result.displayMode).toBe('session_summary')
      expect(result.viewModel.title).toBe('Current work')
    })

    it('falls back gracefully when discovery config not provided', async () => {
      // No sessionsDir or currentSessionId provided
      const service = createStatuslineService({
        sessionStateDir: testDir,
        cwd: '/test',
        useColors: false,
      })

      const result = await service.render()

      // Should work normally without discovery
      expect(result.displayMode).toBe('empty_summary')
    })
  })

  describe('first-prompt summary integration (Phase 3)', () => {
    it('displays first-prompt message when no session summary exists', async () => {
      // Write first-prompt summary
      await fs.writeFile(
        path.join(testDir, 'first-prompt-summary.json'),
        JSON.stringify({
          session_id: 'test-123',
          timestamp: new Date().toISOString(),
          message: 'Refactoring auth... what could go wrong?',
          classification: 'actionable',
          source: 'llm',
          user_prompt: 'refactor auth',
          had_resume_context: false,
        })
      )

      const service = createStatuslineService({
        sessionStateDir: testDir,
        cwd: '/test',
        useColors: false,
      })

      const result = await service.render()

      expect(result.displayMode).toBe('first_prompt')
      expect(result.viewModel.summary).toBe('Refactoring auth... what could go wrong?')
    })

    it('displays first-prompt over low-confidence summary', async () => {
      // Write low-confidence session summary
      await fs.writeFile(
        path.join(testDir, 'session-summary.json'),
        JSON.stringify({
          session_id: 'test-123',
          timestamp: new Date().toISOString(),
          session_title: 'Low confidence title',
          session_title_confidence: 0.3, // Below default threshold of 0.6
          latest_intent: 'Some intent',
          latest_intent_confidence: 0.4,
        })
      )

      // Write first-prompt summary
      await fs.writeFile(
        path.join(testDir, 'first-prompt-summary.json'),
        JSON.stringify({
          session_id: 'test-123',
          timestamp: new Date().toISOString(),
          message: 'Deciphering your cryptic request...',
          source: 'llm',
          user_prompt: 'do the thing',
          had_resume_context: false,
        })
      )

      const service = createStatuslineService({
        sessionStateDir: testDir,
        cwd: '/test',
        useColors: false,
      })

      const result = await service.render()

      expect(result.displayMode).toBe('first_prompt')
      expect(result.viewModel.summary).toBe('Deciphering your cryptic request...')
    })

    it('displays session summary when confidence exceeds threshold', async () => {
      // Write high-confidence session summary
      await fs.writeFile(
        path.join(testDir, 'session-summary.json'),
        JSON.stringify({
          session_id: 'test-123',
          timestamp: new Date().toISOString(),
          session_title: 'Auth Refactoring',
          session_title_confidence: 0.85, // Above threshold
          latest_intent: 'Working on auth module',
          latest_intent_confidence: 0.9,
        })
      )

      // Write first-prompt summary (should be ignored)
      await fs.writeFile(
        path.join(testDir, 'first-prompt-summary.json'),
        JSON.stringify({
          session_id: 'test-123',
          timestamp: new Date().toISOString(),
          message: 'Old first prompt message',
          source: 'llm',
          user_prompt: 'refactor auth',
          had_resume_context: false,
        })
      )

      const service = createStatuslineService({
        sessionStateDir: testDir,
        cwd: '/test',
        useColors: false,
      })

      const result = await service.render()

      expect(result.displayMode).toBe('session_summary')
      expect(result.viewModel.title).toBe('Auth Refactoring')
    })

    it('falls back to low-confidence summary when no first-prompt exists', async () => {
      // Write low-confidence session summary, no first-prompt
      await fs.writeFile(
        path.join(testDir, 'session-summary.json'),
        JSON.stringify({
          session_id: 'test-123',
          timestamp: new Date().toISOString(),
          session_title: 'Low confidence but only option',
          session_title_confidence: 0.3,
          latest_intent: 'Some intent',
          latest_intent_confidence: 0.4,
        })
      )

      const service = createStatuslineService({
        sessionStateDir: testDir,
        cwd: '/test',
        useColors: false,
      })

      const result = await service.render()

      // Should fall back to session_summary since no first-prompt exists
      expect(result.displayMode).toBe('session_summary')
      expect(result.viewModel.title).toBe('Low confidence but only option')
    })

    it('respects custom confidence threshold from config', async () => {
      // Write session summary with confidence 0.5
      await fs.writeFile(
        path.join(testDir, 'session-summary.json'),
        JSON.stringify({
          session_id: 'test-123',
          timestamp: new Date().toISOString(),
          session_title: 'Moderate confidence',
          session_title_confidence: 0.5,
          latest_intent: 'Intent',
          latest_intent_confidence: 0.5,
        })
      )

      // Write first-prompt summary
      await fs.writeFile(
        path.join(testDir, 'first-prompt-summary.json'),
        JSON.stringify({
          session_id: 'test-123',
          timestamp: new Date().toISOString(),
          message: 'First prompt message',
          source: 'llm',
          user_prompt: 'test',
          had_resume_context: false,
        })
      )

      // Use lower threshold (0.4) so 0.5 confidence is sufficient
      const service = createStatuslineService({
        sessionStateDir: testDir,
        cwd: '/test',
        useColors: false,
        config: { confidenceThreshold: 0.4 },
      })

      const result = await service.render()

      // With threshold 0.4, confidence 0.5 should show session_summary
      expect(result.displayMode).toBe('session_summary')
    })

    it('resume message takes priority over first-prompt when session is resumed', async () => {
      // Write resume message
      await fs.writeFile(
        path.join(testDir, 'resume-message.json'),
        JSON.stringify({
          last_task_id: null,
          resume_last_goal_message: 'Continue refactoring?',
          snarky_comment: 'Back for more?',
          timestamp: new Date().toISOString(),
        })
      )

      // Write first-prompt summary
      await fs.writeFile(
        path.join(testDir, 'first-prompt-summary.json'),
        JSON.stringify({
          session_id: 'test-123',
          timestamp: new Date().toISOString(),
          message: 'First prompt message',
          source: 'llm',
          user_prompt: 'test',
          had_resume_context: true,
        })
      )

      const service = createStatuslineService({
        sessionStateDir: testDir,
        cwd: '/test',
        useColors: false,
        isResumedSession: true,
      })

      const result = await service.render()

      expect(result.displayMode).toBe('resume_message')
      expect(result.viewModel.summary).toBe('Continue refactoring?')
    })

    it('does not mark stale based on first-prompt age (content artifacts never stale)', async () => {
      // Content artifacts like first-prompt don't affect staleness detection.
      // Only transcript metrics (Supervisor heartbeat) determines staleness.
      const filePath = path.join(testDir, 'first-prompt-summary.json')
      await fs.writeFile(
        filePath,
        JSON.stringify({
          session_id: 'test-123',
          timestamp: new Date().toISOString(),
          message: 'Old message',
          source: 'llm',
          user_prompt: 'test',
          had_resume_context: false,
        })
      )
      // Set mtime to 2 minutes ago - should NOT affect staleness
      const twoMinutesAgo = new Date(Date.now() - 120_000)
      await fs.utimes(filePath, twoMinutesAgo, twoMinutesAgo)

      const service = createStatuslineService({
        sessionStateDir: testDir,
        cwd: '/test',
        useColors: false,
      })

      const result = await service.render()

      // Content artifact age doesn't trigger stale indicator
      expect(result.staleData).toBe(false)
      expect(result.text).not.toContain('(stale)')
    })
  })
})
