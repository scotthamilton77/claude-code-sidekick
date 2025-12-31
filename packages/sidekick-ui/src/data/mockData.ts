/**
 * Mock Data for UI Development
 *
 * Sample data for developing and testing the monitoring UI.
 * Uses canonical SidekickEvent schema from @sidekick/types, converted to
 * UIEvent via the event adapter for display.
 *
 * @see src/types/index.ts for type definitions
 * @see src/lib/event-adapter.ts for conversion logic
 */

import type {
  SidekickEvent,
  SessionStartHookEvent,
  UserPromptSubmitHookEvent,
  PreToolUseHookEvent,
  PostToolUseHookEvent,
  TranscriptEvent,
  TranscriptMetrics,
} from '@sidekick/types'

/** Create mock metrics for test data */
function createMockMetrics(overrides: {
  turnCount?: number
  toolCount?: number
  toolsThisTurn?: number
  totalTokens?: number
}): TranscriptMetrics {
  return {
    turnCount: overrides.turnCount ?? 0,
    toolCount: overrides.toolCount ?? 0,
    toolsThisTurn: overrides.toolsThisTurn ?? 0,
    messageCount: 0,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: overrides.totalTokens ?? 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      cacheTiers: { ephemeral5mInputTokens: 0, ephemeral1hInputTokens: 0 },
      serviceTierCounts: {},
      byModel: {},
    },
    currentContextTokens: overrides.totalTokens ?? null,
    isPostCompactIndeterminate: false,
    toolsPerTurn: 0,
    lastProcessedLine: 0,
    lastUpdatedAt: 0,
  }
}
import type { Session, StateSnapshot, UIEvent } from '../types'
import { sidekickEventsToUIEvents } from '../lib/event-adapter'
import type { ParsedLogRecord } from '../lib/log-parser'
import { logRecordsToUIEvents } from '../lib/event-adapter'

// Re-export types for convenience
export type { Session, StateSnapshot, UIEvent }

// ============================================================================
// Session Data
// ============================================================================

export const currentSession: Session = {
  id: 'a1b2c3d4',
  title: 'Auth Bug Investigation',
  date: 'Nov 26, 2025 \u2022 10:00 AM',
  branch: 'main',
}

export const otherSessions: Session[] = [
  { id: 'e5f6g7h8', title: 'API Rate Limiting', date: 'Nov 25, 2025 \u2022 3:42 PM', branch: 'feature/rate-limit' },
  { id: 'i9j0k1l2', title: 'Database Migration', date: 'Nov 25, 2025 \u2022 11:15 AM', branch: 'main' },
  { id: 'm3n4o5p6', title: 'Frontend Refactor', date: 'Nov 24, 2025 \u2022 2:30 PM', branch: 'refactor/ui' },
]

// ============================================================================
// Raw SidekickEvent Data
// ============================================================================

const baseTime = new Date('2025-11-26T10:00:00').getTime()
const sessionId = 'a1b2c3d4'

/**
 * Raw SidekickEvents following the canonical schema.
 * These are the source of truth for the mock data.
 */
