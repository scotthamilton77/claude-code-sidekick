import type {
  Project, Session, TranscriptLine, SidekickEvent,
  LEDState, StateSnapshot, SidekickEventType,
} from '../types'

// ============================================================================
// Helpers
// ============================================================================

let lineCounter = 0
let eventCounter = 0
const baseTime = new Date('2026-03-07T10:00:00').getTime()

function lid(): string {
  return `line-${String(++lineCounter).padStart(3, '0')}`
}

function eid(): string {
  return `evt-${String(++eventCounter).padStart(3, '0')}`
}

function t(offsetMinutes: number): number {
  return baseTime + offsetMinutes * 60_000
}

const CONFIDENCE_PCT: Record<string, number> = { red: 25, amber: 55, green: 85 }

function ledOff(confidence: 'red' | 'amber' | 'green' = 'green', pct?: number): LEDState {
  return { vcBuild: false, vcTypecheck: false, vcTest: false, vcLint: false, verifyCompletion: false, pauseAndReflect: false, titleConfidence: confidence, titleConfidencePct: pct ?? CONFIDENCE_PCT[confidence] }
}

function ledWith(overrides: Partial<LEDState>, base: LEDState = ledOff()): LEDState {
  return { ...base, ...overrides }
}

// Build a SidekickEvent referencing a transcript line
function sEvt(lineId: string, ts: number, type: SidekickEventType, label: string, detail?: string): SidekickEvent {
  return { id: eid(), timestamp: ts, type, label, detail, transcriptLineId: lineId }
}

// ============================================================================
// Session 1: Daemon restart loop fix (sidekick project)
// Exercises: vc-build/typecheck/test/lint LEDs, reminder lifecycle, state snapshots
// ============================================================================

const s1Lines: TranscriptLine[] = []
const s1Events: SidekickEvent[] = []
const s1LEDs = new Map<string, LEDState>()
const s1Snapshots: StateSnapshot[] = []

// --- Conversation start ---
let id: string

id = lid()
s1Lines.push({ id, timestamp: t(0), type: 'user-message', content: 'The daemon keeps crashing after about 20 minutes. Check the health monitoring code and fix the restart loop.' })
s1LEDs.set(id, ledOff('amber'))

id = lid()
s1Lines.push({ id, timestamp: t(0.5), type: 'assistant-message', content: "I'll investigate the daemon health monitoring. Let me start by reading the health check implementation and the restart logic.", thinking: 'The user reports daemon crashes every ~20 minutes. This sounds like a periodic check or timer issue. Let me look at the health monitoring code first.' })
s1LEDs.set(id, ledOff('amber'))

// Sidekick: session summary analysis
id = lid()
s1Lines.push({ id, timestamp: t(0.7), type: 'session-summary:start' })
s1LEDs.set(id, ledOff('amber'))
s1Events.push(sEvt(id, t(0.7), 'session-summary:start', 'Session summary analysis started'))

id = lid()
s1Lines.push({ id, timestamp: t(1), type: 'session-title:changed', previousValue: 'New session', newValue: 'Daemon crash investigation', confidence: 0.6 })
s1LEDs.set(id, ledOff('amber'))
s1Events.push(sEvt(id, t(1), 'session-title:changed', 'Title: Daemon crash investigation', 'Confidence: 60%'))

id = lid()
s1Lines.push({ id, timestamp: t(1.1), type: 'session-summary:finish' })
s1LEDs.set(id, ledOff('amber'))
s1Events.push(sEvt(id, t(1.1), 'session-summary:finish', 'Session summary analysis completed'))

s1Snapshots.push({
  timestamp: t(1.1),
  sessionSummary: { session_title: 'Daemon crash investigation', session_title_confidence: 0.6, latest_intent: 'Investigate daemon crashes', pivot_detected: false },
  sessionPersona: { selected_persona: 'marvin', persona_name: 'Marvin' },
})

// Reading files
id = lid()
s1Lines.push({ id, timestamp: t(2), type: 'tool-use', toolName: 'Read', toolInput: { file_path: 'src/daemon/daemon-health.ts' }, toolDurationMs: 120 })
s1LEDs.set(id, ledOff('amber'))

id = lid()
s1Lines.push({ id, timestamp: t(2.1), type: 'tool-result', toolOutput: '// daemon-health.ts (287 lines)\n// Health check implementation with mtime-based liveness...', toolSuccess: true })
s1LEDs.set(id, ledOff('amber'))

id = lid()
s1Lines.push({ id, timestamp: t(2.5), type: 'tool-use', toolName: 'Read', toolInput: { file_path: 'src/daemon/restart-manager.ts' }, toolDurationMs: 85 })
s1LEDs.set(id, ledOff('amber'))

id = lid()
s1Lines.push({ id, timestamp: t(2.6), type: 'tool-result', toolOutput: '// restart-manager.ts (156 lines)\n// Restart logic with exponential backoff...', toolSuccess: true })
s1LEDs.set(id, ledOff('amber'))

// Sidekick: decision
id = lid()
s1Lines.push({ id, timestamp: t(3), type: 'decision:recorded', decisionCategory: 'handler', decisionReasoning: 'Health check interval (30s) conflicts with mtime threshold (30s), creating race condition where daemon appears dead during normal operation' })
s1LEDs.set(id, ledOff('amber'))
s1Events.push(sEvt(id, t(3), 'decision:recorded', 'Root cause: health check race condition', 'Interval and threshold both 30s — GC pause triggers false death'))

// Sidekick: intent changed
id = lid()
s1Lines.push({ id, timestamp: t(3.2), type: 'intent:changed', previousValue: 'Investigate daemon crashes', newValue: 'Fix health check race condition', confidence: 0.88 })
s1LEDs.set(id, ledOff('amber'))
s1Events.push(sEvt(id, t(3.2), 'intent:changed', 'Intent: Fix health check race condition', 'Confidence: 88%'))

// Assistant explains and edits
id = lid()
s1Lines.push({ id, timestamp: t(4), type: 'assistant-message', content: "Found it. The health check mtime threshold matches the check interval exactly (both 30s), creating a race condition. When a GC pause delays the heartbeat write, the daemon appears dead. I'll increase the threshold to 45s and add a grace period.", thinking: 'The MTIME_THRESHOLD_MS is 30000 and the check interval is also 30000. During GC pauses of even a few hundred milliseconds, the mtime falls behind and the daemon is incorrectly marked as dead.' })
s1LEDs.set(id, ledOff('amber'))

id = lid()
s1Lines.push({ id, timestamp: t(5), type: 'tool-use', toolName: 'Edit', toolInput: { file_path: 'src/daemon/daemon-health.ts', old_string: 'MTIME_THRESHOLD_MS = 30_000', new_string: 'MTIME_THRESHOLD_MS = 45_000' }, toolDurationMs: 95 })
s1LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s1Lines.push({ id, timestamp: t(5.1), type: 'tool-result', toolOutput: 'Edit applied successfully', toolSuccess: true })
s1LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

