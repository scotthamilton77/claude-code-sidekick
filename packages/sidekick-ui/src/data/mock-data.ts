import type { Project, TimelineEvent, Session } from '../types'

// ============================================================================
// Helpers
// ============================================================================

let eventCounter = 0
const baseTime = new Date('2026-03-07T10:00:00').getTime()

function eid(): string {
  return `evt-${String(++eventCounter).padStart(3, '0')}`
}

function t(offsetMinutes: number): number {
  return baseTime + offsetMinutes * 60_000
}

// ============================================================================
// Project: sidekick (3 sessions)
// ============================================================================

const sidekickSession1Events: TimelineEvent[] = [
  { id: eid(), timestamp: t(0), type: 'session-start', label: 'Session started' },
  { id: eid(), timestamp: t(0.2), type: 'hook-execution', label: 'SessionStart hook', hookName: 'SessionStart', hookDurationMs: 45, hookSuccess: true, hookOutput: 'Initialized session context' },
  { id: eid(), timestamp: t(0.5), type: 'user-message', label: 'User prompt', content: 'The daemon keeps crashing after about 20 minutes. Check the health monitoring code and fix the restart loop.' },
  { id: eid(), timestamp: t(1), type: 'llm-call', label: 'Claude analysis', llmModel: 'claude-sonnet-4-5-20250514', llmTokensIn: 8200, llmTokensOut: 1450, llmCostUsd: 0.034, llmLatencyMs: 2100 },
  { id: eid(), timestamp: t(1.5), type: 'assistant-message', label: 'Reading daemon health code', content: "I'll investigate the daemon health monitoring. Let me start by reading the health check implementation and the restart logic." },
  { id: eid(), timestamp: t(2), type: 'tool-use', label: 'Read daemon-health.ts', toolName: 'Read', toolInput: { file_path: 'src/daemon/daemon-health.ts' }, toolResult: { lines: 287 }, toolDurationMs: 120 },
  { id: eid(), timestamp: t(2.5), type: 'tool-use', label: 'Read restart-manager.ts', toolName: 'Read', toolInput: { file_path: 'src/daemon/restart-manager.ts' }, toolResult: { lines: 156 }, toolDurationMs: 85 },
  { id: eid(), timestamp: t(3), type: 'decision', label: 'Root cause identified', decisionCategory: 'handler', decisionReasoning: 'Health check interval (30s) conflicts with mtime threshold (30s), creating race condition where daemon appears dead during normal operation', decisionImpact: 'Daemon restarts unnecessarily every ~20 minutes when GC pause aligns with health check' },
  { id: eid(), timestamp: t(3.5), type: 'state-change', label: 'Intent updated', confidence: 0.88, stateSnapshot: { title: 'Daemon restart loop fix', intent: 'Fix health check race condition', titleConfidence: 0.92 }, previousSnapshot: { title: 'Daemon crash investigation', intent: 'Investigate daemon crashes', titleConfidence: 0.6 } },
  { id: eid(), timestamp: t(4), type: 'llm-call', label: 'Generate fix', llmModel: 'claude-sonnet-4-5-20250514', llmTokensIn: 14500, llmTokensOut: 2800, llmCostUsd: 0.061, llmLatencyMs: 3200 },
  { id: eid(), timestamp: t(4.5), type: 'assistant-message', label: 'Implementing fix', content: "Found it. The health check mtime threshold matches the check interval exactly (both 30s), creating a race condition. When a GC pause delays the heartbeat write, the daemon appears dead. I'll increase the threshold to 45s and add a grace period." },
  { id: eid(), timestamp: t(5), type: 'tool-use', label: 'Edit daemon-health.ts', toolName: 'Edit', toolInput: { file_path: 'src/daemon/daemon-health.ts', old_string: 'MTIME_THRESHOLD_MS = 30_000', new_string: 'MTIME_THRESHOLD_MS = 45_000' }, toolResult: { success: true }, toolDurationMs: 95 },
  { id: eid(), timestamp: t(5.2), type: 'hook-execution', label: 'PostToolUse hook', hookName: 'PostToolUse', hookDurationMs: 32, hookSuccess: true },
  { id: eid(), timestamp: t(5.5), type: 'reminder', label: 'Reminder staged: run tests', reminderAction: 'staged', reminderHook: 'Stop', reminderBlocking: true, reminderPriority: 100 },
  { id: eid(), timestamp: t(6), type: 'tool-use', label: 'Run tests', toolName: 'Bash', toolInput: { command: 'pnpm test -- daemon-health' }, toolResult: { exitCode: 0, tests: 12, passed: 12 }, toolDurationMs: 4500 },
  { id: eid(), timestamp: t(7), type: 'statusline-call', label: 'Statusline updated', statuslineContent: '🔧 Fixing daemon health | 12/12 tests passing' },
  { id: eid(), timestamp: t(7.5), type: 'assistant-message', label: 'Fix complete', content: "Fixed the daemon restart loop. The root cause was a race condition between the 30s health check interval and the 30s mtime threshold. Increased threshold to 45s with a grace period. All 12 daemon health tests pass." },
  { id: eid(), timestamp: t(8), type: 'reminder', label: 'Reminder consumed: run tests', reminderAction: 'consumed', reminderHook: 'Stop', reminderBlocking: true, reminderPriority: 100 },
  { id: eid(), timestamp: t(8.5), type: 'state-change', label: 'Summary confidence high', confidence: 0.95, stateSnapshot: { title: 'Daemon restart loop fix', intent: 'Fixed health check race condition', titleConfidence: 0.95, status: 'resolved' }, previousSnapshot: { title: 'Daemon restart loop fix', intent: 'Fix health check race condition', titleConfidence: 0.92 } },
]