export const rawSidekickEvents: SidekickEvent[] = [
  // Session Start
  {
    kind: 'hook',
    hook: 'SessionStart',
    context: {
      sessionId,
      timestamp: baseTime,
      scope: 'project',
      correlationId: 'corr-001',
    },
    payload: {
      startType: 'startup',
      transcriptPath: '/workspace/.claude/transcript.jsonl',
    },
  } as SessionStartHookEvent,

  // User Prompt
  {
    kind: 'hook',
    hook: 'UserPromptSubmit',
    context: {
      sessionId,
      timestamp: baseTime + 15_000,
      scope: 'project',
      correlationId: 'corr-002',
    },
    payload: {
      prompt: 'Fix the auth bug in auth.ts - users are getting logged out randomly after about an hour of activity.',
      transcriptPath: '/workspace/.claude/transcript.jsonl',
      cwd: '/workspace',
      permissionMode: 'default',
    },
  } as UserPromptSubmitHookEvent,

  // Assistant Message (from transcript)
  {
    kind: 'transcript',
    eventType: 'AssistantMessage',
    context: {
      sessionId,
      timestamp: baseTime + 45_000,
      scope: 'project',
    },
    payload: {
      lineNumber: 3,
      entry: {},
      content:
        "I'll investigate the auth.ts file to identify the cause of random logouts. This sounds like it could be related to token expiration handling. Let me start by reading the current implementation.",
    },
    metadata: {
      transcriptPath: '/workspace/.claude/transcript.jsonl',
      metrics: createMockMetrics({ turnCount: 1, toolCount: 0, toolsThisTurn: 0, totalTokens: 1250 }),
    },
  } as TranscriptEvent,

  // PreToolUse - Read file
  {
    kind: 'hook',
    hook: 'PreToolUse',
    context: {
      sessionId,
      timestamp: baseTime + 62_000,
      scope: 'project',
      correlationId: 'corr-003',
    },
    payload: {
      toolName: 'Read',
      toolInput: {
        file_path: '/workspace/src/auth/auth.ts',
      },
    },
  } as PreToolUseHookEvent,

  // PostToolUse - Read file complete
  {
    kind: 'hook',
    hook: 'PostToolUse',
    context: {
      sessionId,
      timestamp: baseTime + 65_000,
      scope: 'project',
      correlationId: 'corr-003',
    },
    payload: {
      toolName: 'Read',
      toolInput: {
        file_path: '/workspace/src/auth/auth.ts',
      },
      toolResult: { lines: 342 },
    },
  } as PostToolUseHookEvent,

  // Assistant analysis (from transcript)
  {
    kind: 'transcript',
    eventType: 'AssistantMessage',
    context: {
      sessionId,
      timestamp: baseTime + 90_000,
      scope: 'project',
    },
    payload: {
      lineNumber: 5,
      entry: {},
      content:
        "I found the issue. The token expiration check on line 47 uses a strict less-than comparison (`<`) instead of less-than-or-equal (`<=`). This causes tokens to be considered expired one second early during edge cases.\n\nHere's the fix:",
    },
    metadata: {
      transcriptPath: '/workspace/.claude/transcript.jsonl',
      metrics: createMockMetrics({ turnCount: 1, toolCount: 1, toolsThisTurn: 1, totalTokens: 3500 }),
    },
  } as TranscriptEvent,

  // PreToolUse - Edit file
  {
    kind: 'hook',
    hook: 'PreToolUse',
    context: {
      sessionId,
      timestamp: baseTime + 105_000,
      scope: 'project',
      correlationId: 'corr-004',
    },
    payload: {
      toolName: 'Edit',
      toolInput: {
        file_path: '/workspace/src/auth/auth.ts',
        old_string: 'if (now < expiry)',
        new_string: 'if (now <= expiry)',
      },
    },
  } as PreToolUseHookEvent,

  // PostToolUse - Edit complete
  {
    kind: 'hook',
    hook: 'PostToolUse',
    context: {
      sessionId,
      timestamp: baseTime + 108_000,
      scope: 'project',
      correlationId: 'corr-004',
    },
    payload: {
      toolName: 'Edit',
      toolInput: {
        file_path: '/workspace/src/auth/auth.ts',
        old_string: 'if (now < expiry)',
        new_string: 'if (now <= expiry)',
      },
      toolResult: { success: true, line: 47 },
    },
  } as PostToolUseHookEvent,

  // Final assistant message (from transcript)
  {
    kind: 'transcript',
    eventType: 'AssistantMessage',
    context: {
      sessionId,
      timestamp: baseTime + 120_000,
      scope: 'project',
    },
    payload: {
      lineNumber: 7,
      entry: {},
      content:
        "I've fixed the token expiration bug. The change ensures tokens remain valid through their full expiration time. Would you like me to add a test case for this edge condition?",
    },
    metadata: {
      transcriptPath: '/workspace/.claude/transcript.jsonl',
      metrics: createMockMetrics({ turnCount: 1, toolCount: 2, toolsThisTurn: 2, totalTokens: 4800 }),
    },
  } as TranscriptEvent,
]

/**
 * Mock ParsedLogRecords including internal events.
 * These simulate what would come from parsing cli.log and supervisor.log.
 */
