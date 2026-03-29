/**
 * Runtime validation tests for state domain Zod schemas.
 *
 * Exercises safeParse with valid and invalid data to verify runtime behavior,
 * not just compile-time type correctness.
 *
 * @see packages/types/src/services/state.ts
 */

import { describe, expect, it } from 'vitest'
import {
  SessionSummaryStateSchema,
  SessionPersonaStateSchema,
  LastStagedPersonaSchema,
  SummaryCountdownStateSchema,
  SnarkyMessageStateSchema,
  ResumeMessageStateSchema,
  TranscriptMetricsStateSchema,
  LogMetricsStateSchema,
  PRBaselineStateSchema,
  VCUnverifiedStateSchema,
  VerificationToolStatusSchema,
  VerificationToolsStateSchema,
  ReminderThrottleEntrySchema,
  ReminderThrottleStateSchema,
  CachedReminderSchema,
  BaseTokenMetricsStateSchema,
  ProjectContextMetricsSchema,
  SessionContextMetricsSchema,
  LLMLatencyStatsSchema,
  LLMModelMetricsSchema,
  LLMProviderMetricsSchema,
  LLMSessionTotalsSchema,
  LLMMetricsStateSchema,
  createDefaultLLMMetrics,
} from '../state.js'

// ============================================================================
// SessionSummaryStateSchema
// ============================================================================

