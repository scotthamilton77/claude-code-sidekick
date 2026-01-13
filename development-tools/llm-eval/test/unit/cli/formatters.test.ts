/**
 * Tests for CLI Output Formatters
 *
 * Validates pretty printing, progress tracking, and table formatting.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest'
import {
  formatBenchmarkResults,
  formatReferenceResults,
  ProgressIndicator,
  logger,
} from '../../../src/cli/formatters.js'
import type { BenchmarkResult } from '../../../src/benchmark/core/BenchmarkTypes.js'
import type { GenerationResult } from '../../../src/benchmark/core/types.js'

describe('formatBenchmarkResults', () => {
  const mockResult: BenchmarkResult = {
    metadata: {
      mode: 'quick',
      modelsFilter: 'all',
      referenceVersion: 'latest',
      outputDir: '/tmp/results/2025-01-01_120000',
      timestamp: '2025-01-01T12:00:00Z',
      transcriptCount: 10,
      runCount: 3,
    },
    models: [
      {
        provider: 'claude',
        model: 'claude-sonnet-4-5-20250929',
        pricing: { inputPerMillion: 3.0, outputPerMillion: 15.0 },
        tags: 'default,premium',
        latency: { min: 1200, max: 3500, avg: 2100, count: 10 },
        scores: {
          totalRuns: 10,
          apiFailures: 0,
          timeouts: 1,
          otherApiErrors: 0,
          successfulRuns: 9,
          errorRate: 0.1,
          timeoutRate: 0.1,
          otherErrorRate: 0,
          schemaAvg: 92.1,
          technicalAvg: 87.4,
          contentAvg: 76.8,
          overallAvg: 86.5,
        },
      },
      {
        provider: 'openai',
        model: 'gpt-4o',
        pricing: { inputPerMillion: 5.0, outputPerMillion: 15.0 },
        tags: 'default,premium',
        latency: { min: 1500, max: 4200, avg: 2800, count: 10 },
        scores: {
          totalRuns: 10,
          apiFailures: 1,
          timeouts: 0,
          otherApiErrors: 0,
          successfulRuns: 9,
          errorRate: 0.1,
          timeoutRate: 0,
          otherErrorRate: 0,
          schemaAvg: 89.3,
          technicalAvg: 84.2,
          contentAvg: 78.1,
          overallAvg: 84.5,
        },
      },
    ],
  }

  it('formats benchmark results as pretty text by default', () => {
    const output = formatBenchmarkResults(mockResult, { color: false })

    expect(output).toContain('BENCHMARK RESULTS')
    expect(output).toContain('Run Configuration:')
    expect(output).toContain('Mode: quick')
    expect(output).toContain('Models: all')
    expect(output).toContain('Reference Version: latest')
    expect(output).toContain('Transcript Count: 10')
    expect(output).toContain('Model Performance:')
    expect(output).toContain('claude:claude-sonnet-4-5-20250929')
    expect(output).toContain('openai:gpt-4o')
    expect(output).toContain('Summary:')
    expect(output).toContain('Total Models: 2')
    expect(output).toContain('Total Runs: 20')
  })

  it('formats benchmark results as JSON when json option is true', () => {
    const output = formatBenchmarkResults(mockResult, { json: true })

    const parsed = JSON.parse(output) as BenchmarkResult
    expect(parsed).toEqual(mockResult)
  })

  it('includes termination information when model is terminated', () => {
    const terminatedResult: BenchmarkResult = {
      ...mockResult,
      models: [
        ...mockResult.models,
        {
          provider: 'test',
          model: 'test-model',
          pricing: { inputPerMillion: 1.0, outputPerMillion: 2.0 },
          tags: 'test',
          latency: { min: 1000, max: 2000, avg: 1500, count: 5 },
          scores: {
            totalRuns: 5,
            apiFailures: 0,
            timeouts: 3,
            otherApiErrors: 0,
            successfulRuns: 2,
            errorRate: 0.6,
            timeoutRate: 0.6,
            otherErrorRate: 0,
            schemaAvg: 50.0,
            technicalAvg: 50.0,
            contentAvg: 50.0,
            overallAvg: 50.0,
          },
          terminated: true,
          terminationReason: '3 consecutive timeouts',
        },
      ],
    }

    const output = formatBenchmarkResults(terminatedResult, { color: false })

    expect(output).toContain('EARLY TERMINATION')
    expect(output).toContain('3 consecutive timeouts')
  })

  it('formats scores with 2 decimal places', () => {
    const output = formatBenchmarkResults(mockResult, { color: false })

    expect(output).toContain('92.10') // schema avg
    expect(output).toContain('87.40') // technical avg
    expect(output).toContain('76.80') // content avg
    expect(output).toContain('86.50') // overall avg
  })

  it('formats latency with avg and range', () => {
    const output = formatBenchmarkResults(mockResult, { color: false })

    expect(output).toContain('2100 (1200-3500)') // claude latency
    expect(output).toContain('2800 (1500-4200)') // openai latency
  })

  it('formats error rates as percentages', () => {
    const output = formatBenchmarkResults(mockResult, { color: false })

    expect(output).toContain('10.0%') // 0.1 error rate
  })
})

describe('formatReferenceResults', () => {
  const mockResult: GenerationResult = {
    versionedDir: '/tmp/references/v1.0_2025-01-01_120000',
    totalCount: 15,
    successCount: 13,
    skipCount: 1,
    failCount: 1,
    duration: 1200, // 20 minutes in seconds
  }

  it('formats reference results as pretty text by default', () => {
    const output = formatReferenceResults(mockResult, { color: false })

    expect(output).toContain('REFERENCE GENERATION RESULTS')
    expect(output).toContain('Generation Statistics:')
    expect(output).toContain('Total: 15')
    expect(output).toContain('Success: 13')
    expect(output).toContain('Skipped: 1')
    expect(output).toContain('Failed: 1')
    expect(output).toContain('Version Directory: /tmp/references/v1.0_2025-01-01_120000')
  })

  it('formats reference results as JSON when json option is true', () => {
    const output = formatReferenceResults(mockResult, { json: true })

    const parsed = JSON.parse(output) as GenerationResult
    expect(parsed).toEqual(mockResult)
  })

  it('omits skipped count when zero', () => {
    const resultNoSkips: GenerationResult = {
      ...mockResult,
      skipCount: 0,
    }

    const output = formatReferenceResults(resultNoSkips, { color: false })

    expect(output).not.toContain('Skipped:')
    expect(output).toContain('Success: 13')
    expect(output).toContain('Failed: 1')
  })

  it('omits failed count when zero', () => {
    const resultNoFails: GenerationResult = {
      ...mockResult,
      failCount: 0,
    }

    const output = formatReferenceResults(resultNoFails, { color: false })

    expect(output).not.toContain('Failed:')
    expect(output).toContain('Success: 13')
    expect(output).toContain('Skipped: 1')
  })
})

describe('ProgressIndicator', () => {
  let consoleSpy: MockInstance
  let originalIsTTY: boolean | undefined

  beforeEach(() => {
    consoleSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    // Mock isTTY to true for testing
    originalIsTTY = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    // Restore original isTTY value
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    })
  })

  it('creates progress indicator with total and label', () => {
    const progress = new ProgressIndicator(100, 'Test Progress')
    expect(progress).toBeDefined()
  })

  it('updates progress and displays percentage', () => {
    const progress = new ProgressIndicator(100, 'Test')
    progress.update(50, 'Half done')

    expect(consoleSpy).toHaveBeenCalled()
    const output = consoleSpy.mock.calls[0]?.[0] as string
    expect(output).toContain('50%')
    expect(output).toContain('Half done')
  })

  it('increments progress by 1', () => {
    const progress = new ProgressIndicator(100, 'Test')
    progress.update(10)
    consoleSpy.mockClear()

    progress.increment('Step 11')

    expect(consoleSpy).toHaveBeenCalled()
    const output = consoleSpy.mock.calls[0]?.[0] as string
    expect(output).toContain('11%')
  })

  it('completes progress and shows final message', () => {
    const progress = new ProgressIndicator(100, 'Test')
    progress.complete('All done')

    expect(consoleSpy).toHaveBeenCalled()
    const output = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1]?.[0] as string
    expect(output).toContain('All done')
  })

  it('fails progress and shows error message', () => {
    const progress = new ProgressIndicator(100, 'Test')
    progress.fail('Something went wrong')

    expect(consoleSpy).toHaveBeenCalled()
    const output = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1]?.[0] as string
    expect(output).toContain('Something went wrong')
  })

  it('does not output when disabled', () => {
    const progress = new ProgressIndicator(100, 'Test', false)
    progress.update(50)
    progress.complete()

    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it('does not output when not in TTY mode', () => {
    // Override isTTY for this test
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    })

    const progress = new ProgressIndicator(100, 'Test', true)
    progress.update(50)

    expect(consoleSpy).not.toHaveBeenCalled()

    // Restore for next test
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    })
  })
})

describe('logger', () => {
  let consoleLogSpy: MockInstance
  let consoleErrorSpy: MockInstance

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  it('logs info messages', () => {
    logger.info('Test info message', false)

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Test info message'))
  })

  it('logs success messages', () => {
    logger.success('Test success message', false)

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Test success message'))
  })

  it('logs warning messages', () => {
    logger.warn('Test warning message', false)

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Test warning message'))
  })

  it('logs error messages to stderr', () => {
    logger.error('Test error message', false)

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Test error message'))
  })

  it('logs debug messages only when DEBUG env var is set', () => {
    const originalDebug = process.env['DEBUG']

    // Without DEBUG
    delete process.env['DEBUG']
    logger.debug('Hidden message', false)
    expect(consoleLogSpy).not.toHaveBeenCalled()

    // With DEBUG
    process.env['DEBUG'] = '1'
    logger.debug('Visible message', false)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Visible message'))

    // Restore
    if (originalDebug !== undefined) {
      process.env['DEBUG'] = originalDebug
    } else {
      delete process.env['DEBUG']
    }
  })
})