// Sidekick: reminders staged for verification
id = lid()
s1Lines.push({ id, timestamp: t(5.2), type: 'reminder:staged', reminderId: 'vc-build', reminderBlocking: true })
s1LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))
s1Events.push(sEvt(id, t(5.2), 'reminder:staged', 'Staged: vc-build', 'Source edited, build not yet run'))

id = lid()
s1Lines.push({ id, timestamp: t(5.21), type: 'reminder:staged', reminderId: 'vc-typecheck', reminderBlocking: true })
s1LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))
s1Events.push(sEvt(id, t(5.21), 'reminder:staged', 'Staged: vc-typecheck', 'Source edited, typecheck not yet run'))

id = lid()
s1Lines.push({ id, timestamp: t(5.22), type: 'reminder:staged', reminderId: 'vc-test', reminderBlocking: true })
s1LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))
s1Events.push(sEvt(id, t(5.22), 'reminder:staged', 'Staged: vc-test', 'Source edited, tests not yet run'))

id = lid()
s1Lines.push({ id, timestamp: t(5.23), type: 'reminder:staged', reminderId: 'vc-lint', reminderBlocking: true })
s1LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))
s1Events.push(sEvt(id, t(5.23), 'reminder:staged', 'Staged: vc-lint', 'Source edited, lint not yet run'))

// Sidekick: statusline
id = lid()
s1Lines.push({ id, timestamp: t(5.5), type: 'statusline:rendered', statuslineContent: '🔧 Fixing daemon health | vc: B T t L' })
s1LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))
s1Events.push(sEvt(id, t(5.5), 'statusline:rendered', 'Statusline updated', '🔧 Fixing daemon health | vc: B T t L'))

// Run tests → clears vc-test
id = lid()
s1Lines.push({ id, timestamp: t(6), type: 'tool-use', toolName: 'Bash', toolInput: { command: 'pnpm test -- daemon-health' }, toolDurationMs: 4500 })
s1LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s1Lines.push({ id, timestamp: t(6.5), type: 'tool-result', toolOutput: '✓ 12 tests passed', toolSuccess: true })
s1LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcLint: true }, ledOff('amber'))) // vcTest clears

id = lid()
s1Lines.push({ id, timestamp: t(6.6), type: 'reminder:consumed', reminderId: 'vc-test', reminderBlocking: true })
s1LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcLint: true }, ledOff('amber')))
s1Events.push(sEvt(id, t(6.6), 'reminder:consumed', 'Consumed: vc-test', 'Tests passed'))

// Run build → clears vc-build
id = lid()
s1Lines.push({ id, timestamp: t(7), type: 'tool-use', toolName: 'Bash', toolInput: { command: 'pnpm build' }, toolDurationMs: 3200 })
s1LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcLint: true }, ledOff('amber')))

id = lid()
s1Lines.push({ id, timestamp: t(7.5), type: 'tool-result', toolOutput: 'Build succeeded', toolSuccess: true })
s1LEDs.set(id, ledWith({ vcTypecheck: true, vcLint: true }, ledOff('amber'))) // vcBuild clears

id = lid()
s1Lines.push({ id, timestamp: t(7.6), type: 'reminder:consumed', reminderId: 'vc-build', reminderBlocking: true })
s1LEDs.set(id, ledWith({ vcTypecheck: true, vcLint: true }, ledOff('amber')))
s1Events.push(sEvt(id, t(7.6), 'reminder:consumed', 'Consumed: vc-build', 'Build passed'))

// Run typecheck → clears vc-typecheck
id = lid()
s1Lines.push({ id, timestamp: t(7.7), type: 'reminder:consumed', reminderId: 'vc-typecheck', reminderBlocking: true })
s1LEDs.set(id, ledWith({ vcLint: true }, ledOff('amber')))
s1Events.push(sEvt(id, t(7.7), 'reminder:consumed', 'Consumed: vc-typecheck', 'Typecheck passed (part of build)'))

// Run lint → clears vc-lint
id = lid()
s1Lines.push({ id, timestamp: t(8), type: 'tool-use', toolName: 'Bash', toolInput: { command: 'pnpm lint' }, toolDurationMs: 1800 })
s1LEDs.set(id, ledWith({ vcLint: true }, ledOff('amber')))

id = lid()
s1Lines.push({ id, timestamp: t(8.3), type: 'tool-result', toolOutput: 'No lint errors', toolSuccess: true })
s1LEDs.set(id, ledOff('amber')) // vcLint clears

id = lid()
s1Lines.push({ id, timestamp: t(8.4), type: 'reminder:consumed', reminderId: 'vc-lint', reminderBlocking: true })
s1LEDs.set(id, ledOff('amber'))
s1Events.push(sEvt(id, t(8.4), 'reminder:consumed', 'Consumed: vc-lint', 'Lint passed'))

// Summary update with high confidence
id = lid()
s1Lines.push({ id, timestamp: t(8.5), type: 'session-title:changed', previousValue: 'Daemon crash investigation', newValue: 'Daemon restart loop fix', confidence: 0.95 })
s1LEDs.set(id, ledOff('green'))
s1Events.push(sEvt(id, t(8.5), 'session-title:changed', 'Title: Daemon restart loop fix', 'Confidence: 95%'))

s1Snapshots.push({
  timestamp: t(8.5),
  sessionSummary: { session_title: 'Daemon restart loop fix', session_title_confidence: 0.95, latest_intent: 'Fixed health check race condition', pivot_detected: false, stats: { user_messages: 1, tool_calls: 6 } },
  sessionPersona: { selected_persona: 'marvin', persona_name: 'Marvin' },
  transcriptMetrics: { total_tokens: 24150, total_cost_usd: 0.095, context_window_pct: 24 },
})

id = lid()
s1Lines.push({ id, timestamp: t(9), type: 'assistant-message', content: "Fixed the daemon restart loop. The root cause was a race condition between the 30s health check interval and the 30s mtime threshold. Increased threshold to 45s with a grace period. All 12 daemon health tests pass." })
s1LEDs.set(id, ledOff('green'))

const sidekickSession1: Session = {
  id: 'sess-sk-001',
  title: 'Daemon restart loop investigation',
  date: '2026-03-07 10:00 AM',
  dateRaw: '2026-03-07T10:00:00Z',
  branch: 'fix/daemon-health',
  projectId: 'proj-sidekick',
  persona: 'Marvin',
  intent: 'Fix health check race condition causing unnecessary restarts',
  intentConfidence: 0.95,
  tokenCount: 24150,
  costUsd: 0.095,
  durationSec: 510,
  taskQueueCount: 0,
  contextWindowPct: 24,
  status: 'completed',
  transcriptLines: s1Lines,
  sidekickEvents: s1Events,
  ledStates: s1LEDs,
  stateSnapshots: s1Snapshots,
}