export const mockLogRecords: ParsedLogRecord[] = [
  // SessionStart hook event
  {
    pino: { level: 30, time: baseTime, pid: 1234, hostname: 'dev' },
    source: 'cli',
    type: 'HookReceived',
    context: { sessionId, scope: 'project', hook: 'SessionStart' },
    event: rawSidekickEvents[0],
    raw: {},
  },

  // User prompt
  {
    pino: { level: 30, time: baseTime + 15_000, pid: 1234, hostname: 'dev' },
    source: 'cli',
    type: 'HookReceived',
    context: { sessionId, scope: 'project', hook: 'UserPromptSubmit' },
    event: rawSidekickEvents[1],
    raw: {},
  },

  // Internal: Context pruning decision (from supervisor)
  {
    pino: { level: 30, time: baseTime + 18_000, pid: 5678, hostname: 'dev', msg: 'Token limit approaching' },
    source: 'supervisor',
    type: 'ContextPruned',
    context: { sessionId, scope: 'project' },
    payload: {
      reason: 'token_limit',
      tokensBefore: 156_000,
      tokensAfter: 120_000,
      pruned: 36_000,
    },
    raw: {},
  },

  // Assistant transcript event
  {
    pino: { level: 30, time: baseTime + 45_000, pid: 5678, hostname: 'dev' },
    source: 'supervisor',
    type: 'TranscriptEventEmitted',
    context: { sessionId, scope: 'project' },
    event: rawSidekickEvents[2],
    raw: {},
  },

  // Tool read
  {
    pino: { level: 30, time: baseTime + 62_000, pid: 1234, hostname: 'dev' },
    source: 'cli',
    type: 'HookReceived',
    context: { sessionId, scope: 'project', hook: 'PreToolUse' },
    event: rawSidekickEvents[3],
    raw: {},
  },

  // Internal: Summary updated (from supervisor)
  {
    pino: { level: 30, time: baseTime + 65_000, pid: 5678, hostname: 'dev', msg: 'Session summary updated' },
    source: 'supervisor',
    type: 'SummaryUpdated',
    context: { sessionId, scope: 'project' },
    payload: {
      state: {
        title: 'Auth Bug Investigation',
        titleConfidence: 0.92,
        intent: 'Fix token expiration timing issue',
        intentConfidence: 0.88,
      },
      reason: 'tool_use_detected',
    },
    raw: {},
  },

  // Assistant analysis
  {
    pino: { level: 30, time: baseTime + 90_000, pid: 5678, hostname: 'dev' },
    source: 'supervisor',
    type: 'TranscriptEventEmitted',
    context: { sessionId, scope: 'project' },
    event: rawSidekickEvents[5],
    raw: {},
  },

  // Tool edit
  {
    pino: { level: 30, time: baseTime + 105_000, pid: 1234, hostname: 'dev' },
    source: 'cli',
    type: 'HookReceived',
    context: { sessionId, scope: 'project', hook: 'PreToolUse' },
    event: rawSidekickEvents[6],
    raw: {},
  },

  // Internal: Reminder staged (from supervisor)
  {
    pino: { level: 30, time: baseTime + 108_000, pid: 5678, hostname: 'dev', msg: 'Reminder staged for Stop hook' },
    source: 'supervisor',
    type: 'ReminderStaged',
    context: { sessionId, scope: 'project' },
    payload: {
      hookName: 'Stop',
      reminder: {
        name: 'pre-completion',
        blocking: true,
        priority: 100,
        persistent: false,
        userMessage: 'File modifications detected. Verify changes before stopping.',
      },
    },
    raw: {},
  },

  // Final assistant message
  {
    pino: { level: 30, time: baseTime + 120_000, pid: 5678, hostname: 'dev' },
    source: 'supervisor',
    type: 'TranscriptEventEmitted',
    context: { sessionId, scope: 'project' },
    event: rawSidekickEvents[8],
    raw: {},
  },
]

// ============================================================================
// Converted UIEvent Data
// ============================================================================

/**
 * UIEvents converted from SidekickEvents for simple display.
 * Use this for basic timeline without internal events.
 */
export const sidekickUIEvents: UIEvent[] = sidekickEventsToUIEvents(rawSidekickEvents)

/**
 * UIEvents converted from ParsedLogRecords including internal events.
 * This is the full timeline including supervisor internal events.
 */
export const events: UIEvent[] = logRecordsToUIEvents(mockLogRecords)

// ============================================================================
// State Inspector Data
// ============================================================================

export const stateData = {
  current: {
    session_id: 'a1b2c3d4',
    session_title: 'Auth Bug Investigation',
    session_title_confidence: 0.92,
    latest_intent: 'Fix token expiration timing issue',
    latest_intent_confidence: 0.88,
    tokens: {
      input: 12450,
      output: 3200,
    },
    cost_usd: 0.47,
    duration_sec: 120,
  } as StateSnapshot,
  previous: {
    session_id: 'a1b2c3d4',
    session_title: 'Auth Bug Investigation',
    session_title_confidence: 0.85,
    latest_intent: 'Review auth code',
    latest_intent_confidence: 0.72,
    tokens: {
      input: 8200,
      output: 1800,
    },
    cost_usd: 0.31,
    duration_sec: 65,
  } as StateSnapshot,
}

// ============================================================================
// Sample NDJSON for Testing
// ============================================================================

/**
 * Sample NDJSON content that can be used for testing the log parser.
 * Each line is a valid JSON log record.
 */
export const sampleNdjson = mockLogRecords
  .map((record) =>
    JSON.stringify({
      ...record.pino,
      source: record.source,
      type: record.type,
      context: record.context,
      payload: record.payload,
      ...(record.event ? { kind: record.event.kind } : {}),
    })
  )
  .join('\n')
