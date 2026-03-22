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

import { visibleLength } from './ansi-utils.js'
import { truncateSuffix, truncatePrefix, truncatePath } from './truncation.js'
import {
  normalizeSymbolMode,
  type ContextBarStatus,
  type ContextUsageData,
  type StatuslineConfig,
  type StatuslineViewModel,
  type SymbolMode,
  type ThresholdStatus,
} from './types.js'

// ============================================================================
// ANSI Color Codes
// ============================================================================

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  italic: '\x1b[3m',
  // Turn-off codes (don't reset color, only the specific attribute)
  noBold: '\x1b[22m', // normal intensity (turns off bold AND dim)
  noItalic: '\x1b[23m', // not italic
  noDim: '\x1b[22m', // normal intensity
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
// Token Options Parsing
// ============================================================================

interface TokenOptions {
  prefix?: string
  suffix?: string
  maxLength?: number
  truncateStyle?: 'suffix' | 'prefix' | 'path'
  wrapAt?: number
  wrapPrefix?: string
  wrapSuffix?: string
}

/**
 * Parse token options from the comma-separated options string.
 * Supports: prefix='...', suffix='...', maxLength=N, truncateStyle='...',
 *           wrapAt=N, wrapPrefix='...', wrapSuffix='...'
 */
function parseTokenOptions(optionsStr?: string): TokenOptions {
  if (!optionsStr) return {}
  const options: TokenOptions = {}

  // Parse string options: key='value' with escaped quotes
  const stringPattern = /(\w+)='((?:[^'\\]|\\.)*)'/g
  let match
  while ((match = stringPattern.exec(optionsStr)) !== null) {
    const key = match[1]
    const val = match[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\')
    switch (key) {
      case 'prefix':
        options.prefix = val
        break
      case 'suffix':
        options.suffix = val
        break
      case 'truncateStyle':
        options.truncateStyle = val as 'suffix' | 'prefix' | 'path'
        break
      case 'wrapPrefix':
        options.wrapPrefix = val
        break
      case 'wrapSuffix':
        options.wrapSuffix = val
        break
    }
  }

  // Parse numeric options: key=number (not followed by a quote, to avoid matching string values)
  const numPattern = /(\w+)=(\d+)(?=[,}]|$)/g
  while ((match = numPattern.exec(optionsStr)) !== null) {
    const key = match[1]
    const val = parseInt(match[2], 10)
    switch (key) {
      case 'maxLength':
        options.maxLength = val
        break
      case 'wrapAt':
        options.wrapAt = val
        break
    }
  }

  return options
}

/**
 * Apply truncation strategy to a raw string value.
 */