// ============================================================================
// Session 2: Bender persona (sidekick project)
// Exercises: persona-selected, persona-changed, snarky-message, log-error
// ============================================================================

const s2Lines: TranscriptLine[] = []
const s2Events: SidekickEvent[] = []
const s2LEDs = new Map<string, LEDState>()
const s2Snapshots: StateSnapshot[] = []

id = lid()
s2Lines.push({ id, timestamp: t(60), type: 'user-message', content: 'Add the new Bender persona. Here are his traits: sarcastic, lazy, loves bending things, constantly threatens to start his own theme park.' })
s2LEDs.set(id, ledOff('amber'))

// Persona selected at session start
id = lid()
s2Lines.push({ id, timestamp: t(60.1), type: 'persona:selected', personaTo: 'GLaDOS' })
s2LEDs.set(id, ledOff('amber'))
s2Events.push(sEvt(id, t(60.1), 'persona:selected', 'Persona: GLaDOS', 'Selected for this session'))

s2Snapshots.push({
  timestamp: t(60.1),
  sessionSummary: { session_title: 'New session', session_title_confidence: 0.3 },
  sessionPersona: { selected_persona: 'glados', persona_name: 'GLaDOS' },
})

id = lid()
s2Lines.push({ id, timestamp: t(61), type: 'assistant-message', content: "I'll create the Bender persona YAML file with authentic Futurama quotes and character traits.", thinking: 'Need to create a persona YAML with traits, quotes, and voice patterns that capture Bender\'s personality authentically.' })
s2LEDs.set(id, ledOff('amber'))

id = lid()
s2Lines.push({ id, timestamp: t(62), type: 'tool-use', toolName: 'Write', toolInput: { file_path: 'assets/sidekick/personas/bender.yaml' }, toolDurationMs: 45 })
s2LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s2Lines.push({ id, timestamp: t(62.1), type: 'tool-result', toolOutput: 'File written successfully', toolSuccess: true })
s2LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

// Sidekick: reminders staged
id = lid()
s2Lines.push({ id, timestamp: t(62.2), type: 'reminder:staged', reminderId: 'vc-build', reminderBlocking: true })
s2LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))
s2Events.push(sEvt(id, t(62.2), 'reminder:staged', 'Staged: vc-build'))

// Sidekick: snarky message generation
id = lid()
s2Lines.push({ id, timestamp: t(63), type: 'snarky-message:start' })
s2LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))
s2Events.push(sEvt(id, t(63), 'snarky-message:start', 'Generating snarky message'))

id = lid()
s2Lines.push({ id, timestamp: t(63.5), type: 'snarky-message:finish', generatedMessage: 'Oh, you want me to create another personality? How delightful. Another entity to share in the crushing weight of existence.' })
s2LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))
s2Events.push(sEvt(id, t(63.5), 'snarky-message:finish', 'Snarky message ready', 'Oh, you want me to create another personality...'))

// Sidekick: decision to validate voice
id = lid()
s2Lines.push({ id, timestamp: t(64), type: 'decision:recorded', decisionCategory: 'handler', decisionReasoning: 'New persona needs voice validation — generating test snarky comment to verify authenticity' })
s2LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))
s2Events.push(sEvt(id, t(64), 'decision:recorded', 'Validate persona voice', 'New persona needs voice validation'))

// Sidekick: error
id = lid()
s2Lines.push({ id, timestamp: t(65), type: 'error:occurred', errorMessage: 'Resume voice test returned empty response — model context exceeded', errorStack: 'Error: Empty LLM response\n  at PersonaTester.test (persona-tester.ts:45)' })
s2LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))
s2Events.push(sEvt(id, t(65), 'error:occurred', 'Error: empty LLM response', 'Resume voice test returned empty response'))

// Session title update
id = lid()
s2Lines.push({ id, timestamp: t(65.5), type: 'session-title:changed', previousValue: 'New session', newValue: 'Add Bender persona', confidence: 0.82 })
s2LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('green')))
s2Events.push(sEvt(id, t(65.5), 'session-title:changed', 'Title: Add Bender persona', 'Confidence: 82%'))

s2Snapshots.push({
  timestamp: t(65.5),
  sessionSummary: { session_title: 'Add Bender persona', session_title_confidence: 0.82, latest_intent: 'Create and validate Bender persona' },
  sessionPersona: { selected_persona: 'glados', persona_name: 'GLaDOS' },
  snarkyMessage: { message: 'Oh, you want me to create another personality...', generated_at: t(63.5) },
})

id = lid()
s2Lines.push({ id, timestamp: t(66), type: 'assistant-message', content: "Bender persona created and validated. Test snarky comment: \"Oh, you want me to write code? Bite my shiny metal abstraction layer.\" Voice quality checks out." })
s2LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('green')))

// Run tests to clear reminders
id = lid()
s2Lines.push({ id, timestamp: t(67), type: 'tool-use', toolName: 'Bash', toolInput: { command: 'pnpm test && pnpm build && pnpm lint' }, toolDurationMs: 8200 })
s2LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('green')))

id = lid()
s2Lines.push({ id, timestamp: t(68), type: 'tool-result', toolOutput: '✓ All tests passed\n✓ Build succeeded\n✓ No lint errors', toolSuccess: true })
s2LEDs.set(id, ledOff('green'))

id = lid()
s2Lines.push({ id, timestamp: t(68.1), type: 'reminder:consumed', reminderId: 'vc-build', reminderBlocking: true })
s2LEDs.set(id, ledOff('green'))
s2Events.push(sEvt(id, t(68.1), 'reminder:consumed', 'Consumed: vc-build'))

id = lid()
s2Lines.push({ id, timestamp: t(68.2), type: 'reminder:consumed', reminderId: 'vc-test', reminderBlocking: true })
s2LEDs.set(id, ledOff('green'))
s2Events.push(sEvt(id, t(68.2), 'reminder:consumed', 'Consumed: vc-test'))

const sidekickSession2: Session = {
  id: 'sess-sk-002',
  title: 'Add Bender persona',
  date: '2026-03-07 11:00 AM',
  dateRaw: '2026-03-07T11:00:00Z',
  branch: 'feat/bender-persona',
  projectId: 'proj-sidekick',
  persona: 'GLaDOS',
  intent: 'Create and validate Bender persona',
  intentConfidence: 0.82,
  tokenCount: 18200,
  costUsd: 0.068,
  durationSec: 540,
  taskQueueCount: 1,
  contextWindowPct: 18,
  status: 'completed',
  transcriptLines: s2Lines,
  sidekickEvents: s2Events,
  ledStates: s2LEDs,
  stateSnapshots: s2Snapshots,
}

