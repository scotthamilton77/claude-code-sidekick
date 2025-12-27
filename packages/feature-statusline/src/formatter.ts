/**
 * Formatter - Template interpolation with ANSI colors
 *
 * Lightweight string interpolator that:
 * - Replaces {token} with values from view model
 * - Applies ANSI color codes based on theme and thresholds
 * - Handles conditional formatting (empty values)
 *
 * @see docs/design/FEATURE-STATUSLINE.md §5.3 Formatter, §8.1 Template Engine
 */

import type {
  ContextBarStatus,
  ContextUsageData,
  StatuslineConfig,
  StatuslineViewModel,
  ThresholdStatus,
} from './types.js'

// ============================================================================
// ANSI Color Codes
// ============================================================================

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  // Bright variants
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
} as const

type ColorName = keyof typeof ANSI

/**
 * Maps threshold status to ANSI color.
 */
function getThresholdColor(status: ThresholdStatus): string {
  switch (status) {
    case 'critical':
      return ANSI.red
    case 'warning':
      return ANSI.yellow
    default:
      return ANSI.green
  }
}

/**
 * Maps color name to ANSI code.
 */
function getColor(name: string): string {
  const colorName = name as ColorName
  return ANSI[colorName] ?? ''
}

// ============================================================================
// Formatter Class
// ============================================================================

/**
 * Configuration for Formatter.
 */
export interface FormatterConfig {
  /** Theme settings for colors and icons */
  theme: StatuslineConfig['theme']
  /** Whether to use ANSI colors (false for JSON output) */
  useColors: boolean
}

/**
 * Formats statusline output from view model.
 */
export class Formatter {
  private readonly theme: StatuslineConfig['theme']
  private readonly useColors: boolean

  constructor(config: FormatterConfig) {
    this.theme = config.theme
    this.useColors = config.useColors
  }

  /**
   * Format the statusline using the template and view model.
   */
  format(template: string, viewModel: StatuslineViewModel): string {
    // Build token map with formatted values
    const tokens: Record<string, string> = {
      model: this.colorize(viewModel.model, this.theme.colors.model),
      tokens: this.colorizeByStatus(viewModel.tokens, viewModel.tokensStatus),
      cost: this.colorizeByStatus(viewModel.cost, viewModel.costStatus),
      duration: viewModel.duration,
      cwd: viewModel.cwd,
      branch: viewModel.branch ? ` ${this.colorize(viewModel.branch, viewModel.branchColor)}` : '',
      summary: this.colorize(viewModel.summary, this.theme.colors.summary),
      title: viewModel.title,
      contextBar: formatContextBar(viewModel.contextUsage, this.useColors),
    }

    // Replace {token} patterns
    let result = template
    for (const [key, value] of Object.entries(tokens)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
    }

    // Clean up empty separators (e.g., " | |" → " |")
    result = result.replace(/\s*\|\s*\|/g, ' |')
    result = result.replace(/\|\s*$/g, '')
    result = result.replace(/^\s*\|/g, '')

    return result.trim()
  }

  /**
   * Apply color to text based on threshold status.
   */
  private colorizeByStatus(text: string, status: ThresholdStatus): string {
    if (!this.useColors) return text
    const color = getThresholdColor(status)
    return `${color}${text}${ANSI.reset}`
  }

  /**
   * Apply named color to text.
   */
  private colorize(text: string, colorName: string): string {
    if (!this.useColors || !text) return text
    const color = getColor(colorName)
    return color ? `${color}${text}${ANSI.reset}` : text
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format token count for display (e.g., 45000 → "45k").
 * Note: Icon moved to context bar prefix.
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  } else if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}k`
  }
  return String(tokens)
}

/**
 * Format cost for display (e.g., 0.15 → "$0.15").
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return '$0.00'
  }
  return `$${cost.toFixed(2)}`
}

/**
 * Format duration for display (e.g., 720000 → "12m").
 */
export function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h${minutes % 60}m`
  }
  if (minutes > 0) {
    return `${minutes}m`
  }
  return `${seconds}s`
}

/**
 * Shorten path for display.
 * Uses ellipsis at start + last two subfolders, capped at 20 chars.
 * No trailing ellipsis - truncates from the right if needed.
 * Examples:
 *   "/home/user/projects/claude-config" → "…/projects/claude-co"
 *   "/home/user/very-long/name" → "…/very-long/name"
 *   "/Users/scott/src" → "…/scott/src"
 *   "/short" → "/short"
 */
export function shortenPath(fullPath: string, homeDir?: string): string {
  const MAX_LENGTH = 20

  // Replace home dir with ~ first
  let path = fullPath
  if (homeDir && path.startsWith(homeDir)) {
    path = '~' + path.slice(homeDir.length)
  }

  // If already short enough, return as-is
  if (path.length <= MAX_LENGTH) {
    return path
  }

  // Use ellipsis + last two path segments
  const parts = path.split('/')
  if (parts.length >= 2) {
    let shortened = '…/' + parts.slice(-2).join('/')
    // If still too long, try just the last segment
    if (shortened.length > MAX_LENGTH) {
      shortened = '…/' + parts.slice(-1)[0]
    }
    // If still too long, hard truncate (no trailing ellipsis)
    if (shortened.length > MAX_LENGTH) {
      return shortened.slice(0, MAX_LENGTH)
    }
    return shortened
  }

  // Single segment that's too long - hard truncate with leading ellipsis
  return '…' + path.slice(-(MAX_LENGTH - 1))
}

/**
 * Format cwd for display with folder icon (e.g., "📁 ~/project").
 */