function applyTruncation(value: string, maxLength: number, style: 'suffix' | 'prefix' | 'path'): string {
  switch (style) {
    case 'prefix':
      return truncatePrefix(value, maxLength)
    case 'path':
      return truncatePath(value, maxLength)
    case 'suffix':
    default:
      return truncateSuffix(value, maxLength)
  }
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
   *
   * Supports both `|` and `\n` as separators in the format template.
   * Empty token values are handled safely - separators in token values
   * (e.g., a snarky comment containing "|") are preserved.
   */
  format(template: string, viewModel: StatuslineViewModel): string {
    // Convert escape sequences in template literal text
    // YAML double-quoted \\n becomes literal backslash+n in JS; convert to real newline
    template = template.replace(/\\n/g, '\n')

    const branchColor = this.theme.colors.branch ?? viewModel.branchColor
    const symbolMode = normalizeSymbolMode(this.theme.useNerdFonts)
    const logsText = formatLogs(viewModel.warningCount, viewModel.errorCount, symbolMode)

    // Convert markdown for title/summary
    const convertedSummary = this.convertMarkdown(viewModel.summary)
    const convertedTitle = this.convertMarkdown(viewModel.title)

    // Raw token values (pre-color) — truncation operates on these
    const rawTokens: Record<string, string> = {
      model: viewModel.model,
      contextWindow: viewModel.contextWindow,
      tokenUsageActual: viewModel.tokenUsageActual,
      tokenUsageEffective: viewModel.tokenUsageEffective,
      tokenPercentageActual: viewModel.tokenPercentageActual,
      tokenPercentageEffective: viewModel.tokenPercentageEffective,
      cost: viewModel.cost,
      duration: viewModel.duration,
      cwd: viewModel.cwd,
      branch: viewModel.branch,
      branchWT: viewModel.branchWT,
      projectDirShort: viewModel.projectDirShort,
      projectDirFull: viewModel.projectDirFull,
      worktreeName: viewModel.worktreeName,
      summary: convertedSummary,
      title: convertedTitle,
      logs: logsText,
      personaName: viewModel.personaName,
      // Pre-formatted tokens (already contain ANSI if colors enabled)
      contextBar: formatContextBar(viewModel.contextUsage, this.useColors, symbolMode),
    }

    // Colorization function per token — returns colored version of a value
    const personaColor = (this.theme.colors as Record<string, string>).persona ?? 'cyan'
    const colorizeToken = (tokenName: string, value: string): string => {
      switch (tokenName) {
        case 'tokenUsageActual':
        case 'tokenUsageEffective':
        case 'tokenPercentageActual':
        case 'tokenPercentageEffective':
          return this.colorizeByStatus(value, viewModel.tokensStatus)
        case 'cost':
          return this.colorizeByStatus(value, viewModel.costStatus)
        case 'logs':
          return this.colorizeByStatus(value, viewModel.logStatus)
        case 'model':
          return this.colorize(value, this.theme.colors.model)
        case 'contextWindow':
          return this.colorize(value, this.theme.colors.tokens)
        case 'duration':
          return this.colorize(value, this.theme.colors.duration)
        case 'cwd':
        case 'projectDirShort':
        case 'projectDirFull':
          return this.colorize(value, this.theme.colors.cwd)
        case 'branch':
        case 'worktreeName':
          return this.colorize(value, branchColor)
        case 'branchWT': {
          const coloredBranch = this.colorize(value, branchColor)
          if (!viewModel.worktreeName) return coloredBranch
          const wtColor = (this.theme.colors as Record<string, string>).worktreeIndicator ?? 'dim'
          return `${coloredBranch} ${this.colorize('[wt]', wtColor)}`
        }
        case 'summary':
          return this.colorize(value, this.theme.colors.summary)
        case 'title':
          return this.colorize(value, this.theme.colors.title)
        case 'personaName':
          return this.colorize(value, personaColor)
        case 'contextBar':
          return value // already formatted with colors
        default:
          return value
      }
    }

    // Marker for empty values
    const EMPTY_MARKER = '\x00EMPTY\x00'

    // Track visible line width for wrapAt support
    let currentLineWidth = 0

    // Replace {token} and {token,options...} patterns left-to-right
    const TOKEN_REGEX = /\{(\w+)(?:,([^}]*))?\}/g
    let result = ''
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = TOKEN_REGEX.exec(template)) !== null) {
      // Add literal text before this match and update line width
      const literal = template.slice(lastIndex, match.index)
      result += literal
      // Update line width for literal text
      const literalNewline = literal.lastIndexOf('\n')
      if (literalNewline >= 0) {
        currentLineWidth = visibleLength(literal.slice(literalNewline + 1))
      } else {
        currentLineWidth += visibleLength(literal)
      }

      const tokenName = match[1]
      const optionsStr = match[2]
      let value = rawTokens[tokenName] ?? ''
      if (!value) {
        result += EMPTY_MARKER
        lastIndex = TOKEN_REGEX.lastIndex
        continue
      }

      const options = parseTokenOptions(optionsStr)

      // Apply truncation to raw value (before colorization)
      if (options.maxLength !== undefined && tokenName !== 'contextBar') {
        value = applyTruncation(value, options.maxLength, options.truncateStyle ?? 'suffix')
      }

      // Colorize the (possibly truncated) value
      const colorized = colorizeToken(tokenName, value)

      // Choose prefix/suffix, applying wrapAt logic if specified
      let prefix = options.prefix ?? ''
      let suffix = options.suffix ?? ''

      if (options.wrapAt !== undefined) {
        const candidateWidth = currentLineWidth + visibleLength(prefix) + visibleLength(value)
        if (candidateWidth > options.wrapAt) {
          prefix = options.wrapPrefix ?? prefix
          suffix = options.wrapSuffix ?? suffix
        }
      }

      // Build the full segment and update line width tracking
      const segment = prefix + colorized + suffix
      const lastNewlineInSegment = segment.lastIndexOf('\n')
      if (lastNewlineInSegment >= 0) {
        currentLineWidth = visibleLength(segment.slice(lastNewlineInSegment + 1))
      } else {
        currentLineWidth += visibleLength(segment)
      }

      result += segment
      lastIndex = TOKEN_REGEX.lastIndex
    }

    // Add any remaining literal text after the last match
    result += template.slice(lastIndex)

    // Clean up separators around empty markers (handles both | and \n)
    result = result.replace(new RegExp(`\\s*[|\\n]\\s*${EMPTY_MARKER}\\s*[|\\n]\\s*`, 'g'), ' | ')
    result = result.replace(new RegExp(`^${EMPTY_MARKER}\\s*[|\\n]\\s*`), '')
    result = result.replace(new RegExp(`\\s*[|\\n]\\s*${EMPTY_MARKER}$`), '')
    result = result.replace(new RegExp(EMPTY_MARKER, 'g'), '')

    // Final edge cleanup: trailing/leading separators
    result = result.replace(/[|\n]\s*$/g, '')
    result = result.replace(/^\s*[|\n]/g, '')

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

  /**
   * Convert markdown formatting to ANSI escape sequences.
   * Handles bold (**text**), italic (*text* or _text_), and code (`text`).
   * Respects supportedMarkdown config flags.
   */
  convertMarkdown(text: string): string {
    if (!text) return text

    let result = text
    // Default to all enabled if supportedMarkdown not configured (backwards compat)
    const md = this.theme.supportedMarkdown ?? { bold: true, italic: true, code: true }

    // Bold: **text** → ANSI bold (process first to avoid conflict with italic)
    // Use noBold instead of reset to preserve surrounding color
    if (md.bold) {
      result = result.replace(/\*\*(.+?)\*\*/g, `${ANSI.bold}$1${ANSI.noBold}`)
    }

    // Italic: *text* or _text_ → ANSI italic
    // Use negative lookahead/behind to avoid matching ** patterns
    // Use noItalic instead of reset to preserve surrounding color
    if (md.italic) {
      result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, `${ANSI.italic}$1${ANSI.noItalic}`)
      result = result.replace(/(?<!_)_([^_]+)_(?!_)/g, `${ANSI.italic}$1${ANSI.noItalic}`)
    }

    // Code: `text` → ANSI dim
    // Use noDim instead of reset to preserve surrounding color
    if (md.code) {
      result = result.replace(/`([^`]+)`/g, `${ANSI.dim}$1${ANSI.noDim}`)
    }

    return result
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
 * Format cwd for display (home-shortened, no icon or truncation).
 * Truncation is now handled via template attributes (maxLength, truncateStyle).
 */
export function formatCwd(fullPath: string, homeDir?: string): string {
  if (homeDir && fullPath.startsWith(homeDir)) {
    return '~' + fullPath.slice(homeDir.length)
  }
  return fullPath
}

/**
 * Format git branch for display (raw name, no icon).
 * Icons are now added via template prefix attributes.
 */
export function formatBranch(branch: string): string {
  return branch
}

/**
 * Format log metrics for display.
 * - "full": Uses ⚠ (warning sign, U+26A0) and ✗ (ballot x, U+2717)
 * - "safe": Uses △ (white triangle, U+25B3) and × (multiplication sign, U+00D7)
 * - "ascii": Uses W: and E: prefixes
 */
export function formatLogs(warningCount: number, errorCount: number, symbolMode: SymbolMode = 'full'): string {
  const symbols: Record<SymbolMode, { warn: string; error: string }> = {
    full: { warn: '⚠', error: '✗' },
    safe: { warn: '△', error: '×' },
    ascii: { warn: 'W:', error: 'E:' },
  }
  const { warn, error } = symbols[symbolMode]
  return `${warn}${warningCount} ${error}${errorCount}`
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
  buffer: '▒',
  empty: '░',
  threshold: '|',
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
 * Format context bar with 8 characters showing usage relative to context window.
 *
 * Layout (8 chars):
 * - Left portion: Context tokens consumed (▓ filled, colored by status)
 * - Middle portion: Autocompact buffer (~45k, ▒ medium shade, dimmed)
 * - Threshold marker: | (compaction point)
 * - Right portion: Remaining available context (░ empty)
 *
 * Example outputs (symbolMode="full"):
 * - Low usage:    🪙 ▓▒|░░░░░
 * - Medium usage: 🪙 ▓▓▒|░░░░
 * - High usage:   🪙 ▓▓▓▓▒|░░
 *
 * Example outputs (symbolMode="safe"):
 * - Low usage:    ▓▒|░░░░░
 * - (same bar chars, no emoji prefix)
 *
 * Example outputs (symbolMode="ascii"):
 * - Low usage:    [#.|.....]
 *
 * @param contextUsage - Context usage data from hook metrics
 * @param useColors - Whether to apply ANSI colors
 * @param symbolMode - Symbol mode: "full" (emojis), "safe" (BMP only), "ascii"
 * @returns Formatted bar string with optional icon prefix
 */
export function formatContextBar(
  contextUsage: ContextUsageData | undefined,
  useColors: boolean,
  symbolMode: SymbolMode = 'full'
): string {
  if (!contextUsage) {
    return ''
  }

  const { contextTokens, bufferTokens, contextWindowSize, status } = contextUsage

  // Calculate positions proportionally to context window
  // Total bar width is 8 characters (excluding threshold marker)
  const BAR_WIDTH = 8
  const tokensPerPosition = contextWindowSize / BAR_WIDTH

  // Calculate filled positions for context and buffer
  const contextPositions = Math.min(BAR_WIDTH, Math.floor(contextTokens / tokensPerPosition))
  const bufferPositions = Math.min(
    BAR_WIDTH - contextPositions,
    Math.max(1, Math.floor(bufferTokens / tokensPerPosition))
  )
  const thresholdPosition = contextPositions + bufferPositions

  // Select characters based on symbol mode
  // - "full" and "safe" use Unicode bar chars (they're in BMP and work well)
  // - "ascii" uses simple ASCII characters
  const chars = symbolMode === 'ascii' ? { filled: '#', buffer: '.', empty: '.', threshold: '|' } : BAR_CHARS // Unicode bar chars work for both "full" and "safe"

  // Build the bar
  const barParts: string[] = []

  for (let i = 0; i < BAR_WIDTH; i++) {
    if (i < contextPositions) {
      barParts.push(chars.filled)
    } else if (i < thresholdPosition) {
      barParts.push(chars.buffer)
    } else if (i === thresholdPosition && thresholdPosition < BAR_WIDTH) {
      barParts.push(chars.threshold)
    } else {
      barParts.push(chars.empty)
    }
  }

  const bar = barParts.join('')

  // Format with prefix based on symbol mode
  // - "full": coin emoji prefix
  // - "safe": no prefix (emoji causes VS Code width issues)
  // - "ascii": wrapped in brackets
  const formatWithPrefix = (content: string): string => {
    if (symbolMode === 'full') return `🪙 ${content}`
    if (symbolMode === 'ascii') return `[${content}]`
    return content // "safe" - no prefix
  }

  if (!useColors) {
    return formatWithPrefix(bar)
  }

  // Apply colors: context portion gets status color, buffer gets dim
  const color = getContextBarColor(status)
  let coloredBar = ''

  for (let i = 0; i < BAR_WIDTH; i++) {
    if (i < contextPositions) {
      coloredBar += `${color}${barParts[i]}${ANSI.reset}`
    } else if (i < thresholdPosition) {
      coloredBar += `${ANSI.dim}${barParts[i]}${ANSI.reset}`
    } else {
      coloredBar += barParts[i]
    }
  }

  return formatWithPrefix(coloredBar)
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
 * Map context bar status to threshold status so token percentage text
 * and context bar graph agree on color (both derived from usage fraction).
 */
export function contextBarStatusToThresholdStatus(status: ContextBarStatus): ThresholdStatus {
  switch (status) {
    case 'high':
      return 'critical'
    case 'medium':
      return 'warning'
    case 'low':
      return 'normal'
  }
}

/**
 * Calculate context usage data from hook metrics.
 *
 * @param contextTokens - Context tokens (conversation content)
 * @param bufferTokens - Autocompact buffer tokens (~45k reserved)
 * @param contextWindowSize - Context window size from hook
 * @returns Context usage data for bar rendering
 */
export function calculateContextUsage(
  contextTokens: number | undefined,
  bufferTokens: number | undefined,
  contextWindowSize: number | undefined
): ContextUsageData | undefined {
  if (!contextWindowSize || contextWindowSize <= 0) {
    return undefined
  }

  const effectiveContext = contextTokens ?? 0
  const effectiveBuffer = bufferTokens ?? 0
  const totalTokens = effectiveContext + effectiveBuffer

  // Effective limit = context window - buffer
  const effectiveLimit = Math.max(0, contextWindowSize - effectiveBuffer)

  // Usage fraction relative to effective limit
  const usageFraction = effectiveLimit > 0 ? effectiveContext / effectiveLimit : 1

  return {
    contextTokens: effectiveContext,
    bufferTokens: effectiveBuffer,
    totalTokens,
    contextWindowSize,
    effectiveLimit,
    usageFraction,
    status: getContextBarStatus(usageFraction),
  }
}