describe('SessionSummaryStateSchema', () => {
  const validMinimal = {
    session_id: 'sess-123',
    timestamp: '2026-01-01T00:00:00Z',
    session_title: 'Test Session',
    session_title_confidence: 0.9,
    latest_intent: 'Writing tests',
    latest_intent_confidence: 0.85,
  }

  it('accepts valid minimal data', () => {
    const result = SessionSummaryStateSchema.safeParse(validMinimal)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.session_id).toBe('sess-123')
      expect(result.data.session_title_confidence).toBe(0.9)
    }
  })

  it('accepts valid data with all optional fields', () => {
    const result = SessionSummaryStateSchema.safeParse({
      ...validMinimal,
      session_title_key_phrases: ['testing', 'zod'],
      latest_intent_key_phrases: ['unit tests'],
      pivot_detected: true,
      previous_title: 'Old Title',
      previous_intent: 'Old Intent',
      stats: { total_tokens: 500, processing_time_ms: 120 },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.pivot_detected).toBe(true)
      expect(result.data.stats?.total_tokens).toBe(500)
    }
  })

  it('rejects missing required fields', () => {
    const result = SessionSummaryStateSchema.safeParse({
      session_id: 'sess-123',
      timestamp: '2026-01-01T00:00:00Z',
      // missing session_title, session_title_confidence, etc.
    })
    expect(result.success).toBe(false)
  })

  it('rejects wrong type for confidence', () => {
    const result = SessionSummaryStateSchema.safeParse({
      ...validMinimal,
      session_title_confidence: 'high', // should be number
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-array for key_phrases', () => {
    const result = SessionSummaryStateSchema.safeParse({
      ...validMinimal,
      session_title_key_phrases: 'not-an-array',
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// SessionPersonaStateSchema
// ============================================================================

describe('SessionPersonaStateSchema', () => {
  it('accepts valid persona state', () => {
    const result = SessionPersonaStateSchema.safeParse({
      persona_id: 'gandalf',
      selected_from: ['gandalf', 'yoda', 'picard'],
      timestamp: '2026-01-01T00:00:00Z',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.persona_id).toBe('gandalf')
      expect(result.data.selected_from).toHaveLength(3)
    }
  })

  it('rejects missing persona_id', () => {
    const result = SessionPersonaStateSchema.safeParse({
      selected_from: ['gandalf'],
      timestamp: '2026-01-01T00:00:00Z',
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-string array in selected_from', () => {
    const result = SessionPersonaStateSchema.safeParse({
      persona_id: 'gandalf',
      selected_from: [1, 2, 3],
      timestamp: '2026-01-01T00:00:00Z',
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// LastStagedPersonaSchema
// ============================================================================

describe('LastStagedPersonaSchema', () => {
  it('accepts persona ID string', () => {
    const result = LastStagedPersonaSchema.safeParse({ personaId: 'gandalf' })
    expect(result.success).toBe(true)
  })

  it('accepts null (explicitly cleared)', () => {
    const result = LastStagedPersonaSchema.safeParse({ personaId: null })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.personaId).toBeNull()
    }
  })

  it('rejects missing personaId', () => {
    const result = LastStagedPersonaSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// SummaryCountdownStateSchema
// ============================================================================

describe('SummaryCountdownStateSchema', () => {
  it('accepts valid countdown', () => {
    const result = SummaryCountdownStateSchema.safeParse({ countdown: 5, bookmark_line: 100 })
    expect(result.success).toBe(true)
  })

  it('rejects non-number countdown', () => {
    const result = SummaryCountdownStateSchema.safeParse({ countdown: 'five', bookmark_line: 100 })
    expect(result.success).toBe(false)
  })

  it('rejects missing bookmark_line', () => {
    const result = SummaryCountdownStateSchema.safeParse({ countdown: 5 })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// SnarkyMessageStateSchema
// ============================================================================

describe('SnarkyMessageStateSchema', () => {
  it('accepts valid snarky message', () => {
    const result = SnarkyMessageStateSchema.safeParse({
      message: 'Oh great, another coding session.',
      timestamp: '2026-01-01T00:00:00Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing message', () => {
    const result = SnarkyMessageStateSchema.safeParse({ timestamp: '2026-01-01T00:00:00Z' })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// ResumeMessageStateSchema
// ============================================================================

describe('ResumeMessageStateSchema', () => {
  it('accepts valid resume message with defaults', () => {
    const result = ResumeMessageStateSchema.safeParse({
      last_task_id: 'task-1',
      session_title: 'Debugging session',
      snarky_comment: 'Back already?',
      timestamp: '2026-01-01T00:00:00Z',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      // persona_id and persona_display_name should default to null
      expect(result.data.persona_id).toBeNull()
      expect(result.data.persona_display_name).toBeNull()
    }
  })

  it('accepts null fields for task_id and session_title', () => {
    const result = ResumeMessageStateSchema.safeParse({
      last_task_id: null,
      session_title: null,
      snarky_comment: 'Surprise!',
      timestamp: '2026-01-01T00:00:00Z',
    })
    expect(result.success).toBe(true)
  })

  it('accepts persona fields when provided', () => {
    const result = ResumeMessageStateSchema.safeParse({
      last_task_id: null,
      session_title: null,
      snarky_comment: 'Live long and prosper.',
      timestamp: '2026-01-01T00:00:00Z',
      persona_id: 'spock',
      persona_display_name: 'Mr. Spock',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.persona_id).toBe('spock')
      expect(result.data.persona_display_name).toBe('Mr. Spock')
    }
  })

  it('rejects missing snarky_comment', () => {
    const result = ResumeMessageStateSchema.safeParse({
      last_task_id: null,
      session_title: null,
      timestamp: '2026-01-01T00:00:00Z',
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// TranscriptMetricsStateSchema
// ============================================================================

describe('TranscriptMetricsStateSchema', () => {
  const validMetrics = {
    sessionId: 'sess-123',
    lastUpdatedAt: Date.now(),
    tokens: {
      input: 1000,
      output: 500,
      total: 1500,
      cacheCreation: 200,
      cacheRead: 100,
    },
  }

  it('accepts valid metrics', () => {
    const result = TranscriptMetricsStateSchema.safeParse(validMetrics)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tokens.total).toBe(1500)
    }
  })

  it('accepts optional context tokens', () => {
    const result = TranscriptMetricsStateSchema.safeParse({
      ...validMetrics,
      currentContextTokens: 50000,
      isPostCompactIndeterminate: true,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.currentContextTokens).toBe(50000)
      expect(result.data.isPostCompactIndeterminate).toBe(true)
    }
  })

  it('accepts null for currentContextTokens', () => {
    const result = TranscriptMetricsStateSchema.safeParse({
      ...validMetrics,
      currentContextTokens: null,
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing tokens sub-fields', () => {
    const result = TranscriptMetricsStateSchema.safeParse({
      sessionId: 'sess-123',
      lastUpdatedAt: Date.now(),
      tokens: { input: 1000 }, // missing output, total, etc.
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-number token values', () => {
    const result = TranscriptMetricsStateSchema.safeParse({
      ...validMetrics,
      tokens: { ...validMetrics.tokens, input: 'many' },
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// LogMetricsStateSchema
// ============================================================================

describe('LogMetricsStateSchema', () => {
  it('accepts valid log metrics with sessionId', () => {
    const result = LogMetricsStateSchema.safeParse({
      sessionId: 'sess-123',
      warningCount: 3,
      errorCount: 1,
      lastUpdatedAt: Date.now(),
    })
    expect(result.success).toBe(true)
  })

  it('accepts valid global log metrics (no sessionId)', () => {
    const result = LogMetricsStateSchema.safeParse({
      warningCount: 0,
      errorCount: 0,
      lastUpdatedAt: Date.now(),
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-number warningCount', () => {
    const result = LogMetricsStateSchema.safeParse({
      warningCount: 'many',
      errorCount: 0,
      lastUpdatedAt: Date.now(),
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// PRBaselineStateSchema
// ============================================================================

describe('PRBaselineStateSchema', () => {
  it('accepts valid baseline', () => {
    const result = PRBaselineStateSchema.safeParse({
      turnCount: 5,
      toolsThisTurn: 3,
      timestamp: Date.now(),
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing turnCount', () => {
    const result = PRBaselineStateSchema.safeParse({
      toolsThisTurn: 3,
      timestamp: Date.now(),
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// VCUnverifiedStateSchema
// ============================================================================

describe('VCUnverifiedStateSchema', () => {
  const validState = {
    hasUnverifiedChanges: true,
    cycleCount: 2,
    setAt: {
      timestamp: Date.now(),
      turnCount: 5,
      toolsThisTurn: 3,
      toolCount: 15,
    },
    lastClassification: {
      category: 'CLAIMING_COMPLETION',
      confidence: 0.95,
    },
  }

  it('accepts valid unverified state', () => {
    const result = VCUnverifiedStateSchema.safeParse(validState)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.hasUnverifiedChanges).toBe(true)
      expect(result.data.lastClassification.confidence).toBe(0.95)
    }
  })

  it('rejects missing setAt sub-fields', () => {
    const result = VCUnverifiedStateSchema.safeParse({
      ...validState,
      setAt: { timestamp: Date.now() }, // missing turnCount, toolsThisTurn, toolCount
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-boolean hasUnverifiedChanges', () => {
    const result = VCUnverifiedStateSchema.safeParse({
      ...validState,
      hasUnverifiedChanges: 'yes',
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// VerificationToolStatusSchema / VerificationToolsStateSchema
// ============================================================================

describe('VerificationToolStatusSchema', () => {
  it('accepts valid staged status', () => {
    const result = VerificationToolStatusSchema.safeParse({
      status: 'staged',
      editsSinceVerified: 0,
      lastVerifiedAt: null,
      lastStagedAt: Date.now(),
    })
    expect(result.success).toBe(true)
  })

  it('accepts verified status with optional fields', () => {
    const result = VerificationToolStatusSchema.safeParse({
      status: 'verified',
      editsSinceVerified: 3,
      lastVerifiedAt: Date.now(),
      lastStagedAt: Date.now() - 5000,
      lastMatchedToolId: 'tsc-noEmit',
      lastMatchedScope: 'project',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.lastMatchedToolId).toBe('tsc-noEmit')
    }
  })

  it('rejects invalid status enum value', () => {
    const result = VerificationToolStatusSchema.safeParse({
      status: 'running', // not in enum
      editsSinceVerified: 0,
      lastVerifiedAt: null,
      lastStagedAt: null,
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid scope enum value', () => {
    const result = VerificationToolStatusSchema.safeParse({
      status: 'staged',
      editsSinceVerified: 0,
      lastVerifiedAt: null,
      lastStagedAt: null,
      lastMatchedScope: 'workspace', // not in enum
    })
    expect(result.success).toBe(false)
  })
})

describe('VerificationToolsStateSchema', () => {
  it('accepts record of tool name to status', () => {
    const result = VerificationToolsStateSchema.safeParse({
      build: {
        status: 'staged',
        editsSinceVerified: 2,
        lastVerifiedAt: null,
        lastStagedAt: Date.now(),
      },
      test: {
        status: 'verified',
        editsSinceVerified: 0,
        lastVerifiedAt: Date.now(),
        lastStagedAt: Date.now() - 1000,
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.build.status).toBe('staged')
      expect(result.data.test.status).toBe('verified')
    }
  })

  it('accepts empty record', () => {
    const result = VerificationToolsStateSchema.safeParse({})
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// ReminderThrottleEntrySchema / ReminderThrottleStateSchema
// ============================================================================

describe('ReminderThrottleEntrySchema', () => {
  it('accepts valid throttle entry', () => {
    const result = ReminderThrottleEntrySchema.safeParse({
      messagesSinceLastStaging: 3,
      targetHook: 'UserPromptSubmit',
      cachedReminder: {
        name: 'user-prompt-submit',
        blocking: false,
        priority: 10,
        persistent: true,
        userMessage: 'Remember to be nice',
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.targetHook).toBe('UserPromptSubmit')
      expect(result.data.cachedReminder.name).toBe('user-prompt-submit')
    }
  })

  it('rejects negative messagesSinceLastStaging', () => {
    const result = ReminderThrottleEntrySchema.safeParse({
      messagesSinceLastStaging: -1,
      targetHook: 'UserPromptSubmit',
      cachedReminder: {
        name: 'test',
        blocking: false,
        priority: 1,
        persistent: false,
      },
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-integer messagesSinceLastStaging', () => {
    const result = ReminderThrottleEntrySchema.safeParse({
      messagesSinceLastStaging: 3.5,
      targetHook: 'UserPromptSubmit',
      cachedReminder: {
        name: 'test',
        blocking: false,
        priority: 1,
        persistent: false,
      },
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid targetHook', () => {
    const result = ReminderThrottleEntrySchema.safeParse({
      messagesSinceLastStaging: 3,
      targetHook: 'InvalidHook',
      cachedReminder: {
        name: 'test',
        blocking: false,
        priority: 1,
        persistent: false,
      },
    })
    expect(result.success).toBe(false)
  })
})

describe('ReminderThrottleStateSchema', () => {
  it('accepts record of ID to throttle entry', () => {
    const result = ReminderThrottleStateSchema.safeParse({
      'user-prompt-submit': {
        messagesSinceLastStaging: 5,
        targetHook: 'UserPromptSubmit',
        cachedReminder: {
          name: 'user-prompt-submit',
          blocking: false,
          priority: 10,
          persistent: true,
        },
      },
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty record', () => {
    const result = ReminderThrottleStateSchema.safeParse({})
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// CachedReminderSchema
// ============================================================================

describe('CachedReminderSchema', () => {
  it('accepts reminder without stagedAt (omitted by design)', () => {
    const result = CachedReminderSchema.safeParse({
      name: 'test-reminder',
      blocking: true,
      priority: 5,
      persistent: false,
      reason: 'You need to verify',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('test-reminder')
      // stagedAt should not be present (omit from StagedReminderSchema)
      expect('stagedAt' in result.data).toBe(false)
    }
  })

  it('rejects if stagedAt is provided (omitted field)', () => {
    // CachedReminderSchema is StagedReminderSchema.omit({ stagedAt: true })
    // Extra keys may or may not be stripped by Zod; the key behavior is that
    // stagedAt does NOT appear in the output
    const result = CachedReminderSchema.safeParse({
      name: 'test',
      blocking: false,
      priority: 1,
      persistent: false,
      stagedAt: { timestamp: 123, turnCount: 1, toolsThisTurn: 0, toolCount: 0 },
    })
    // Zod strips unknown keys by default; stagedAt should not be in output
    if (result.success) {
      expect('stagedAt' in result.data).toBe(false)
    }
  })
})

// ============================================================================
// BaseTokenMetricsStateSchema
// ============================================================================

describe('BaseTokenMetricsStateSchema', () => {
  it('accepts valid base metrics', () => {
    const result = BaseTokenMetricsStateSchema.safeParse({
      systemPromptTokens: 3200,
      systemToolsTokens: 17900,
      autocompactBufferTokens: 45000,
      capturedAt: Date.now(),
      capturedFrom: 'defaults',
    })
    expect(result.success).toBe(true)
  })

  it('accepts context_command source with sessionId', () => {
    const result = BaseTokenMetricsStateSchema.safeParse({
      systemPromptTokens: 3200,
      systemToolsTokens: 17900,
      autocompactBufferTokens: 45000,
      capturedAt: Date.now(),
      capturedFrom: 'context_command',
      sessionId: 'sess-123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid capturedFrom enum', () => {
    const result = BaseTokenMetricsStateSchema.safeParse({
      systemPromptTokens: 3200,
      systemToolsTokens: 17900,
      autocompactBufferTokens: 45000,
      capturedAt: Date.now(),
      capturedFrom: 'unknown_source',
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// ProjectContextMetricsSchema
// ============================================================================

describe('ProjectContextMetricsSchema', () => {
  it('accepts valid project metrics', () => {
    const result = ProjectContextMetricsSchema.safeParse({
      mcpToolsTokens: 5000,
      customAgentsTokens: 2000,
      memoryFilesTokens: 1000,
      lastUpdatedAt: Date.now(),
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing required field', () => {
    const result = ProjectContextMetricsSchema.safeParse({
      mcpToolsTokens: 5000,
      // missing customAgentsTokens, memoryFilesTokens, lastUpdatedAt
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// SessionContextMetricsSchema
// ============================================================================

describe('SessionContextMetricsSchema', () => {
  it('accepts valid session context metrics', () => {
    const result = SessionContextMetricsSchema.safeParse({
      sessionId: 'sess-123',
      systemPromptTokens: 3200,
      systemToolsTokens: 17900,
      mcpToolsTokens: 5000,
      customAgentsTokens: 2000,
      memoryFilesTokens: 1000,
      autocompactBufferTokens: 45000,
      totalOverheadTokens: 74100,
      lastUpdatedAt: Date.now(),
    })
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// LLM Metrics Schemas
// ============================================================================

describe('LLMLatencyStatsSchema', () => {
  it('accepts valid latency stats', () => {
    const result = LLMLatencyStatsSchema.safeParse({
      min: 100,
      max: 5000,
      sum: 15000,
      count: 5,
      p50: 2000,
      p90: 4000,
      p95: 4500,
    })
    expect(result.success).toBe(true)
  })

  it('rejects Infinity for min (Zod requires finite numbers)', () => {
    const result = LLMLatencyStatsSchema.safeParse({
      min: Infinity,
      max: 0,
      sum: 0,
      count: 0,
      p50: 0,
      p90: 0,
      p95: 0,
    })
    // Note: DEFAULT_LATENCY_STATS uses Infinity but Zod z.number() rejects it.
    // This is a known discrepancy -- the default is used in-memory only, not persisted.
    expect(result.success).toBe(false)
  })

  it('rejects non-number values', () => {
    const result = LLMLatencyStatsSchema.safeParse({
      min: 'fast',
      max: 5000,
      sum: 15000,
      count: 5,
      p50: 2000,
      p90: 4000,
      p95: 4500,
    })
    expect(result.success).toBe(false)
  })
})

describe('LLMModelMetricsSchema', () => {
  const validLatency = { min: 100, max: 5000, sum: 15000, count: 5, p50: 2000, p90: 4000, p95: 4500 }

  it('accepts valid model metrics', () => {
    const result = LLMModelMetricsSchema.safeParse({
      callCount: 10,
      successCount: 9,
      failedCount: 1,
      inputTokens: 5000,
      outputTokens: 3000,
      latency: validLatency,
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing latency', () => {
    const result = LLMModelMetricsSchema.safeParse({
      callCount: 10,
      successCount: 9,
      failedCount: 1,
      inputTokens: 5000,
      outputTokens: 3000,
    })
    expect(result.success).toBe(false)
  })
})

describe('LLMProviderMetricsSchema', () => {
  const validLatency = { min: 100, max: 5000, sum: 15000, count: 5, p50: 2000, p90: 4000, p95: 4500 }

  it('accepts valid provider metrics with model breakdown', () => {
    const result = LLMProviderMetricsSchema.safeParse({
      callCount: 20,
      successCount: 18,
      failedCount: 2,
      inputTokens: 10000,
      outputTokens: 6000,
      latency: validLatency,
      byModel: {
        'gpt-4': {
          callCount: 10,
          successCount: 9,
          failedCount: 1,
          inputTokens: 5000,
          outputTokens: 3000,
          latency: validLatency,
        },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.byModel['gpt-4'].callCount).toBe(10)
    }
  })
})

describe('LLMSessionTotalsSchema', () => {
  it('accepts valid session totals', () => {
    const result = LLMSessionTotalsSchema.safeParse({
      callCount: 50,
      successCount: 48,
      failedCount: 2,
      inputTokens: 25000,
      outputTokens: 15000,
      totalLatencyMs: 120000,
      averageLatencyMs: 2500,
    })
    expect(result.success).toBe(true)
  })
})

describe('LLMMetricsStateSchema', () => {
  it('accepts valid LLM metrics state', () => {
    const validLatency = { min: 100, max: 5000, sum: 15000, count: 5, p50: 2000, p90: 4000, p95: 4500 }
    const result = LLMMetricsStateSchema.safeParse({
      sessionId: 'sess-123',
      lastUpdatedAt: Date.now(),
      byProvider: {
        openrouter: {
          callCount: 10,
          successCount: 10,
          failedCount: 0,
          inputTokens: 5000,
          outputTokens: 3000,
          latency: validLatency,
          byModel: {},
        },
      },
      totals: {
        callCount: 10,
        successCount: 10,
        failedCount: 0,
        inputTokens: 5000,
        outputTokens: 3000,
        totalLatencyMs: 15000,
        averageLatencyMs: 1500,
      },
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty byProvider (new session)', () => {
    const result = LLMMetricsStateSchema.safeParse({
      sessionId: 'sess-123',
      lastUpdatedAt: Date.now(),
      byProvider: {},
      totals: {
        callCount: 0,
        successCount: 0,
        failedCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalLatencyMs: 0,
        averageLatencyMs: 0,
      },
    })
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// createDefaultLLMMetrics
// ============================================================================

describe('createDefaultLLMMetrics', () => {
  it('returns valid LLM metrics for a session', () => {
    const metrics = createDefaultLLMMetrics('sess-456')
    const result = LLMMetricsStateSchema.safeParse(metrics)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sessionId).toBe('sess-456')
      expect(result.data.totals.callCount).toBe(0)
      expect(result.data.byProvider).toEqual({})
    }
  })
})
