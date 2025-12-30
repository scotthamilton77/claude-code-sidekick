/**
 * Transcript Parser for /context Command Output
 *
 * Parses /context command output from Claude Code transcripts.
 * Handles both:
 * - Visual format with ANSI escape codes (real output)
 * - Markdown table format (legacy/hypothetical)
 *
 * @see METRICS_PLAN.md §Step 2
 */

import type { ParsedContextTable } from './types.js'

// ============================================================================
// ANSI Escape Code Handling
// ============================================================================

/**
 * Strip ANSI escape codes from a string.
 * Handles SGR (colors), cursor control, and other escape sequences.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
}

// ============================================================================
// Number Parsing
// ============================================================================

/**
 * Parse a token count string to a number.
 * Handles formats: "17.9k", "17,900", "17900", "0"
 *
 * @param value - Token count string (e.g., "17.9k", "3,200")
 * @returns Parsed number, or 0 if parsing fails
 */
export function parseTokenCount(value: string): number {
  if (!value || value === '-' || value === 'N/A') {
    return 0
  }

  // Remove whitespace and commas
  const cleaned = value.trim().replace(/,/g, '')

  // Handle "k" suffix (e.g., "17.9k" -> 17900)
  if (cleaned.toLowerCase().endsWith('k')) {
    const num = parseFloat(cleaned.slice(0, -1))
    return isNaN(num) ? 0 : Math.round(num * 1000)
  }

  // Handle "M" suffix (e.g., "1.2M" -> 1200000)
  if (cleaned.toLowerCase().endsWith('m')) {
    const num = parseFloat(cleaned.slice(0, -1))
    return isNaN(num) ? 0 : Math.round(num * 1000000)
  }

  // Plain number
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : Math.round(num)
}

// ============================================================================
// Content Detection
// ============================================================================

/**
 * Check if content contains /context command output.
 * Uses self-identifying markers per METRICS_PLAN.md §Step 5.
 *
 * @param content - Message content to check
 * @returns true if content appears to be /context output
 */
export function isContextCommandOutput(content: string): boolean {
  if (typeof content !== 'string') return false

  // Must have local-command-stdout wrapper
  if (!content.includes('<local-command-stdout>')) return false

  // Must have context-specific markers
  const hasContextMarkers =
    content.includes('System prompt') && content.includes('System tools') && content.includes('Context')

  return hasContextMarkers
}

// ============================================================================
// Table Parsing
// ============================================================================

/**
 * Category name mappings from /context output to our fields.
 * Claude Code uses these exact strings in the table.
 */
const CATEGORY_MAPPINGS: Record<string, keyof ParsedContextTable> = {
  'system prompt': 'systemPrompt',
  'system tools': 'systemTools',
  'mcp tools': 'mcpTools',
  'custom agents': 'customAgents',
  'memory files': 'memoryFiles',
  messages: 'messages',
  'autocompact buffer': 'autocompactBuffer',
}

/**
 * Parse the /context command output from transcript content.
 *
 * Handles two formats:
 *
 * 1. Visual format (real output with ANSI codes):
 * ```
 * claude-opus-4-5-20251101 · 166k/200k tokens (83%)
 * ⛁ System prompt: 3.2k tokens (1.6%)
 * ⛁ System tools: 17.9k tokens (9.0%)
 * ```
 *
 * 2. Markdown table format (legacy):
 * ```
 * | Category | Tokens | Percentage |
 * | System prompt | 2.9k | 1.4% |
 * ```
 *
 * @param content - Full message content containing /context output
 * @returns Parsed metrics, or null if parsing fails
 */
export function parseContextTable(content: string): ParsedContextTable | null {
  try {
    // Extract content between <local-command-stdout> tags
    const match = content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/)
    if (!match) return null

    // Strip ANSI codes for easier parsing
    const stdout = stripAnsi(match[1])

    // Initialize result with zeros
    const result: ParsedContextTable = {
      systemPrompt: 0,
      systemTools: 0,
      mcpTools: 0,
      customAgents: 0,
      memoryFiles: 0,
      messages: 0,
      autocompactBuffer: 0,
      contextWindowSize: 0,
      totalTokens: 0,
    }

    // Try visual format first (real /context output)
    const visualResult = parseVisualFormat(stdout, result)
    if (visualResult) {
      return visualResult
    }

    // Fall back to markdown table format
    return parseMarkdownTableFormat(stdout, result)
  } catch {
    return null
  }
}

