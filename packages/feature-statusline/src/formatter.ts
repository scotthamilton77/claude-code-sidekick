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

import type { StatuslineConfig, StatuslineViewModel, ThresholdStatus } from './types.js'

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
 * Format token count for display (e.g., 45000 → "🪙 45k").
 */
export function formatTokens(tokens: number): string {
  let value: string
  if (tokens >= 1_000_000) {
    value = `${(tokens / 1_000_000).toFixed(1)}M`
  } else if (tokens >= 1_000) {
    value = `${Math.round(tokens / 1_000)}k`
  } else {
    value = String(tokens)
  }
  return `🪙 ${value}`
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
 * Shorten path for display (e.g., "/home/user/project" → "~/project").
 */
export function shortenPath(fullPath: string, homeDir?: string): string {
  if (homeDir && fullPath.startsWith(homeDir)) {
    return '~' + fullPath.slice(homeDir.length)
  }
  // Just return the last directory name if path is long
  const parts = fullPath.split('/')
  if (parts.length > 3) {
    return '.../' + parts.slice(-2).join('/')
  }
  return fullPath
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