const sidekickSession1: Session = {
  id: 'sess-sk-001',
  title: 'Daemon restart loop investigation',
  date: '2026-03-07 10:00 AM',
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
  events: sidekickSession1Events,
}

const sidekickSession2Events: TimelineEvent[] = [
  { id: eid(), timestamp: t(60), type: 'session-start', label: 'Session started' },
  { id: eid(), timestamp: t(60.2), type: 'hook-execution', label: 'SessionStart hook', hookName: 'SessionStart', hookDurationMs: 38, hookSuccess: true },
  { id: eid(), timestamp: t(60.5), type: 'persona-change', label: 'Persona set: Marvin → GLaDOS', personaFrom: 'Marvin', personaTo: 'GLaDOS' },
  { id: eid(), timestamp: t(61), type: 'user-message', label: 'User prompt', content: 'Add the new Bender persona. Here are his traits: sarcastic, lazy, loves bending things, constantly threatens to start his own theme park.' },
  { id: eid(), timestamp: t(61.5), type: 'llm-call', label: 'Persona generation', llmModel: 'claude-sonnet-4-5-20250514', llmTokensIn: 6800, llmTokensOut: 3200, llmCostUsd: 0.041, llmLatencyMs: 4100 },
  { id: eid(), timestamp: t(62), type: 'assistant-message', label: 'Creating persona file', content: "I'll create the Bender persona YAML file with authentic Futurama quotes and character traits." },
  { id: eid(), timestamp: t(63), type: 'tool-use', label: 'Write bender.yaml', toolName: 'Write', toolInput: { file_path: 'assets/sidekick/personas/bender.yaml' }, toolResult: { success: true }, toolDurationMs: 45 },
  { id: eid(), timestamp: t(63.5), type: 'hook-execution', label: 'PostToolUse hook', hookName: 'PostToolUse', hookDurationMs: 28, hookSuccess: true },
  { id: eid(), timestamp: t(64), type: 'decision', label: 'Validate persona voice', decisionCategory: 'handler', decisionReasoning: 'New persona needs voice validation — generating test snarky comment to verify authenticity', decisionImpact: 'LLM call to test persona voice quality' },
  { id: eid(), timestamp: t(64.5), type: 'llm-call', label: 'Voice test: snarky', llmModel: 'claude-sonnet-4-5-20250514', llmTokensIn: 4200, llmTokensOut: 180, llmCostUsd: 0.014, llmLatencyMs: 1200 },
  { id: eid(), timestamp: t(65), type: 'state-change', label: 'Persona registered', confidence: 0.82, stateSnapshot: { personas: ['Marvin', 'GLaDOS', 'Bender', 'HAL9000'], activePersona: 'GLaDOS' }, previousSnapshot: { personas: ['Marvin', 'GLaDOS', 'HAL9000'], activePersona: 'GLaDOS' } },
  { id: eid(), timestamp: t(65.5), type: 'statusline-call', label: 'Statusline updated', statuslineContent: '🤖 Persona: GLaDOS | 4 personas loaded' },
  { id: eid(), timestamp: t(66), type: 'assistant-message', label: 'Persona test results', content: "Bender persona created and validated. Test snarky comment: \"Oh, you want me to write code? Bite my shiny metal abstraction layer.\" Voice quality checks out." },
  { id: eid(), timestamp: t(67), type: 'reminder', label: 'Reminder staged: update docs', reminderAction: 'staged', reminderHook: 'UserPromptSubmit', reminderBlocking: false, reminderPriority: 50 },
  { id: eid(), timestamp: t(68), type: 'error', label: 'Persona test failed (resume)', errorMessage: 'Resume voice test returned empty response — model context exceeded', errorStack: 'Error: Empty LLM response\n  at PersonaTester.test (persona-tester.ts:45)\n  at async runVoiceTests (persona-tester.ts:78)' },
  { id: eid(), timestamp: t(68.5), type: 'llm-call', label: 'Retry: resume test', llmModel: 'claude-sonnet-4-5-20250514', llmTokensIn: 3800, llmTokensOut: 250, llmCostUsd: 0.013, llmLatencyMs: 1500 },
  { id: eid(), timestamp: t(69), type: 'assistant-message', label: 'All tests passing', content: "Resume voice test passed on retry. All persona voice tests now passing for Bender." },
]