export function formatCwd(fullPath: string, homeDir?: string): string {
  return `📁 ${shortenPath(fullPath, homeDir)}`
}

/**
 * Format git branch with ⎇ icon.
 */
export function formatBranch(branch: string, _useNerdFonts: boolean): string {
  if (!branch) return ''
  return `⎇ ${branch}`
}

/**
 * Get color name for git branch based on naming pattern.
 * - main/master → green
 * - feature/..., feat/... → blue
 * - hotfix/..., fix/... → red
 * - other → magenta
 */
export function getBranchColor(branch: string): string {
  if (!branch) return ''
  if (branch === 'main' || branch === 'master') {
    return 'green'
  }
  if (branch.startsWith('feature/') || branch.startsWith('feat/')) {
    return 'blue'
  }
  if (branch.startsWith('hotfix/') || branch.startsWith('fix/')) {
    return 'red'
  }
  return 'magenta'
}

/**
 * Determine threshold status for a value.
 */
export function getThresholdStatus(value: number, thresholds: { warning: number; critical: number }): ThresholdStatus {
  if (value >= thresholds.critical) return 'critical'
  if (value >= thresholds.warning) return 'warning'
  return 'normal'
}

/**
 * Factory function to create Formatter.
 */
export function createFormatter(config: FormatterConfig): Formatter {
  return new Formatter(config)
}

// ============================================================================
// Context Bar Formatting
// ============================================================================

/**
 * Bar characters for context visualization.
 */
const BAR_CHARS = {
  filled: '▓',
  empty: '░',
  threshold: '│',
} as const

/**
 * Get ANSI color for context bar based on status.
 */
function getContextBarColor(status: ContextBarStatus): string {
  switch (status) {
    case 'high':
      return ANSI.red
    case 'medium':
      return ANSI.yellow
    case 'low':
    default:
      return ANSI.green
  }
}

/**
 * Format context bar with 8 characters showing usage relative to compaction threshold.
 *
 * Layout (8 chars):
 * - Positions 0-5: Main context area (0-75% of window)
 * - Position 6: Threshold marker │ (~77.5% compaction point)
 * - Position 7: Autocompact buffer zone (87.5-100%)
 *
 * Example outputs:
 * - Low usage:    🪙 ▓▓░░░░│░
 * - Medium usage: 🪙 ▓▓▓▓░░│░
 * - High usage:   🪙 ▓▓▓▓▓▓│░
 * - Over limit:   🪙 ▓▓▓▓▓▓▓│
 *
 * @param contextUsage - Context usage data from hook metrics
 * @param useColors - Whether to apply ANSI colors
 * @returns Formatted bar string with icon prefix
 */
export function formatContextBar(contextUsage: ContextUsageData | undefined, useColors: boolean): string {
  if (!contextUsage) {
    return ''
  }

  const { totalTokens, contextWindowSize, status } = contextUsage

  // Calculate how many of the first 6 positions should be filled
  // Each of the 6 positions represents 1/8 of the context window (12.5% each)
  // Position 6 is the threshold marker, position 7 is buffer
  const tokensPerPosition = contextWindowSize / 8
  const filledPositions = Math.min(7, Math.floor(totalTokens / tokensPerPosition))

  // Build the bar
  const barParts: string[] = []

  // Positions 0-5: Main context area
  for (let i = 0; i < 6; i++) {
    barParts.push(i < filledPositions ? BAR_CHARS.filled : BAR_CHARS.empty)
  }

  // Position 6: Threshold marker (always │)
  barParts.push(BAR_CHARS.threshold)

  // Position 7: Buffer zone (filled if usage exceeds threshold)
  barParts.push(filledPositions >= 7 ? BAR_CHARS.filled : BAR_CHARS.empty)

  const bar = barParts.join('')

  if (!useColors) {
    return `🪙 ${bar}`
  }

  // Apply color to the filled portion only
  const color = getContextBarColor(status)
  const filledPart = bar.slice(0, filledPositions)
  const restPart = bar.slice(filledPositions)

  return `🪙 ${color}${filledPart}${ANSI.reset}${restPart}`
}

/**
 * Determine context bar status based on usage fraction.
 * - Low: < 50% of effective limit
 * - Medium: 50-80% of effective limit
 * - High: > 80% of effective limit
 */
export function getContextBarStatus(usageFraction: number): ContextBarStatus {
  if (usageFraction >= 0.8) return 'high'
  if (usageFraction >= 0.5) return 'medium'
  return 'low'
}

/**
 * Calculate context usage data from hook metrics.
 *
 * @param totalInputTokens - Input tokens from hook
 * @param totalOutputTokens - Output tokens from hook
 * @param contextWindowSize - Context window size from hook
 * @returns Context usage data for bar rendering
 */
export function calculateContextUsage(
  totalInputTokens: number | undefined,
  totalOutputTokens: number | undefined,
  contextWindowSize: number | undefined
): ContextUsageData | undefined {
  if (!contextWindowSize || contextWindowSize <= 0) {
    return undefined
  }

  const totalTokens = (totalInputTokens ?? 0) + (totalOutputTokens ?? 0)

  // Effective limit is ~77.5% of context window (before autocompact kicks in)
  const effectiveLimit = Math.floor(contextWindowSize * 0.775)

  // Usage fraction relative to effective limit
  const usageFraction = totalTokens / effectiveLimit

  return {
    totalTokens,
    contextWindowSize,
    effectiveLimit,
    usageFraction,
    status: getContextBarStatus(usageFraction),
  }
}