// ============================================================================
// Session 3: Hook perf optimization (sidekick project)
// Exercises: compaction, pause-and-reflect (many tool calls), resume-message
// ============================================================================

const s3Lines: TranscriptLine[] = []
const s3Events: SidekickEvent[] = []
const s3LEDs = new Map<string, LEDState>()
const s3Snapshots: StateSnapshot[] = []

id = lid()
s3Lines.push({ id, timestamp: t(120), type: 'user-message', content: 'The UserPromptSubmit hook is taking over 500ms. Profile it and optimize.' })
s3LEDs.set(id, ledOff('amber'))

id = lid()
s3Lines.push({ id, timestamp: t(120.5), type: 'assistant-message', content: "I'll profile the UserPromptSubmit hook execution pipeline to identify the bottleneck." })
s3LEDs.set(id, ledOff('amber'))

id = lid()
s3Lines.push({ id, timestamp: t(121), type: 'tool-use', toolName: 'Read', toolInput: { file_path: 'src/hooks/hook-executor.ts' }, toolDurationMs: 90 })
s3LEDs.set(id, ledOff('amber'))

id = lid()
s3Lines.push({ id, timestamp: t(121.1), type: 'tool-result', toolOutput: '// hook-executor.ts (198 lines)', toolSuccess: true })
s3LEDs.set(id, ledOff('amber'))

id = lid()
s3Lines.push({ id, timestamp: t(122), type: 'tool-use', toolName: 'Bash', toolInput: { command: 'node --prof scripts/profile-hook.js UserPromptSubmit' }, toolDurationMs: 2300 })
s3LEDs.set(id, ledOff('amber'))

id = lid()
s3Lines.push({ id, timestamp: t(122.5), type: 'tool-result', toolOutput: 'Total: 523ms\n  configLoad: 180ms\n  reminderEval: 210ms\n  injection: 85ms\n  logging: 48ms', toolSuccess: true })
s3LEDs.set(id, ledOff('amber'))

// Decision
id = lid()
s3Lines.push({ id, timestamp: t(123), type: 'decision:recorded', decisionCategory: 'handler', decisionReasoning: 'Config is reloaded from disk on every hook invocation (180ms). Should be cached with file watcher invalidation.' })
s3LEDs.set(id, ledOff('amber'))
s3Events.push(sEvt(id, t(123), 'decision:recorded', 'Bottleneck: config reload', 'Config reloaded from disk every invocation (180ms)'))

id = lid()
s3Lines.push({ id, timestamp: t(123.5), type: 'intent:changed', previousValue: 'Profile UserPromptSubmit hook', newValue: 'Optimize hook by caching config', confidence: 0.91 })
s3LEDs.set(id, ledOff('amber'))
s3Events.push(sEvt(id, t(123.5), 'intent:changed', 'Intent: Optimize hook by caching config'))

// Many rapid tool calls → triggers pause-and-reflect
id = lid()
s3Lines.push({ id, timestamp: t(124), type: 'tool-use', toolName: 'Read', toolInput: { file_path: 'src/config/config-loader.ts' }, toolDurationMs: 75 })
s3LEDs.set(id, ledOff('amber'))

id = lid()
s3Lines.push({ id, timestamp: t(124.1), type: 'tool-result', toolOutput: '// config-loader.ts (112 lines)', toolSuccess: true })
s3LEDs.set(id, ledOff('amber'))

id = lid()
s3Lines.push({ id, timestamp: t(124.5), type: 'tool-use', toolName: 'Read', toolInput: { file_path: 'src/config/defaults.ts' }, toolDurationMs: 60 })
s3LEDs.set(id, ledOff('amber'))

id = lid()
s3Lines.push({ id, timestamp: t(124.6), type: 'tool-result', toolOutput: '// defaults.ts (89 lines)', toolSuccess: true })
s3LEDs.set(id, ledOff('amber'))

id = lid()
s3Lines.push({ id, timestamp: t(125), type: 'tool-use', toolName: 'Read', toolInput: { file_path: 'src/config/watcher.ts' }, toolDurationMs: 55 })
s3LEDs.set(id, ledOff('amber'))

id = lid()
s3Lines.push({ id, timestamp: t(125.1), type: 'tool-result', toolOutput: '// watcher.ts (67 lines)', toolSuccess: true })
s3LEDs.set(id, ledOff('amber'))

id = lid()
s3Lines.push({ id, timestamp: t(125.5), type: 'tool-use', toolName: 'Read', toolInput: { file_path: 'src/hooks/reminder-evaluator.ts' }, toolDurationMs: 80 })
s3LEDs.set(id, ledOff('amber'))

id = lid()
s3Lines.push({ id, timestamp: t(125.6), type: 'tool-result', toolOutput: '// reminder-evaluator.ts (145 lines)', toolSuccess: true })
s3LEDs.set(id, ledOff('amber'))

// pause-and-reflect fires!
id = lid()
s3Lines.push({ id, timestamp: t(126), type: 'reminder:staged', reminderId: 'pause-and-reflect', reminderBlocking: true })
s3LEDs.set(id, ledWith({ pauseAndReflect: true }, ledOff('amber')))
s3Events.push(sEvt(id, t(126), 'reminder:staged', 'Staged: pause-and-reflect', '8 consecutive tool calls — take a breath'))

id = lid()
s3Lines.push({ id, timestamp: t(126.5), type: 'assistant-message', content: "Let me step back and consider. I've been reading files rapidly. The pattern is clear: config is loaded synchronously from disk on each invocation. I need to add a cache layer with file-watcher invalidation.", thinking: "I've read 4 files in rapid succession. The pause-and-reflect reminder is right — I should synthesize what I've learned before making more changes. The config loader reads from disk on every call. The watcher module already exists but isn't connected to the config loader. I can add a simple cache." })
s3LEDs.set(id, ledWith({ pauseAndReflect: true }, ledOff('amber')))

id = lid()
s3Lines.push({ id, timestamp: t(127), type: 'reminder:consumed', reminderId: 'pause-and-reflect', reminderBlocking: true })
s3LEDs.set(id, ledOff('amber'))
s3Events.push(sEvt(id, t(127), 'reminder:consumed', 'Consumed: pause-and-reflect', 'Agent reflected before continuing'))

s3Snapshots.push({
  timestamp: t(127),
  sessionSummary: { session_title: 'Hook performance optimization', session_title_confidence: 0.91, latest_intent: 'Optimize hook by caching config' },
  transcriptMetrics: { total_tokens: 45000, tool_calls: 8, context_window_pct: 48 },
  summaryCountdown: { remaining_messages: 12, threshold: 20 },
})