const sidekickSession2: Session = {
  id: 'sess-sk-002',
  title: 'Add Bender persona',
  date: '2026-03-07 11:00 AM',
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
  events: sidekickSession2Events,
}

const sidekickSession3Events: TimelineEvent[] = [
  { id: eid(), timestamp: t(120), type: 'session-start', label: 'Session started' },
  { id: eid(), timestamp: t(120.3), type: 'hook-execution', label: 'SessionStart hook', hookName: 'SessionStart', hookDurationMs: 41, hookSuccess: true },
  { id: eid(), timestamp: t(121), type: 'user-message', label: 'User prompt', content: 'The UserPromptSubmit hook is taking over 500ms. Profile it and optimize.' },
  { id: eid(), timestamp: t(121.5), type: 'llm-call', label: 'Initial analysis', llmModel: 'claude-sonnet-4-5-20250514', llmTokensIn: 9100, llmTokensOut: 1600, llmCostUsd: 0.037, llmLatencyMs: 1800 },
  { id: eid(), timestamp: t(122), type: 'assistant-message', label: 'Profiling hook pipeline', content: "I'll profile the UserPromptSubmit hook execution pipeline to identify the bottleneck." },
  { id: eid(), timestamp: t(123), type: 'tool-use', label: 'Read hook-executor.ts', toolName: 'Read', toolInput: { file_path: 'src/hooks/hook-executor.ts' }, toolResult: { lines: 198 }, toolDurationMs: 90 },
  { id: eid(), timestamp: t(124), type: 'tool-use', label: 'Bash: profile hook', toolName: 'Bash', toolInput: { command: 'node --prof scripts/profile-hook.js UserPromptSubmit' }, toolResult: { totalMs: 523, breakdown: { configLoad: 180, reminderEval: 210, injection: 85, logging: 48 } }, toolDurationMs: 2300 },
  { id: eid(), timestamp: t(125), type: 'decision', label: 'Bottleneck: config reload', decisionCategory: 'handler', decisionReasoning: 'Config is reloaded from disk on every hook invocation (180ms). Should be cached with file watcher invalidation.', decisionImpact: 'Expected 60% latency reduction' },
  { id: eid(), timestamp: t(126), type: 'state-change', label: 'Intent refined', confidence: 0.91, stateSnapshot: { intent: 'Optimize hook by caching config', phase: 'implementing' }, previousSnapshot: { intent: 'Profile UserPromptSubmit hook', phase: 'investigating' } },
  // Compaction boundary
  { id: eid(), timestamp: t(135), type: 'compaction', label: 'Context compacted (segment 1→2)', compactionSegment: 2, compactionTokensBefore: 145000, compactionTokensAfter: 42000 },
  { id: eid(), timestamp: t(136), type: 'llm-call', label: 'Post-compaction analysis', llmModel: 'claude-sonnet-4-5-20250514', llmTokensIn: 42000, llmTokensOut: 2100, llmCostUsd: 0.14, llmLatencyMs: 3800 },
  { id: eid(), timestamp: t(137), type: 'assistant-message', label: 'Implementing config cache', content: "Adding a config cache with file watcher invalidation. This should reduce hook latency from ~520ms to ~200ms." },
  { id: eid(), timestamp: t(138), type: 'tool-use', label: 'Edit hook-executor.ts', toolName: 'Edit', toolInput: { file_path: 'src/hooks/hook-executor.ts' }, toolResult: { success: true }, toolDurationMs: 110 },
  { id: eid(), timestamp: t(138.5), type: 'hook-execution', label: 'PostToolUse hook', hookName: 'PostToolUse', hookDurationMs: 35, hookSuccess: true },
  { id: eid(), timestamp: t(139), type: 'tool-use', label: 'Write config-cache.ts', toolName: 'Write', toolInput: { file_path: 'src/hooks/config-cache.ts' }, toolResult: { success: true }, toolDurationMs: 55 },
  { id: eid(), timestamp: t(140), type: 'reminder', label: 'Reminder staged: verify perf', reminderAction: 'staged', reminderHook: 'Stop', reminderBlocking: true, reminderPriority: 100 },
  { id: eid(), timestamp: t(141), type: 'tool-use', label: 'Bash: re-profile', toolName: 'Bash', toolInput: { command: 'node --prof scripts/profile-hook.js UserPromptSubmit' }, toolResult: { totalMs: 187, breakdown: { configLoad: 2, reminderEval: 105, injection: 52, logging: 28 } }, toolDurationMs: 1800 },
  { id: eid(), timestamp: t(142), type: 'statusline-call', label: 'Statusline updated', statuslineContent: '⚡ Hook latency: 523ms → 187ms (-64%)' },
  { id: eid(), timestamp: t(143), type: 'assistant-message', label: 'Optimization complete', content: "Hook latency reduced from 523ms to 187ms (64% improvement). The config cache with file watcher invalidation eliminates redundant disk reads." },
  { id: eid(), timestamp: t(143.5), type: 'hook-execution', label: 'PreToolUse hook (failed)', hookName: 'PreToolUse', hookDurationMs: 5012, hookSuccess: false, hookOutput: 'Timeout: hook exceeded 5000ms deadline' },
  { id: eid(), timestamp: t(143.7), type: 'error', label: 'Hook timeout error', errorMessage: 'PreToolUse hook exceeded 5000ms deadline during test run', errorStack: 'TimeoutError: Hook execution exceeded deadline\n  at HookExecutor.run (hook-executor.ts:67)\n  at async executeHookPipeline (pipeline.ts:23)' },
  { id: eid(), timestamp: t(144), type: 'reminder', label: 'Reminder consumed: verify perf', reminderAction: 'consumed', reminderHook: 'Stop', reminderBlocking: true, reminderPriority: 100 },
  { id: eid(), timestamp: t(145), type: 'state-change', label: 'Session complete', confidence: 0.93, stateSnapshot: { intent: 'Hook optimization complete', hookLatencyMs: 187, improvement: '64%' }, previousSnapshot: { intent: 'Optimize hook by caching config', hookLatencyMs: 523 } },
]

