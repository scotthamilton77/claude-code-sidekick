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
  formatDuration,
  formatTokens,
  getBranchColor,
  getContextBarStatus,
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
      const countFilled = (s: string) => (s.match(/▓/g) || []).length
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
    const expectedTotal =
      overhead.systemPromptTokens + overhead.systemToolsTokens + overhead.autocompactBufferTokens
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
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
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
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
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
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
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
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
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
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
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
      tokens: '45k',
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
    }

    // Template: {cwd}{branch} | {title} - branch is empty but separator should be preserved
    // Bug: Previously, EMPTY_MARKER | was removed entirely, causing cwd to run into title
    const result = formatter.format('{cwd}{branch} | {title}', viewModel)
    expect(result).toBe('~/project | Test title')
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
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
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
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
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
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
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
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
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
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
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
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
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
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
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
      warningCount: 0,
      errorCount: 0,
      logStatus: 'normal' as const,
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
        session_title: 'Current Session',
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
        session_title: 'Auth Refactor',
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
        session_title: 'Older Session',
        resume_last_goal_message: 'Older message',
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
        session_title: 'Valid Session',
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
        session_title: 'Has Resume Session',
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
    expect(result.viewModel.summary).toBe('New Session')
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
    // Token display format: "{context}|{total}" where:
    // - context = 30k (from totalInputTokens in hookInput)
    // - total = context + autocompact buffer (defaults ~45k from @sidekick/types)
    // This test implicitly depends on the default autocompact buffer value.
    // If defaults change in @sidekick/types, update expected total accordingly.
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
          session_title: 'Feature X',
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

  describe('random empty session messages', () => {
    /** Create a mock asset resolver that returns content for a specific path */
    function createMockAssets(content: string | null): { resolve: (relativePath: string) => string | null } {
      return {
        resolve: (relativePath: string): string | null => {
          if (relativePath === 'defaults/features/statusline-empty-messages.txt') {
            return content
          }
          return null
        },
      }
    }

    it('picks a random message from the assets file', async () => {
      const messages = ['Message one', 'Message two', 'Message three']
      const assets = createMockAssets(messages.join('\n'))

      const service = createStatuslineService({
        sessionStateDir: testDir,
        cwd: '/test',
        useColors: false,
        assets,
      })

      const result = await service.render()

      expect(result.displayMode).toBe('empty_summary')
      expect(messages).toContain(result.viewModel.summary)
    })

    it('falls back to default when assets not provided', async () => {
      const service = createStatuslineService({
        sessionStateDir: testDir,
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
        sessionStateDir: testDir,
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
        sessionStateDir: testDir,
        cwd: '/test',
        useColors: false,
        assets,
      })

      const result = await service.render()

      expect(result.displayMode).toBe('empty_summary')
      expect(result.viewModel.summary).toBe('New Session')
    })

    it('handles blank lines in messages file', async () => {
      const messages = ['Message one', '', '  ', 'Message two']
      const assets = createMockAssets(messages.join('\n'))

      const service = createStatuslineService({
        sessionStateDir: testDir,
        cwd: '/test',
        useColors: false,
        assets,
      })

      const result = await service.render()

      // Should only pick from non-empty messages
      expect(['Message one', 'Message two']).toContain(result.viewModel.summary)
    })

    it('uses same message for entire service instance', async () => {
      // Contract test: Random message is chosen at service construction, not per-render.
      // This prevents UI flickering when the statusline refreshes multiple times.
      // Users see the same "New Session" message until they actually start working.
      const messages = ['A', 'B', 'C', 'D', 'E']
      const assets = createMockAssets(messages.join('\n'))

      const service = createStatuslineService({
        sessionStateDir: testDir,
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
