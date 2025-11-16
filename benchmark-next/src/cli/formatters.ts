/**
 * Output Formatting Utilities
 *
 * Provides pretty printing, progress tracking, and table formatting for CLI output.
 * Matches Track 1 bash output readability while leveraging TypeScript type safety.
 */

import type { BenchmarkResult } from '../benchmark/core/BenchmarkTypes.js'
import type { GenerationResult } from '../benchmark/core/types.js'

/**
 * Format options for output
 */
export interface FormatOptions {
  /** Output as JSON instead of pretty format */
  json?: boolean
  /** Enable colored output (ANSI codes) */
  color?: boolean
  /** Verbose output mode */
  verbose?: boolean
}

/**
 * ANSI color codes for terminal output
 */
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const

/**
 * Apply color to text if color is enabled
 */
function colorize(text: string, color: keyof typeof colors, enabled: boolean = true): string {
  if (!enabled) return text
  return `${colors[color]}${text}${colors.reset}`
}

/**
 * Format a horizontal rule
 */
function hr(width: number = 80, char: string = '='): string {
  return char.repeat(width)
}

/**
 * Format a section header
 */
function header(text: string, color: boolean = true): string {
  return [
    '',
    colorize(hr(), 'cyan', color),
    colorize(text.toUpperCase(), 'bright', color),
    colorize(hr(), 'cyan', color),
    '',
  ].join('\n')
}

/**
 * Format a table row with aligned columns
 */
function tableRow(columns: string[], widths: number[]): string {
  return columns.map((col, i) => col.padEnd(widths[i] || 0)).join('  ')
}

/**
 * Calculate optimal column widths for a table
 */
function calculateColumnWidths(rows: string[][]): number[] {
  if (rows.length === 0) return []
  const firstRow = rows[0]
  if (!firstRow) return []
  const numColumns = firstRow.length
  const widths = new Array<number>(numColumns).fill(0)

  for (const row of rows) {
    row.forEach((cell, i) => {
      const currentWidth = widths[i]
      if (currentWidth !== undefined) {
        widths[i] = Math.max(currentWidth, cell.length)
      }
    })
  }

  return widths
}

/**
 * Format benchmark results summary
 */
export function formatBenchmarkResults(
  results: BenchmarkResult,
  options: FormatOptions = {}
): string {
  if (options.json) {
    return JSON.stringify(results, null, 2)
  }

  const { color = true } = options
  const output: string[] = []

  // Header
  output.push(header('Benchmark Results', color))

  // Metadata
  output.push(colorize('Run Configuration:', 'bright', color))
  output.push(`  Mode: ${results.metadata.mode}`)
  output.push(`  Models: ${results.metadata.modelsFilter}`)
  output.push(`  Reference Version: ${results.metadata.referenceVersion}`)
  output.push(`  Timestamp: ${results.metadata.timestamp}`)
  output.push(`  Transcript Count: ${results.metadata.transcriptCount}`)
  output.push(`  Run Count: ${results.metadata.runCount}`)
  output.push('')

  // Model Statistics Table
  if (results.models.length > 0) {
    output.push(colorize('Model Performance:', 'bright', color))
    output.push('')

    const headers = [
      'Model',
      'Runs',
      'Schema',
      'Technical',
      'Content',
      'Overall',
      'Latency (ms)',
      'Error Rate',
    ]

    const rows: string[][] = [headers]

    for (const model of results.models) {
      rows.push([
        `${model.provider}:${model.model}`,
        model.scores.totalRuns.toString(),
        formatScore(model.scores.schemaAvg),
        formatScore(model.scores.technicalAvg),
        formatScore(model.scores.contentAvg),
        formatScore(model.scores.overallAvg),
        formatLatency(model.latency),
        formatModelErrorRate(model.scores),
      ])
    }

    const widths = calculateColumnWidths(rows)

    // Header row
    output.push(colorize(tableRow(headers, widths), 'cyan', color))
    output.push(
      colorize(
        hr(
          widths.reduce((sum, w) => sum + w + 2, -2),
          '-'
        ),
        'dim',
        color
      )
    )

    // Data rows
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      if (row) {
        output.push(tableRow(row, widths))
      }
    }
    output.push('')
  }

  // Termination info
  const anyTerminated = results.models.some((m) => m.terminated)
  if (anyTerminated) {
    output.push(colorize('⚠ EARLY TERMINATION', 'yellow', color))
    const terminatedModels = results.models.filter((m) => m.terminated)
    for (const model of terminatedModels) {
      const reason = model.terminationReason ?? 'Unknown'
      output.push(`  ${model.provider}:${model.model} - ${reason}`)
    }
    output.push('')
  }

  // Summary
  output.push(colorize('Summary:', 'bright', color))
  output.push(`  Total Models: ${results.models.length}`)
  output.push(`  Total Runs: ${results.models.reduce((sum, m) => sum + m.scores.totalRuns, 0)}`)
  output.push(`  Output Directory: ${results.metadata.outputDir}`)
  output.push('')

  return output.join('\n')
}