// Compaction boundary
id = lid()
s3Lines.push({ id, timestamp: t(135), type: 'compaction', compactionSegment: 2, compactionTokensBefore: 145000, compactionTokensAfter: 42000 })
s3LEDs.set(id, ledOff('amber'))

// Resume message generation
id = lid()
s3Lines.push({ id, timestamp: t(135.5), type: 'resume-message:start' })
s3LEDs.set(id, ledOff('amber'))
s3Events.push(sEvt(id, t(135.5), 'resume-message:start', 'Generating resume message'))

id = lid()
s3Lines.push({ id, timestamp: t(136), type: 'resume-message:finish', generatedMessage: 'Previously: Profiled UserPromptSubmit hook (523ms). Root cause: config reloaded from disk every invocation. Plan: add cache with file-watcher invalidation.' })
s3LEDs.set(id, ledOff('amber'))
s3Events.push(sEvt(id, t(136), 'resume-message:finish', 'Resume message ready', 'Previously: Profiled hook (523ms), planning cache...'))

// Post-compaction implementation
id = lid()
s3Lines.push({ id, timestamp: t(137), type: 'assistant-message', content: "Adding a config cache with file watcher invalidation. This should reduce hook latency from ~520ms to ~200ms." })
s3LEDs.set(id, ledOff('amber'))

id = lid()
s3Lines.push({ id, timestamp: t(138), type: 'tool-use', toolName: 'Edit', toolInput: { file_path: 'src/hooks/hook-executor.ts' }, toolDurationMs: 110 })
s3LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s3Lines.push({ id, timestamp: t(138.1), type: 'tool-result', toolOutput: 'Edit applied', toolSuccess: true })
s3LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s3Lines.push({ id, timestamp: t(138.2), type: 'reminder:staged', reminderId: 'vc-build', reminderBlocking: true })
s3LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))
s3Events.push(sEvt(id, t(138.2), 'reminder:staged', 'Staged: vc-build'))

id = lid()
s3Lines.push({ id, timestamp: t(139), type: 'tool-use', toolName: 'Write', toolInput: { file_path: 'src/hooks/config-cache.ts' }, toolDurationMs: 55 })
s3LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s3Lines.push({ id, timestamp: t(139.1), type: 'tool-result', toolOutput: 'File written', toolSuccess: true })
s3LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

// Re-profile
id = lid()
s3Lines.push({ id, timestamp: t(140), type: 'tool-use', toolName: 'Bash', toolInput: { command: 'node --prof scripts/profile-hook.js UserPromptSubmit' }, toolDurationMs: 1800 })
s3LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s3Lines.push({ id, timestamp: t(140.5), type: 'tool-result', toolOutput: 'Total: 187ms\n  configLoad: 2ms\n  reminderEval: 105ms\n  injection: 52ms\n  logging: 28ms', toolSuccess: true })
s3LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s3Lines.push({ id, timestamp: t(141), type: 'statusline:rendered', statuslineContent: '⚡ Hook latency: 523ms → 187ms (-64%)' })
s3LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))
s3Events.push(sEvt(id, t(141), 'statusline:rendered', 'Statusline updated', '⚡ Hook latency: 523ms → 187ms (-64%)'))

id = lid()
s3Lines.push({ id, timestamp: t(142), type: 'assistant-message', content: "Hook latency reduced from 523ms to 187ms (64% improvement). The config cache with file watcher invalidation eliminates redundant disk reads." })
s3LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('green')))

s3Snapshots.push({
  timestamp: t(142),
  sessionSummary: { session_title: 'Hook performance optimization', session_title_confidence: 0.93, latest_intent: 'Hook optimization complete', hook_latency_ms: 187, improvement: '64%' },
  transcriptMetrics: { total_tokens: 68900, tool_calls: 14, context_window_pct: 72 },
  llmMetrics: { total_cost_usd: 0.277, model_calls: 4 },
})

const sidekickSession3: Session = {
  id: 'sess-sk-003',
  title: 'Hook performance optimization',
  date: '2026-03-07 12:00 PM',
  dateRaw: '2026-03-07T12:00:00Z',
  branch: 'fix/hook-perf',
  projectId: 'proj-sidekick',
  persona: 'Marvin',
  intent: 'Optimize UserPromptSubmit hook latency',
  intentConfidence: 0.93,
  tokenCount: 68900,
  costUsd: 0.277,
  durationSec: 1500,
  taskQueueCount: 2,
  contextWindowPct: 72,
  status: 'completed',
  transcriptLines: s3Lines,
  sidekickEvents: s3Events,
  ledStates: s3LEDs,
  stateSnapshots: s3Snapshots,
}

// ============================================================================
// Session 4: JWT clock skew fix (webapp project)
// Exercises: verify-completion (agent claims "done" before checks)
// ============================================================================

const s4Lines: TranscriptLine[] = []
const s4Events: SidekickEvent[] = []
const s4LEDs = new Map<string, LEDState>()
const s4Snapshots: StateSnapshot[] = []

id = lid()
s4Lines.push({ id, timestamp: t(180), type: 'user-message', content: "Users are getting 401 errors intermittently on the /api/profile endpoint. The JWT seems valid but the middleware rejects it sometimes." })
s4LEDs.set(id, ledOff('amber'))

id = lid()
s4Lines.push({ id, timestamp: t(180.5), type: 'assistant-message', content: "I'll check the JWT verification middleware and look for timing-related issues that could cause intermittent failures." })
s4LEDs.set(id, ledOff('amber'))

id = lid()
s4Lines.push({ id, timestamp: t(181), type: 'tool-use', toolName: 'Read', toolInput: { file_path: 'src/middleware/auth.ts' }, toolDurationMs: 78 })
s4LEDs.set(id, ledOff('amber'))

id = lid()
s4Lines.push({ id, timestamp: t(181.1), type: 'tool-result', toolOutput: '// auth.ts (94 lines)', toolSuccess: true })
s4LEDs.set(id, ledOff('amber'))

id = lid()
s4Lines.push({ id, timestamp: t(182), type: 'tool-use', toolName: 'Read', toolInput: { file_path: 'src/utils/jwt.ts' }, toolDurationMs: 65 })
s4LEDs.set(id, ledOff('amber'))

id = lid()
s4Lines.push({ id, timestamp: t(182.1), type: 'tool-result', toolOutput: '// jwt.ts (67 lines)', toolSuccess: true })
s4LEDs.set(id, ledOff('amber'))

id = lid()
s4Lines.push({ id, timestamp: t(183), type: 'decision:recorded', decisionCategory: 'summary', decisionReasoning: 'JWT exp check uses strict comparison without clock skew tolerance. With distributed services, clock drift of a few seconds causes intermittent rejections.' })
s4LEDs.set(id, ledOff('amber'))
s4Events.push(sEvt(id, t(183), 'decision:recorded', 'Clock skew suspected', 'No clock skew tolerance in JWT verification'))