const sidekickSession3: Session = {
  id: 'sess-sk-003',
  title: 'Hook performance optimization',
  date: '2026-03-07 12:00 PM',
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
  events: sidekickSession3Events,
}

// ============================================================================
// Project: webapp (3 sessions)
// ============================================================================

const webappSession1Events: TimelineEvent[] = [
  { id: eid(), timestamp: t(180), type: 'session-start', label: 'Session started' },
  { id: eid(), timestamp: t(180.2), type: 'hook-execution', label: 'SessionStart hook', hookName: 'SessionStart', hookDurationMs: 52, hookSuccess: true },
  { id: eid(), timestamp: t(180.5), type: 'user-message', label: 'User prompt', content: "Users are getting 401 errors intermittently on the /api/profile endpoint. The JWT seems valid but the middleware rejects it sometimes." },
  { id: eid(), timestamp: t(181), type: 'llm-call', label: 'Initial analysis', llmModel: 'claude-sonnet-4-5-20250514', llmTokensIn: 7600, llmTokensOut: 1200, llmCostUsd: 0.029, llmLatencyMs: 1700 },
  { id: eid(), timestamp: t(181.5), type: 'assistant-message', label: 'Investigating auth middleware', content: "I'll check the JWT verification middleware and look for timing-related issues that could cause intermittent failures." },
  { id: eid(), timestamp: t(182), type: 'tool-use', label: 'Read auth-middleware.ts', toolName: 'Read', toolInput: { file_path: 'src/middleware/auth.ts' }, toolResult: { lines: 94 }, toolDurationMs: 78 },
  { id: eid(), timestamp: t(183), type: 'tool-use', label: 'Read jwt-utils.ts', toolName: 'Read', toolInput: { file_path: 'src/utils/jwt.ts' }, toolResult: { lines: 67 }, toolDurationMs: 65 },
  { id: eid(), timestamp: t(184), type: 'decision', label: 'Clock skew suspected', decisionCategory: 'summary', decisionReasoning: 'JWT exp check uses strict comparison without clock skew tolerance. With distributed services, clock drift of a few seconds causes intermittent rejections.', decisionImpact: 'Adding 30s clock skew tolerance should eliminate intermittent 401s' },
  { id: eid(), timestamp: t(184.5), type: 'state-change', label: 'Root cause found', confidence: 0.85, stateSnapshot: { intent: 'Fix JWT clock skew issue', rootCause: 'No clock skew tolerance in JWT verification' }, previousSnapshot: { intent: 'Investigate intermittent 401 errors' } },
  { id: eid(), timestamp: t(185), type: 'llm-call', label: 'Generate fix', llmModel: 'claude-sonnet-4-5-20250514', llmTokensIn: 12400, llmTokensOut: 1800, llmCostUsd: 0.048, llmLatencyMs: 2400 },
  { id: eid(), timestamp: t(186), type: 'tool-use', label: 'Edit jwt.ts', toolName: 'Edit', toolInput: { file_path: 'src/utils/jwt.ts', old_string: 'verify(token, secret)', new_string: 'verify(token, secret, { clockTolerance: 30 })' }, toolResult: { success: true }, toolDurationMs: 70 },
  { id: eid(), timestamp: t(186.5), type: 'hook-execution', label: 'PostToolUse hook', hookName: 'PostToolUse', hookDurationMs: 29, hookSuccess: true },
  { id: eid(), timestamp: t(187), type: 'reminder', label: 'Reminder staged: add test', reminderAction: 'staged', reminderHook: 'Stop', reminderBlocking: true, reminderPriority: 100 },
  { id: eid(), timestamp: t(188), type: 'tool-use', label: 'Write jwt.test.ts', toolName: 'Write', toolInput: { file_path: 'src/utils/__tests__/jwt.test.ts' }, toolResult: { success: true }, toolDurationMs: 55 },
  { id: eid(), timestamp: t(189), type: 'tool-use', label: 'Run tests', toolName: 'Bash', toolInput: { command: 'pnpm test -- jwt' }, toolResult: { exitCode: 0, tests: 8, passed: 8 }, toolDurationMs: 3200 },
  { id: eid(), timestamp: t(190), type: 'assistant-message', label: 'Fix deployed', content: "Added 30-second clock skew tolerance to JWT verification. This handles clock drift between services. Added test for the edge case. All 8 JWT tests pass." },
  { id: eid(), timestamp: t(190.5), type: 'reminder', label: 'Reminder consumed: add test', reminderAction: 'consumed', reminderHook: 'Stop', reminderBlocking: true, reminderPriority: 100 },
  { id: eid(), timestamp: t(191), type: 'state-change', label: 'Bug resolved', confidence: 0.92, stateSnapshot: { intent: 'JWT clock skew fix complete', status: 'resolved', testsAdded: 1 }, previousSnapshot: { intent: 'Fix JWT clock skew issue' } },
]