/**
 * Format reference generation results
 */
export function formatReferenceResults(
  results: GenerationResult,
  options: FormatOptions = {}
): string {
  if (options.json) {
    return JSON.stringify(results, null, 2)
  }

  const { color = true } = options
  const output: string[] = []

  // Header
  output.push(header('Reference Generation Results', color))

  // Statistics
  output.push(colorize('Generation Statistics:', 'bright', color))
  output.push(`  Total: ${results.totalCount}`)
  output.push(`  ${colorize('✓', 'green', color)} Success: ${results.successCount}`)
  if (results.skipCount > 0) {
    output.push(`  ${colorize('⊘', 'yellow', color)} Skipped: ${results.skipCount}`)
  }
  if (results.failCount > 0) {
    output.push(`  ${colorize('✗', 'red', color)} Failed: ${results.failCount}`)
  }
  output.push(`  Duration: ${formatDuration(results.duration * 1000)}`)
  output.push('')

  // Output location
  output.push(colorize('Output:', 'bright', color))
  output.push(`  Version Directory: ${results.versionedDir}`)
  output.push('')

  return output.join('\n')
}

/**
 * Format a score value (0-100)
 */
function formatScore(score: number | undefined): string {
  if (score === undefined) return 'N/A'
  return score.toFixed(2)
}

/**
 * Format latency statistics
 */
function formatLatency(latency: { min: number; max: number; avg: number }): string {
  return `${latency.avg.toFixed(0)} (${latency.min}-${latency.max})`
}

/**
 * Format model error rate
 */
function formatModelErrorRate(scores: {
  errorRate: number
  timeoutRate: number
  otherErrorRate: number
}): string {
  const totalRate = scores.errorRate
  if (totalRate === 0) return '0%'
  return `${(totalRate * 100).toFixed(1)}%`
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

/**
 * Progress indicator class for long-running operations
 */
export class ProgressIndicator {
  private total: number
  private current: number = 0
  private startTime: number
  private label: string
  private enabled: boolean

  constructor(total: number, label: string = 'Progress', enabled: boolean = true) {
    this.total = total
    this.label = label
    this.enabled = enabled && process.stdout.isTTY
    this.startTime = Date.now()
  }

  /**
   * Update progress
   */
  update(current: number, message?: string): void {
    if (!this.enabled) return

    this.current = current
    const percent = Math.floor((current / this.total) * 100)
    const elapsed = Date.now() - this.startTime
    const rate = current / (elapsed / 1000)
    const remaining = (this.total - current) / rate

    const bar = this.createBar(percent)
    const status = message ? ` - ${message}` : ''
    const eta =
      remaining > 0 && isFinite(remaining) ? ` (ETA: ${formatDuration(remaining * 1000)})` : ''

    // Clear line and write progress
    process.stdout.write(`\r\x1b[K${this.label}: ${bar} ${percent}%${status}${eta}`)
  }

  /**
   * Increment progress by 1
   */
  increment(message?: string): void {
    this.update(this.current + 1, message)
  }

  /**
   * Complete the progress indicator
   */
  complete(message?: string): void {
    if (!this.enabled) return

    const elapsed = Date.now() - this.startTime
    const finalMessage = message || 'Complete'
    process.stdout.write(
      `\r\x1b[K${this.label}: ${colorize('✓', 'green')} ${finalMessage} (${formatDuration(elapsed)})\n`
    )
  }

  /**
   * Fail the progress indicator
   */
  fail(message?: string): void {
    if (!this.enabled) return

    const finalMessage = message || 'Failed'
    process.stdout.write(`\r\x1b[K${this.label}: ${colorize('✗', 'red')} ${finalMessage}\n`)
  }

  /**
   * Create progress bar string
   */
  private createBar(percent: number, width: number = 30): string {
    const filled = Math.floor((percent / 100) * width)
    const empty = width - filled
    return `[${colorize('█'.repeat(filled), 'cyan')}${colorize('░'.repeat(empty), 'dim')}]`
  }
}

/**
 * Simple logger for CLI output
 */
export const logger = {
  info(message: string, color: boolean = true): void {
    // eslint-disable-next-line no-console
    console.log(colorize('ℹ', 'blue', color) + ' ' + message)
  },

  success(message: string, color: boolean = true): void {
    // eslint-disable-next-line no-console
    console.log(colorize('✓', 'green', color) + ' ' + message)
  },

  warn(message: string, color: boolean = true): void {
    // eslint-disable-next-line no-console
    console.log(colorize('⚠', 'yellow', color) + ' ' + message)
  },

  error(message: string, color: boolean = true): void {
    // eslint-disable-next-line no-console
    console.error(colorize('✗', 'red', color) + ' ' + message)
  },

  debug(message: string, color: boolean = true): void {
    if (process.env['DEBUG']) {
      // eslint-disable-next-line no-console
      console.log(colorize('🔍', 'gray', color) + ' ' + message)
    }
  },
}