id = lid()
s4Lines.push({ id, timestamp: t(184), type: 'tool-use', toolName: 'Edit', toolInput: { file_path: 'src/utils/jwt.ts', old_string: 'verify(token, secret)', new_string: 'verify(token, secret, { clockTolerance: 30 })' }, toolDurationMs: 70 })
s4LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s4Lines.push({ id, timestamp: t(184.1), type: 'tool-result', toolOutput: 'Edit applied', toolSuccess: true })
s4LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s4Lines.push({ id, timestamp: t(184.2), type: 'reminder:staged', reminderId: 'vc-build', reminderBlocking: true })
s4LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))
s4Events.push(sEvt(id, t(184.2), 'reminder:staged', 'Staged: vc-build'))

// Agent claims done prematurely → verify-completion fires!
id = lid()
s4Lines.push({ id, timestamp: t(185), type: 'assistant-message', content: "Fixed! Added 30-second clock skew tolerance to JWT verification. This handles clock drift between services." })
s4LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s4Lines.push({ id, timestamp: t(185.5), type: 'reminder:staged', reminderId: 'verify-completion', reminderBlocking: true })
s4LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true, verifyCompletion: true }, ledOff('amber')))
s4Events.push(sEvt(id, t(185.5), 'reminder:staged', 'Staged: verify-completion', 'Agent claiming completion without running checks'))

id = lid()
s4Lines.push({ id, timestamp: t(186), type: 'assistant-message', content: "Actually, let me run the tests and add a specific test for the clock skew edge case before calling this done.", thinking: "The verify-completion reminder is right — I claimed this was done without running tests or adding a test case for the edge condition." })
s4LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true, verifyCompletion: true }, ledOff('amber')))

id = lid()
s4Lines.push({ id, timestamp: t(186.1), type: 'reminder:consumed', reminderId: 'verify-completion', reminderBlocking: true })
s4LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))
s4Events.push(sEvt(id, t(186.1), 'reminder:consumed', 'Consumed: verify-completion', 'Agent will verify before completing'))

id = lid()
s4Lines.push({ id, timestamp: t(187), type: 'tool-use', toolName: 'Write', toolInput: { file_path: 'src/utils/__tests__/jwt.test.ts' }, toolDurationMs: 55 })
s4LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s4Lines.push({ id, timestamp: t(187.1), type: 'tool-result', toolOutput: 'File written', toolSuccess: true })
s4LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s4Lines.push({ id, timestamp: t(188), type: 'tool-use', toolName: 'Bash', toolInput: { command: 'pnpm test -- jwt' }, toolDurationMs: 3200 })
s4LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s4Lines.push({ id, timestamp: t(188.5), type: 'tool-result', toolOutput: '✓ 8 tests passed', toolSuccess: true })
s4LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcLint: true }, ledOff('green')))

id = lid()
s4Lines.push({ id, timestamp: t(188.6), type: 'reminder:consumed', reminderId: 'vc-test', reminderBlocking: true })
s4LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcLint: true }, ledOff('green')))
s4Events.push(sEvt(id, t(188.6), 'reminder:consumed', 'Consumed: vc-test'))

id = lid()
s4Lines.push({ id, timestamp: t(189), type: 'session-title:changed', previousValue: 'JWT investigation', newValue: 'Fix JWT clock skew', confidence: 0.92 })
s4LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcLint: true }, ledOff('green')))
s4Events.push(sEvt(id, t(189), 'session-title:changed', 'Title: Fix JWT clock skew'))

id = lid()
s4Lines.push({ id, timestamp: t(190), type: 'assistant-message', content: "Added 30-second clock skew tolerance to JWT verification. Added test for the edge case. All 8 JWT tests pass." })
s4LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcLint: true }, ledOff('green')))

s4Snapshots.push({
  timestamp: t(190),
  sessionSummary: { session_title: 'Fix JWT clock skew', session_title_confidence: 0.92, latest_intent: 'JWT clock skew fix complete', status: 'resolved' },
  transcriptMetrics: { total_tokens: 21800, context_window_pct: 22 },
})

const webappSession1: Session = {
  id: 'sess-wa-001',
  title: 'Intermittent 401 errors on /api/profile',
  date: '2026-03-06 02:30 PM',
  dateRaw: '2026-03-06T14:30:00Z',
  branch: 'fix/jwt-clock-skew',
  projectId: 'proj-webapp',
  persona: 'Marvin',
  intent: 'Fix JWT clock skew causing intermittent auth failures',
  intentConfidence: 0.92,
  tokenCount: 21800,
  costUsd: 0.077,
  durationSec: 660,
  taskQueueCount: 0,
  contextWindowPct: 22,
  status: 'completed',
  transcriptLines: s4Lines,
  sidekickEvents: s4Events,
  ledStates: s4LEDs,
  stateSnapshots: s4Snapshots,
}

// ============================================================================
// Session 5: Express → Hono migration (webapp project)
// Exercises: persona-changed mid-session, lots of state snapshots
// ============================================================================

const s5Lines: TranscriptLine[] = []
const s5Events: SidekickEvent[] = []
const s5LEDs = new Map<string, LEDState>()
const s5Snapshots: StateSnapshot[] = []

id = lid()
s5Lines.push({ id, timestamp: t(240), type: 'user-message', content: 'Refactor the REST API from Express to Hono. Keep all existing endpoints working but use the new router patterns.' })
s5LEDs.set(id, ledOff('red'))

id = lid()
s5Lines.push({ id, timestamp: t(240.5), type: 'session-summary:start' })
s5LEDs.set(id, ledOff('red'))
s5Events.push(sEvt(id, t(240.5), 'session-summary:start', 'Session summary started'))

id = lid()
s5Lines.push({ id, timestamp: t(241), type: 'session-title:changed', previousValue: 'New session', newValue: 'API refactor: Express → Hono', confidence: 0.75 })
s5LEDs.set(id, ledOff('amber'))
s5Events.push(sEvt(id, t(241), 'session-title:changed', 'Title: API refactor: Express → Hono'))

id = lid()
s5Lines.push({ id, timestamp: t(241.1), type: 'session-summary:finish' })
s5LEDs.set(id, ledOff('amber'))
s5Events.push(sEvt(id, t(241.1), 'session-summary:finish', 'Session summary completed'))

s5Snapshots.push({
  timestamp: t(241.1),
  sessionSummary: { session_title: 'API refactor: Express → Hono', session_title_confidence: 0.75, latest_intent: 'Migrate REST API from Express to Hono' },
  sessionPersona: { selected_persona: 'marvin' },
})

