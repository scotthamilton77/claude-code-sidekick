/**
 * Performance Regression Tests
 *
 * Lightweight performance tests to catch significant regressions in critical paths.
 * These tests ensure large log handling remains performant without external API calls.
 *
 * Thresholds are set to catch 2x+ performance degradations while allowing for
 * normal variance in CI environments. CI environments use relaxed thresholds
 * to account for slower/shared hardware.
 *
 * @see docs/design/TEST-FIXTURES.md §4 Test Data Management
 */

import { describe, it, expect } from 'vitest'
import { parseNdjson, NdjsonStreamParser, mergeLogStreams } from '../log-parser'
import { buildTimeline, TimeTravelStore } from '../replay-engine'
import type { ParsedLogRecord } from '../log-parser'

// ============================================================================
// CI-Aware Threshold Configuration
// ============================================================================

/**
 * Detect CI environment and apply threshold multiplier.
 * CI environments often have slower/shared hardware, so we relax thresholds.
 */
const isCI = process.env.CI === 'true'
const THRESHOLD_MULTIPLIER = isCI ? 5 : 1 // 5x relaxed in CI

// ============================================================================
// Test Fixture Generators
// ============================================================================

/**
 * Generate a large NDJSON dataset for performance testing.
 * Creates realistic log entries with varying event types.
 */
function generateLargeNdjson(lineCount: number): string {
  const lines: string[] = []
  const eventTypes = [
    'HookReceived',
    'HookCompleted',
    'ReminderStaged',
    'ReminderConsumed',
    'SummaryUpdated',
    'TranscriptMetricsUpdated',
  ]

  for (let i = 0; i < lineCount; i++) {
    const entry = {
      level: 30,
      time: 1678888888000 + i * 1000,
      pid: 12345,
      hostname: 'test-host',
      name: 'sidekick:cli',
      msg: `Event ${i}`,
      type: eventTypes[i % eventTypes.length],
      source: i % 2 === 0 ? 'cli' : 'supervisor',
      context: {
        session_id: `sess-${Math.floor(i / 100)}`,
        scope: 'project',
        correlation_id: `corr-${i}`,
      },
      payload: {
        data: `payload-${i}`,
        count: i,
      },
    }
    lines.push(JSON.stringify(entry))
  }

  return lines.join('\n')
}

/**
 * Generate log records directly (skip JSON parsing overhead).
 */
function generateLogRecords(count: number): ParsedLogRecord[] {
  const records: ParsedLogRecord[] = []
  const eventTypes = ['SummaryUpdated', 'ReminderStaged', 'ReminderConsumed', 'TranscriptMetricsUpdated']

  for (let i = 0; i < count; i++) {
    records.push({
      pino: {
        level: 30,
        time: 1678888888000 + i * 1000,
        pid: 12345,
        hostname: 'test-host',
        name: 'sidekick:cli',
      },
      source: i % 2 === 0 ? 'cli' : 'supervisor',
      type: eventTypes[i % eventTypes.length],
      context: {
        session_id: `sess-${Math.floor(i / 100)}`,
      },
      payload:
        eventTypes[i % eventTypes.length] === 'SummaryUpdated'
          ? { state: { title: `Session ${i}`, titleConfidence: 0.9 } }
          : eventTypes[i % eventTypes.length] === 'ReminderStaged'
            ? {
                hookName: 'UserPromptSubmit',
                reminder: {
                  name: `Reminder-${i}`,
                  blocking: false,
                  priority: 10,
                  persistent: false,
                },
              }
            : eventTypes[i % eventTypes.length] === 'TranscriptMetricsUpdated'
              ? {}
              : { hookName: 'UserPromptSubmit', reminderName: `Reminder-${i - 1}` },
      metadata:
        eventTypes[i % eventTypes.length] === 'TranscriptMetricsUpdated'
          ? {
              metrics: {
                turnCount: Math.floor(i / 10),
                toolCount: i,
                toolsThisTurn: i % 5,
                messageCount: i * 2,
                tokenUsage: {
                  inputTokens: i * 100,
                  outputTokens: i * 50,
                  totalTokens: i * 150,
                  cacheCreationInputTokens: 0,
                  cacheReadInputTokens: i * 10,
                  cacheTiers: {
                    ephemeral5mInputTokens: 0,
                    ephemeral1hInputTokens: 0,
                  },
                  serviceTierCounts: {},
                  byModel: {},
                },
                toolsPerTurn: 0,
                lastProcessedLine: i,
                lastUpdatedAt: 1678888888000 + i * 1000,
              },
            }
          : undefined,
      raw: {},
    })
  }

  return records
}