const webappSession1: Session = {
  id: 'sess-wa-001',
  title: 'Intermittent 401 errors on /api/profile',
  date: '2026-03-06 02:30 PM',
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
  events: webappSession1Events,
}

const webappSession2Events: TimelineEvent[] = [
  { id: eid(), timestamp: t(240), type: 'session-start', label: 'Session started' },
  { id: eid(), timestamp: t(240.2), type: 'hook-execution', label: 'SessionStart hook', hookName: 'SessionStart', hookDurationMs: 44, hookSuccess: true },
  { id: eid(), timestamp: t(240.5), type: 'user-message', label: 'User prompt', content: 'Refactor the REST API from Express to Hono. Keep all existing endpoints working but use the new router patterns.' },
  { id: eid(), timestamp: t(241), type: 'llm-call', label: 'Migration planning', llmModel: 'claude-opus-4-6', llmTokensIn: 22000, llmTokensOut: 4500, llmCostUsd: 0.42, llmLatencyMs: 8200 },
  { id: eid(), timestamp: t(242), type: 'assistant-message', label: 'Migration plan', content: "I'll migrate the Express API to Hono in stages: 1) Set up Hono app with middleware, 2) Migrate route handlers, 3) Update tests, 4) Remove Express dependency." },
  { id: eid(), timestamp: t(243), type: 'tool-use', label: 'Read routes/index.ts', toolName: 'Read', toolInput: { file_path: 'src/routes/index.ts' }, toolResult: { lines: 245 }, toolDurationMs: 95 },
  { id: eid(), timestamp: t(244), type: 'tool-use', label: 'Read routes/users.ts', toolName: 'Read', toolInput: { file_path: 'src/routes/users.ts' }, toolResult: { lines: 178 }, toolDurationMs: 82 },
  { id: eid(), timestamp: t(245), type: 'tool-use', label: 'Read routes/posts.ts', toolName: 'Read', toolInput: { file_path: 'src/routes/posts.ts' }, toolResult: { lines: 312 }, toolDurationMs: 110 },
  { id: eid(), timestamp: t(246), type: 'decision', label: 'Middleware compatibility', decisionCategory: 'handler', decisionReasoning: "Express middleware uses (req, res, next) pattern. Hono uses c.next(). Need adapter for existing auth middleware.", decisionImpact: 'Create thin adapter rather than rewriting all middleware' },
  { id: eid(), timestamp: t(248), type: 'tool-use', label: 'Write app.ts (Hono)', toolName: 'Write', toolInput: { file_path: 'src/app.ts' }, toolResult: { success: true }, toolDurationMs: 65 },
  { id: eid(), timestamp: t(250), type: 'tool-use', label: 'Edit users route', toolName: 'Edit', toolInput: { file_path: 'src/routes/users.ts' }, toolResult: { success: true }, toolDurationMs: 90 },
  { id: eid(), timestamp: t(252), type: 'tool-use', label: 'Edit posts route', toolName: 'Edit', toolInput: { file_path: 'src/routes/posts.ts' }, toolResult: { success: true }, toolDurationMs: 105 },
  { id: eid(), timestamp: t(254), type: 'state-change', label: 'Routes migrated', confidence: 0.72, stateSnapshot: { intent: 'Migrating API to Hono', phase: 'testing', routesMigrated: 3, routesTotal: 3 }, previousSnapshot: { phase: 'implementing', routesMigrated: 1 } },
  { id: eid(), timestamp: t(255), type: 'llm-call', label: 'Test migration', llmModel: 'claude-sonnet-4-5-20250514', llmTokensIn: 35000, llmTokensOut: 3800, llmCostUsd: 0.13, llmLatencyMs: 5100 },
  { id: eid(), timestamp: t(256), type: 'tool-use', label: 'Run API tests', toolName: 'Bash', toolInput: { command: 'pnpm test -- routes' }, toolResult: { exitCode: 1, tests: 24, passed: 21, failed: 3 }, toolDurationMs: 5800 },
  { id: eid(), timestamp: t(257), type: 'error', label: 'Test failures: content-type', errorMessage: '3 tests failed: Response content-type header missing application/json', errorStack: 'AssertionError: expected undefined to equal "application/json"\n  at routes/users.test.ts:45\n  at routes/users.test.ts:78\n  at routes/posts.test.ts:102' },
  { id: eid(), timestamp: t(258), type: 'assistant-message', label: 'Fixing content-type', content: "Three tests failing because Hono doesn't set content-type automatically like Express. Adding explicit c.json() calls." },
  { id: eid(), timestamp: t(259), type: 'tool-use', label: 'Fix route responses', toolName: 'Edit', toolInput: { file_path: 'src/routes/users.ts' }, toolResult: { success: true }, toolDurationMs: 85 },
  { id: eid(), timestamp: t(260), type: 'tool-use', label: 'Run API tests (retry)', toolName: 'Bash', toolInput: { command: 'pnpm test -- routes' }, toolResult: { exitCode: 0, tests: 24, passed: 24 }, toolDurationMs: 5200 },
  { id: eid(), timestamp: t(261), type: 'statusline-call', label: 'Statusline updated', statuslineContent: '🔄 API migration: 24/24 tests passing' },
  { id: eid(), timestamp: t(262), type: 'assistant-message', label: 'Migration complete', content: "Express to Hono migration complete. All 24 API tests passing. Three test fixes needed for explicit content-type handling." },
  { id: eid(), timestamp: t(263), type: 'state-change', label: 'Refactor complete', confidence: 0.88, stateSnapshot: { intent: 'Express→Hono migration complete', testsPass: 24 }, previousSnapshot: { intent: 'Migrating API to Hono', phase: 'testing' } },
]