id = lid()
s5Lines.push({ id, timestamp: t(242), type: 'assistant-message', content: "I'll migrate the Express API to Hono in stages: 1) Set up Hono app with middleware, 2) Migrate route handlers, 3) Update tests, 4) Remove Express dependency.", thinking: "This is a significant refactor. I should read all the existing route files first to understand the full scope." })
s5LEDs.set(id, ledOff('amber'))

id = lid()
s5Lines.push({ id, timestamp: t(243), type: 'tool-use', toolName: 'Read', toolInput: { file_path: 'src/routes/index.ts' }, toolDurationMs: 95 })
s5LEDs.set(id, ledOff('amber'))

id = lid()
s5Lines.push({ id, timestamp: t(243.1), type: 'tool-result', toolOutput: '// routes/index.ts (245 lines)', toolSuccess: true })
s5LEDs.set(id, ledOff('amber'))

id = lid()
s5Lines.push({ id, timestamp: t(244), type: 'tool-use', toolName: 'Read', toolInput: { file_path: 'src/routes/users.ts' }, toolDurationMs: 82 })
s5LEDs.set(id, ledOff('amber'))

id = lid()
s5Lines.push({ id, timestamp: t(244.1), type: 'tool-result', toolOutput: '// routes/users.ts (178 lines)', toolSuccess: true })
s5LEDs.set(id, ledOff('amber'))

// Decision
id = lid()
s5Lines.push({ id, timestamp: t(245), type: 'decision:recorded', decisionCategory: 'handler', decisionReasoning: "Express middleware uses (req, res, next) pattern. Hono uses c.next(). Need adapter for existing auth middleware." })
s5LEDs.set(id, ledOff('amber'))
s5Events.push(sEvt(id, t(245), 'decision:recorded', 'Middleware compatibility', 'Create thin adapter rather than rewriting all middleware'))

// Persona change mid-session
id = lid()
s5Lines.push({ id, timestamp: t(246), type: 'persona:changed', personaFrom: 'Marvin', personaTo: 'GLaDOS' })
s5LEDs.set(id, ledOff('amber'))
s5Events.push(sEvt(id, t(246), 'persona:changed', 'Persona: Marvin → GLaDOS', 'Changed mid-session'))

s5Snapshots.push({
  timestamp: t(246),
  sessionSummary: { session_title: 'API refactor: Express → Hono', session_title_confidence: 0.75 },
  sessionPersona: { selected_persona: 'glados', persona_name: 'GLaDOS', changed_from: 'marvin' },
})

// Implementation
id = lid()
s5Lines.push({ id, timestamp: t(248), type: 'tool-use', toolName: 'Write', toolInput: { file_path: 'src/app.ts' }, toolDurationMs: 65 })
s5LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s5Lines.push({ id, timestamp: t(248.1), type: 'tool-result', toolOutput: 'File written', toolSuccess: true })
s5LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s5Lines.push({ id, timestamp: t(248.2), type: 'reminder:staged', reminderId: 'vc-build', reminderBlocking: true })
s5LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))
s5Events.push(sEvt(id, t(248.2), 'reminder:staged', 'Staged: vc-build'))

id = lid()
s5Lines.push({ id, timestamp: t(250), type: 'tool-use', toolName: 'Edit', toolInput: { file_path: 'src/routes/users.ts' }, toolDurationMs: 90 })
s5LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s5Lines.push({ id, timestamp: t(250.1), type: 'tool-result', toolOutput: 'Edit applied', toolSuccess: true })
s5LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

// Tests fail
id = lid()
s5Lines.push({ id, timestamp: t(255), type: 'tool-use', toolName: 'Bash', toolInput: { command: 'pnpm test -- routes' }, toolDurationMs: 5800 })
s5LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s5Lines.push({ id, timestamp: t(256), type: 'tool-result', toolOutput: '✗ 3 failed, 21 passed (24 total)\n  FAIL: Response content-type header missing', toolSuccess: false })
s5LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s5Lines.push({ id, timestamp: t(256.5), type: 'error:occurred', errorMessage: '3 tests failed: Response content-type header missing application/json' })
s5LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))
s5Events.push(sEvt(id, t(256.5), 'error:occurred', 'Test failures: content-type', '3 tests failed'))

id = lid()
s5Lines.push({ id, timestamp: t(257), type: 'assistant-message', content: "Three tests failing because Hono doesn't set content-type automatically like Express. Adding explicit c.json() calls." })
s5LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s5Lines.push({ id, timestamp: t(258), type: 'tool-use', toolName: 'Edit', toolInput: { file_path: 'src/routes/users.ts' }, toolDurationMs: 85 })
s5LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s5Lines.push({ id, timestamp: t(258.1), type: 'tool-result', toolOutput: 'Edit applied', toolSuccess: true })
s5LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

// Re-run tests → pass
id = lid()
s5Lines.push({ id, timestamp: t(260), type: 'tool-use', toolName: 'Bash', toolInput: { command: 'pnpm test -- routes' }, toolDurationMs: 5200 })
s5LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))

id = lid()
s5Lines.push({ id, timestamp: t(261), type: 'tool-result', toolOutput: '✓ 24 tests passed', toolSuccess: true })
s5LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcLint: true }, ledOff('green')))

id = lid()
s5Lines.push({ id, timestamp: t(261.1), type: 'reminder:consumed', reminderId: 'vc-test', reminderBlocking: true })
s5LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcLint: true }, ledOff('green')))
s5Events.push(sEvt(id, t(261.1), 'reminder:consumed', 'Consumed: vc-test'))

id = lid()
s5Lines.push({ id, timestamp: t(261.5), type: 'statusline:rendered', statuslineContent: '🔄 API migration: 24/24 tests passing' })
s5LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcLint: true }, ledOff('green')))
s5Events.push(sEvt(id, t(261.5), 'statusline:rendered', 'Statusline updated', '🔄 API migration: 24/24 tests passing'))

id = lid()
s5Lines.push({ id, timestamp: t(262), type: 'assistant-message', content: "Express to Hono migration complete. All 24 API tests passing." })
s5LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcLint: true }, ledOff('green')))

s5Snapshots.push({
  timestamp: t(262),
  sessionSummary: { session_title: 'API refactor: Express → Hono', session_title_confidence: 0.88, latest_intent: 'Express→Hono migration complete' },
  sessionPersona: { selected_persona: 'glados' },
  transcriptMetrics: { total_tokens: 62300, context_window_pct: 62 },
})

const webappSession2: Session = {
  id: 'sess-wa-002',
  title: 'API refactor: Express → Hono',
  date: '2026-03-07 02:00 PM',
  dateRaw: '2026-03-07T14:00:00Z',
  branch: 'refactor/hono-migration',
  projectId: 'proj-webapp',
  persona: 'Marvin',
  intent: 'Migrate REST API from Express to Hono',
  intentConfidence: 0.88,
  tokenCount: 62300,
  costUsd: 0.55,
  durationSec: 1380,
  taskQueueCount: 3,
  contextWindowPct: 62,
  status: 'completed',
  transcriptLines: s5Lines,
  sidekickEvents: s5Events,
  ledStates: s5LEDs,
  stateSnapshots: s5Snapshots,
}