// ============================================================================
// Performance Test Utilities
// ============================================================================

/**
 * Measure execution time of a function.
 * Returns time in milliseconds.
 */
function measureTime(fn: () => void): number {
  const start = performance.now()
  fn()
  const end = performance.now()
  return end - start
}

/**
 * Assert that execution time is below threshold.
 * Logs actual time for monitoring trends.
 * Automatically applies CI multiplier to threshold.
 */
function expectPerformance(name: string, actualMs: number, baseThresholdMs: number): void {
  const effectiveThreshold = baseThresholdMs * THRESHOLD_MULTIPLIER
  const ciNote = isCI ? ' (CI mode)' : ''

  // Log actual time for CI monitoring (useful for tracking perf trends)
  // eslint-disable-next-line no-console -- Performance test output for CI
  console.log(`[PERF] ${name}: ${actualMs.toFixed(2)}ms (threshold: ${effectiveThreshold}ms)${ciNote}`)

  // Assert threshold
  expect(actualMs).toBeLessThan(effectiveThreshold)
}

// ============================================================================
// Log Parser Performance Tests
// ============================================================================

describe('Log Parser Performance', () => {
  it('parses 1000 lines in <100ms', () => {
    const ndjson = generateLargeNdjson(1000)

    const duration = measureTime(() => {
      const records = parseNdjson(ndjson)
      expect(records.length).toBe(1000)
    })

    expectPerformance('parseNdjson(1000 lines)', duration, 100)
  })

  it('parses 10000 lines in <500ms', () => {
    const ndjson = generateLargeNdjson(10000)

    const duration = measureTime(() => {
      const records = parseNdjson(ndjson)
      expect(records.length).toBe(10000)
    })

    expectPerformance('parseNdjson(10000 lines)', duration, 500)
  })

  it('streaming parser handles large chunks efficiently', () => {
    const ndjson = generateLargeNdjson(5000)
    const parser = new NdjsonStreamParser()

    const duration = measureTime(() => {
      // Simulate chunked reading (like file streaming)
      const chunkSize = 1024
      for (let i = 0; i < ndjson.length; i += chunkSize) {
        parser.push(ndjson.slice(i, i + chunkSize))
      }
      parser.flush()
      expect(parser.getRecords().length).toBe(5000)
    })

    expectPerformance('NdjsonStreamParser(5000 lines, chunked)', duration, 300)
  })

  it('merges large log streams efficiently', () => {
    const cliRecords = generateLogRecords(1000)
    const supervisorRecords = generateLogRecords(1000)

    const duration = measureTime(() => {
      const merged = mergeLogStreams(cliRecords, supervisorRecords)
      expect(merged.length).toBe(2000)
    })

    expectPerformance('mergeLogStreams(2000 records)', duration, 50)
  })
})

// ============================================================================
// Replay Engine Performance Tests
// ============================================================================