const webappSession2: Session = {
  id: 'sess-wa-002',
  title: 'API refactor: Express → Hono',
  date: '2026-03-07 02:00 PM',
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
  events: webappSession2Events,
}

const webappSession3Events: TimelineEvent[] = [
  { id: eid(), timestamp: t(300), type: 'session-start', label: 'Session started' },
  { id: eid(), timestamp: t(300.2), type: 'hook-execution', label: 'SessionStart hook', hookName: 'SessionStart', hookDurationMs: 39, hookSuccess: true },
  { id: eid(), timestamp: t(300.5), type: 'user-message', label: 'User prompt', content: 'Polish the landing page. Better typography, smoother animations, fix the hero section spacing on mobile.' },
  { id: eid(), timestamp: t(301), type: 'llm-call', label: 'Design analysis', llmModel: 'claude-sonnet-4-5-20250514', llmTokensIn: 11200, llmTokensOut: 2800, llmCostUsd: 0.054, llmLatencyMs: 3400 },
  { id: eid(), timestamp: t(302), type: 'assistant-message', label: 'Reading current styles', content: "I'll audit the landing page for typography, animation, and mobile responsiveness issues." },
  { id: eid(), timestamp: t(303), type: 'tool-use', label: 'Read landing.tsx', toolName: 'Read', toolInput: { file_path: 'src/pages/Landing.tsx' }, toolResult: { lines: 189 }, toolDurationMs: 88 },
  { id: eid(), timestamp: t(304), type: 'tool-use', label: 'Read global.css', toolName: 'Read', toolInput: { file_path: 'src/styles/global.css' }, toolResult: { lines: 312 }, toolDurationMs: 72 },
  { id: eid(), timestamp: t(305), type: 'decision', label: 'Typography upgrade', decisionCategory: 'handler', decisionReasoning: 'Current Inter font is generic. Switching to DM Sans for body + Instrument Serif for display creates better contrast and personality.', decisionImpact: 'Visual distinctiveness without adding weight' },
  { id: eid(), timestamp: t(306), type: 'tool-use', label: 'Edit landing.tsx', toolName: 'Edit', toolInput: { file_path: 'src/pages/Landing.tsx' }, toolResult: { success: true }, toolDurationMs: 120 },
  { id: eid(), timestamp: t(307), type: 'tool-use', label: 'Edit global.css', toolName: 'Edit', toolInput: { file_path: 'src/styles/global.css' }, toolResult: { success: true }, toolDurationMs: 95 },
  { id: eid(), timestamp: t(308), type: 'state-change', label: 'Typography updated', confidence: 0.35, stateSnapshot: { intent: 'Landing page polish', phase: 'animations', typographyDone: true }, previousSnapshot: { intent: 'Landing page polish', phase: 'typography' } },
  { id: eid(), timestamp: t(309), type: 'tool-use', label: 'Edit animations', toolName: 'Edit', toolInput: { file_path: 'src/pages/Landing.tsx' }, toolResult: { success: true }, toolDurationMs: 145 },
  { id: eid(), timestamp: t(310), type: 'hook-execution', label: 'PostToolUse hook', hookName: 'PostToolUse', hookDurationMs: 31, hookSuccess: true },
  { id: eid(), timestamp: t(311), type: 'tool-use', label: 'Fix mobile spacing', toolName: 'Edit', toolInput: { file_path: 'src/styles/global.css' }, toolResult: { success: true }, toolDurationMs: 80 },
  { id: eid(), timestamp: t(312), type: 'statusline-call', label: 'Statusline updated', statuslineContent: '🎨 Landing page polish | Mobile + animations done' },
  { id: eid(), timestamp: t(313), type: 'assistant-message', label: 'Polish complete', content: "Landing page polished: swapped to DM Sans/Instrument Serif typography, added staggered reveal animations with spring easing, fixed hero section mobile padding (was 1rem, now responsive 1rem→3rem)." },
  { id: eid(), timestamp: t(314), type: 'state-change', label: 'Polish complete', confidence: 0.78, stateSnapshot: { intent: 'Landing page polish complete', changes: ['typography', 'animations', 'mobile-spacing'] }, previousSnapshot: { intent: 'Landing page polish', phase: 'animations' } },
]

const webappSession3: Session = {
  id: 'sess-wa-003',
  title: 'Landing page polish',
  date: '2026-03-07 04:00 PM',
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
  events: webappSession3Events,
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