/**
 * Parse the visual format used by real /context output.
 *
 * Header: `model-name · 166k/200k tokens (83%)`
 * Categories: `⛁ System prompt: 3.2k tokens (1.6%)`
 */
function parseVisualFormat(stdout: string, result: ParsedContextTable): ParsedContextTable | null {
  // Parse header: "model-name · 166k/200k tokens (83%)"
  const headerMatch = stdout.match(/([\d.,kKmM]+)\s*\/\s*([\d.,kKmM]+)\s*tokens/)
  if (headerMatch) {
    result.totalTokens = parseTokenCount(headerMatch[1])
    result.contextWindowSize = parseTokenCount(headerMatch[2])
  }

  // Parse category lines: "⛁ System prompt: 3.2k tokens (1.6%)"
  // or "⛝ Autocompact buffer: 45.0k tokens (22.5%)"
  const lines = stdout.split('\n')

  for (const line of lines) {
    // Match pattern: "Category name: Xk tokens (Y%)"
    // The category name may have unicode icons before it
    const categoryMatch = line.match(/([A-Za-z][A-Za-z\s]+):\s*([\d.,kKmM]+)\s*tokens/i)
    if (categoryMatch) {
      const category = categoryMatch[1].trim().toLowerCase()
      const tokens = categoryMatch[2]

      const fieldName = CATEGORY_MAPPINGS[category]
      if (fieldName) {
        result[fieldName] = parseTokenCount(tokens)
      }
    }
  }

  // Validate we got at least the core metrics
  if (result.systemPrompt === 0 && result.systemTools === 0) {
    return null
  }

  return result
}

/**
 * Parse the markdown table format (legacy/hypothetical).
 */
function parseMarkdownTableFormat(stdout: string, result: ParsedContextTable): ParsedContextTable | null {
  // Parse total tokens and context window from header
  // Format: **Tokens:** 63.0k / 200.0k (32%)
  const tokensMatch = stdout.match(/\*\*Tokens:\*\*\s*([\d.,kKmM]+)\s*\/\s*([\d.,kKmM]+)/)
  if (tokensMatch) {
    result.totalTokens = parseTokenCount(tokensMatch[1])
    result.contextWindowSize = parseTokenCount(tokensMatch[2])
  }

  // Parse the markdown table
  // Find table rows (lines starting with |)
  const tableLines = stdout.split('\n').filter((line) => line.trim().startsWith('|'))

  for (const line of tableLines) {
    // Skip header and separator rows
    if (line.includes('Category') || line.includes('---')) continue

    // Parse row: | Category | Tokens | Percentage |
    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean)

    if (cells.length >= 2) {
      const category = cells[0].toLowerCase()
      const tokens = cells[1]

      // Map category to field
      const fieldName = CATEGORY_MAPPINGS[category]
      if (fieldName) {
        result[fieldName] = parseTokenCount(tokens)
      }
    }
  }

  // Validate we got at least the core metrics
  if (result.systemPrompt === 0 && result.systemTools === 0) {
    return null
  }

  return result
}

/**
 * Extract /context output from a transcript line object.
 * Handles both raw string content and parsed JSON structures.
 *
 * @param line - Transcript line (string or parsed object)
 * @returns Extracted content string, or null if not applicable
 */
export function extractContextOutput(line: unknown): string | null {
  if (typeof line === 'string') {
    if (isContextCommandOutput(line)) {
      return line
    }
    return null
  }

  // Handle parsed transcript line objects
  if (typeof line === 'object' && line !== null) {
    const obj = line as Record<string, unknown>

    // Check message content
    if (typeof obj.content === 'string' && isContextCommandOutput(obj.content)) {
      return obj.content
    }

    // Check nested message.content
    if (typeof obj.message === 'object' && obj.message !== null) {
      const msg = obj.message as Record<string, unknown>
      if (typeof msg.content === 'string' && isContextCommandOutput(msg.content)) {
        return msg.content
      }
    }
  }

  return null
}
