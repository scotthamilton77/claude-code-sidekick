/**
 * Tests for Statusline Feature
 *
 * @see docs/design/FEATURE-STATUSLINE.md
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'

import {
  formatTokens,
  formatCost,
  formatDuration,
  shortenPath,
  formatBranch,
  getThresholdStatus,
  createFormatter,
} from '../formatter.js'
import { createStateReader } from '../state-reader.js'
import { createStatuslineService } from '../statusline-service.js'
import { DEFAULT_STATUSLINE_CONFIG } from '../types.js'

// ============================================================================
// Formatter Tests
// ============================================================================

describe('Formatter utilities', () => {
  describe('formatTokens', () => {
    it('formats small numbers as-is', () => {
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

    it('shortens long paths', () => {
      expect(shortenPath('/a/b/c/d/e')).toBe('.../d/e')
    })

    it('returns short paths as-is', () => {
      expect(shortenPath('/home/project')).toBe('/home/project')
    })
  })

  describe('formatBranch', () => {
    it('returns empty string for empty branch', () => {
      expect(formatBranch('', true)).toBe('')
    })

    it('uses nerd font icon when enabled', () => {
      expect(formatBranch('main', true)).toBe('main')
    })

    it('uses parentheses when nerd fonts disabled', () => {
      expect(formatBranch('main', false)).toBe('(main)')
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
      branch: '(main)',
      displayMode: 'session_summary' as const,
      summary: 'Fixing auth bug',
      title: 'Auth bug fix',
    }

    const result = formatter.format('[{model}] | {tokens} | {summary}', viewModel)
    expect(result).toBe('[claude-3-5-sonnet] | 45k | Fixing auth bug')
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
    expect(result.data.tokens).toBe(0)
  })

  it('reads valid session state', async () => {
    const state = {
      sessionId: 'test-123',
      timestamp: Date.now(),
      tokens: 45000,
      cost: 0.15,
      durationMs: 720000,
      modelName: 'claude-3-5-sonnet',
    }
    await fs.writeFile(path.join(testDir, 'session-state.json'), JSON.stringify(state))

    const reader = createStateReader(testDir)
    const result = await reader.getSessionState()

    expect(result.source).toBe('fresh')
    expect(result.data.tokens).toBe(45000)
    expect(result.data.modelName).toBe('claude-3-5-sonnet')
  })

  it('returns default for invalid JSON', async () => {
    await fs.writeFile(path.join(testDir, 'session-state.json'), 'not json')

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
      path.join(testDir, 'session-state.json'),
      JSON.stringify({
        sessionId: 'test-123',
        timestamp: Date.now(),
        tokens: 45000,
        cost: 0.15,
        durationMs: 720000,
        modelName: 'claude-3-5-sonnet',
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
    })

    const result = await service.render()

    expect(result.displayMode).toBe('session_summary')
    expect(result.viewModel.model).toBe('3-5-sonnet')
    expect(result.viewModel.tokens).toBe('45k')
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
    // Write state file with old timestamp (simulate stale data)
    const stateFile = path.join(testDir, 'session-state.json')
    await fs.writeFile(
      stateFile,
      JSON.stringify({
        sessionId: 'test-123',
        timestamp: Date.now(),
        tokens: 1000,
        cost: 0.01,
        durationMs: 5000,
        modelName: 'claude-3-5-sonnet',
      })
    )
    // Set mtime to 2 minutes ago to trigger staleness
    const twoMinutesAgo = new Date(Date.now() - 120_000)
    await fs.utimes(stateFile, twoMinutesAgo, twoMinutesAgo)

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
      path.join(testDir, 'session-state.json'),
      JSON.stringify({
        sessionId: 'test-123',
        timestamp: Date.now(),
        tokens: 1000,
        cost: 0.01,
        durationMs: 5000,
        modelName: 'claude-3-5-sonnet',
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
})