describe('Replay Engine Performance', () => {
  it('builds timeline from 1000 events in <200ms', () => {
    const records = generateLogRecords(1000)

    const duration = measureTime(() => {
      const timeline = buildTimeline(records)
      // Not all records are state-changing, so timeline will be smaller
      expect(timeline.length).toBeGreaterThan(0)
      expect(timeline.length).toBeLessThanOrEqual(1000)
    })

    expectPerformance('buildTimeline(1000 events)', duration, 200)
  })

  it('builds timeline from 5000 events in <1000ms', () => {
    const records = generateLogRecords(5000)

    const duration = measureTime(() => {
      const timeline = buildTimeline(records)
      expect(timeline.length).toBeGreaterThan(0)
    })

    expectPerformance('buildTimeline(5000 events)', duration, 1000)
  })

  it('time-travel queries remain fast with large timeline', () => {
    const records = generateLogRecords(2000)
    const store = new TimeTravelStore()
    store.load(records)

    const duration = measureTime(() => {
      // Perform 100 deterministic time-travel queries spread across the timeline
      // Using deterministic timestamps ensures reproducible test results
      for (let i = 0; i < 100; i++) {
        // Spread queries evenly across timeline (base + 0-2000 seconds)
        const timestamp = 1678888888000 + i * 20000
        const state = store.getStateAt(timestamp)
        expect(state).toBeDefined()
      }
    })

    expectPerformance('100 time-travel queries on 2000-event timeline', duration, 100)
  })

  it('appending to existing timeline is incremental', () => {
    const initialRecords = generateLogRecords(1000)
    const store = new TimeTravelStore()
    store.load(initialRecords)

    const newRecords = generateLogRecords(1000)

    const duration = measureTime(() => {
      store.append(newRecords)
    })

    // Appending should be faster than initial load since it starts from last state
    expectPerformance('append(1000 events to existing timeline)', duration, 150)
  })
})

// ============================================================================
// Memory Efficiency Tests
// ============================================================================

describe('Memory Efficiency', () => {
  it('does not leak memory with repeated parsing', () => {
    const ndjson = generateLargeNdjson(500)

    // Parse 20 times and verify no exponential memory growth
    // (This is a smoke test - proper memory profiling requires different tools)
    const duration = measureTime(() => {
      for (let i = 0; i < 20; i++) {
        const records = parseNdjson(ndjson)
        expect(records.length).toBe(500)
      }
    })

    // Total time should be roughly linear (20 * single parse time)
    // If memory leaks cause GC thrashing, this will be much slower
    expectPerformance('20 iterations of parseNdjson(500 lines)', duration, 400)
  })

  it('timeline store handles load/reset cycles efficiently', () => {
    const records = generateLogRecords(500)
    const store = new TimeTravelStore()

    const duration = measureTime(() => {
      for (let i = 0; i < 20; i++) {
        store.load(records)
        expect(store.length).toBeGreaterThan(0)
        store.reset()
        expect(store.length).toBe(0)
      }
    })

    expectPerformance('20 load/reset cycles (500 events each)', duration, 800)
  })
})

// ============================================================================
// Real-World Scenario Tests
// ============================================================================

describe('Real-World Performance Scenarios', () => {
  it('handles realistic session log volume efficiently', () => {
    // Realistic scenario: 30-minute session with events every 2 seconds
    // = ~900 events, split between CLI and Supervisor
    const cliRecords = generateLogRecords(450)
    const supervisorRecords = generateLogRecords(450)

    const duration = measureTime(() => {
      // Step 1: Parse logs
      const merged = mergeLogStreams(cliRecords, supervisorRecords)

      // Step 2: Build timeline
      const store = new TimeTravelStore()
      store.load(merged)

      // Step 3: Query final state
      const finalState = store.getStateAt(Number.MAX_SAFE_INTEGER)

      expect(finalState).toBeDefined()
      expect(store.length).toBeGreaterThan(0)
    })

    expectPerformance('Full session replay (900 events)', duration, 300)
  })

  it('handles live log streaming simulation', () => {
    const store = new TimeTravelStore()
    const batchSize = 10
    const totalBatches = 50 // 500 events total

    const duration = measureTime(() => {
      for (let batch = 0; batch < totalBatches; batch++) {
        const newRecords = generateLogRecords(batchSize)
        store.append(newRecords)
      }
    })

    expect(store.length).toBeGreaterThan(0)
    expectPerformance('50 incremental appends (10 events each)', duration, 200)
  })
})