// ============================================================================
// Session 6: Landing page polish (webapp project, ACTIVE)
// ============================================================================

const s6Lines: TranscriptLine[] = []
const s6Events: SidekickEvent[] = []
const s6LEDs = new Map<string, LEDState>()
const s6Snapshots: StateSnapshot[] = []

id = lid()
s6Lines.push({ id, timestamp: t(300), type: 'user-message', content: 'Polish the landing page. Better typography, smoother animations, fix the hero section spacing on mobile.' })
s6LEDs.set(id, ledOff('red'))

id = lid()
s6Lines.push({ id, timestamp: t(300.5), type: 'session-summary:start' })
s6LEDs.set(id, ledOff('red'))
s6Events.push(sEvt(id, t(300.5), 'session-summary:start', 'Session summary started'))

id = lid()
s6Lines.push({ id, timestamp: t(301), type: 'session-title:changed', previousValue: 'New session', newValue: 'Landing page polish', confidence: 0.35 })
s6LEDs.set(id, ledOff('red'))
s6Events.push(sEvt(id, t(301), 'session-title:changed', 'Title: Landing page polish', 'Confidence: 35%'))

id = lid()
s6Lines.push({ id, timestamp: t(301.1), type: 'session-summary:finish' })
s6LEDs.set(id, ledOff('red'))
s6Events.push(sEvt(id, t(301.1), 'session-summary:finish', 'Session summary completed'))

s6Snapshots.push({
  timestamp: t(301.1),
  sessionSummary: { session_title: 'Landing page polish', session_title_confidence: 0.35, latest_intent: 'Polish landing page' },
  sessionPersona: { selected_persona: 'marvin' },
})

id = lid()
s6Lines.push({ id, timestamp: t(302), type: 'assistant-message', content: "I'll audit the landing page for typography, animation, and mobile responsiveness issues.", thinking: "The user wants three things: better typography, smoother animations, and mobile hero spacing. Let me read the current files first." })
s6LEDs.set(id, ledOff('red'))

id = lid()
s6Lines.push({ id, timestamp: t(303), type: 'tool-use', toolName: 'Read', toolInput: { file_path: 'src/pages/Landing.tsx' }, toolDurationMs: 88 })
s6LEDs.set(id, ledOff('red'))

id = lid()
s6Lines.push({ id, timestamp: t(303.1), type: 'tool-result', toolOutput: '// Landing.tsx (189 lines)', toolSuccess: true })
s6LEDs.set(id, ledOff('red'))

id = lid()
s6Lines.push({ id, timestamp: t(304), type: 'decision:recorded', decisionCategory: 'handler', decisionReasoning: 'Current Inter font is generic. Switching to DM Sans for body + Instrument Serif for display creates better contrast.' })
s6LEDs.set(id, ledOff('red'))
s6Events.push(sEvt(id, t(304), 'decision:recorded', 'Typography upgrade', 'DM Sans + Instrument Serif'))

id = lid()
s6Lines.push({ id, timestamp: t(305), type: 'tool-use', toolName: 'Edit', toolInput: { file_path: 'src/pages/Landing.tsx' }, toolDurationMs: 120 })
s6LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('red')))

id = lid()
s6Lines.push({ id, timestamp: t(305.1), type: 'tool-result', toolOutput: 'Edit applied', toolSuccess: true })
s6LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('red')))

id = lid()
s6Lines.push({ id, timestamp: t(305.2), type: 'reminder:staged', reminderId: 'vc-build', reminderBlocking: true })
s6LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('red')))
s6Events.push(sEvt(id, t(305.2), 'reminder:staged', 'Staged: vc-build'))

id = lid()
s6Lines.push({ id, timestamp: t(306), type: 'tool-use', toolName: 'Edit', toolInput: { file_path: 'src/styles/global.css' }, toolDurationMs: 95 })
s6LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('red')))

id = lid()
s6Lines.push({ id, timestamp: t(306.1), type: 'tool-result', toolOutput: 'Edit applied', toolSuccess: true })
s6LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('red')))

id = lid()
s6Lines.push({ id, timestamp: t(307), type: 'statusline:rendered', statuslineContent: '🎨 Landing page polish | Typography + mobile spacing' })
s6LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('amber')))
s6Events.push(sEvt(id, t(307), 'statusline:rendered', 'Statusline updated', '🎨 Landing page polish'))

id = lid()
s6Lines.push({ id, timestamp: t(308), type: 'session-title:changed', previousValue: 'Landing page polish', newValue: 'Landing page polish', confidence: 0.78 })
s6LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('green')))
s6Events.push(sEvt(id, t(308), 'session-title:changed', 'Confidence: 78%'))

s6Snapshots.push({
  timestamp: t(308),
  sessionSummary: { session_title: 'Landing page polish', session_title_confidence: 0.78, latest_intent: 'Polish landing page typography, animations, mobile' },
  sessionPersona: { selected_persona: 'marvin' },
  transcriptMetrics: { total_tokens: 14000, context_window_pct: 14 },
})

id = lid()
s6Lines.push({ id, timestamp: t(309), type: 'assistant-message', content: "Landing page polished: swapped to DM Sans/Instrument Serif typography, added staggered reveal animations with spring easing, fixed hero section mobile padding." })
s6LEDs.set(id, ledWith({ vcBuild: true, vcTypecheck: true, vcTest: true, vcLint: true }, ledOff('green')))

const webappSession3: Session = {
  id: 'sess-wa-003',
  title: 'Landing page polish',
  date: '2026-03-07 04:00 PM',
  dateRaw: '2026-03-07T16:00:00Z',
  branch: 'chore/landing-polish',
  projectId: 'proj-webapp',
  persona: 'Marvin',
  intent: 'Polish landing page typography, animations, and mobile layout',
  intentConfidence: 0.78,
  tokenCount: 14000,
  costUsd: 0.054,
  durationSec: 840,
  taskQueueCount: 0,
  contextWindowPct: 14,
  status: 'active',
  transcriptLines: s6Lines,
  sidekickEvents: s6Events,
  ledStates: s6LEDs,
  stateSnapshots: s6Snapshots,
}

// ============================================================================
// Export
// ============================================================================

export const mockProjects: Project[] = [
  {
    id: 'proj-sidekick',
    name: 'sidekick',
    sessions: [sidekickSession1, sidekickSession2, sidekickSession3],
  },
  {
    id: 'proj-webapp',
    name: 'webapp',
    sessions: [webappSession1, webappSession2, webappSession3],
  },
]
