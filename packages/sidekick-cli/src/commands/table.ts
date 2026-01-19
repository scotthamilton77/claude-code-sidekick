/**
 * ASCII Table Formatter
 *
 * Renders data as an ASCII table with:
 * - Header row with column dividers
 * - Word wrapping within columns
 * - Configurable total width
 */

export interface TableColumn {
  /** Column header text */
  header: string
  /** Column width (characters). Use 'flex' to fill remaining space. */
  width: number | 'flex'
  /** Minimum width when using flex (default: header length + 2) */
  minWidth?: number
}

export interface TableOptions {
  /** Total table width in characters (default: 100) */
  totalWidth?: number
  /** Column definitions */
  columns: TableColumn[]
}

/**
 * Wrap text to fit within a given width.
 * Breaks on word boundaries when possible.
 */
function wrapText(text: string, width: number): string[] {
  if (!text || width <= 0) return ['']

  const words = text.split(/\s+/)
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    if (!word) continue

    // If the word itself is longer than width, break it
    if (word.length > width) {
      if (currentLine) {
        lines.push(currentLine)
        currentLine = ''
      }
      // Break long word into chunks
      for (let i = 0; i < word.length; i += width) {
        const chunk = word.slice(i, i + width)
        if (i + width < word.length) {
          lines.push(chunk)
        } else {
          currentLine = chunk
        }
      }
      continue
    }

    const testLine = currentLine ? `${currentLine} ${word}` : word
    if (testLine.length <= width) {
      currentLine = testLine
    } else {
      if (currentLine) {
        lines.push(currentLine)
      }
      currentLine = word
    }
  }

  if (currentLine) {
    lines.push(currentLine)
  }

  return lines.length > 0 ? lines : ['']
}

/**
 * Calculate actual column widths, resolving flex columns.
 */
function resolveColumnWidths(columns: TableColumn[], totalWidth: number): number[] {
  // Account for borders: | col1 | col2 | col3 |
  // That's (n + 1) pipes and n * 2 spaces for padding
  const borderOverhead = columns.length + 1 + columns.length * 2
  const availableWidth = totalWidth - borderOverhead

  // Calculate fixed widths and count flex columns
  let fixedWidth = 0
  let flexCount = 0

  for (const col of columns) {
    if (col.width === 'flex') {
      flexCount++
    } else {
      fixedWidth += col.width
    }
  }

  // Distribute remaining space to flex columns
  const remainingWidth = Math.max(0, availableWidth - fixedWidth)
  const flexWidth = flexCount > 0 ? Math.floor(remainingWidth / flexCount) : 0

  return columns.map((col) => {
    if (col.width === 'flex') {
      const minWidth = col.minWidth ?? col.header.length + 2
      return Math.max(minWidth, flexWidth)
    }
    return col.width
  })
}

/**
 * Render an ASCII table.
 *
 * @param data - Array of row data (each row is an array of cell values)
 * @param options - Table configuration
 * @returns Formatted table string
 */
export function renderTable(data: string[][], options: TableOptions): string {
  const totalWidth = options.totalWidth ?? 100
  const columnWidths = resolveColumnWidths(options.columns, totalWidth)

  const lines: string[] = []

  // Helper to create a horizontal line
  const horizontalLine = (char: string): string => {
    const segments = columnWidths.map((w) => char.repeat(w + 2))
    return `+${segments.join('+')}+`
  }

  // Helper to create a row (handles multi-line cells)
  const createRow = (cells: string[]): string[] => {
    // Wrap each cell and get the max lines needed
    const wrappedCells = cells.map((cell, i) => wrapText(cell ?? '', columnWidths[i]))
    const maxLines = Math.max(...wrappedCells.map((w) => w.length))

    const rowLines: string[] = []
    for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
      const parts = wrappedCells.map((wrapped, colIdx) => {
        const text = wrapped[lineIdx] ?? ''
        return ` ${text.padEnd(columnWidths[colIdx])} `
      })
      rowLines.push(`|${parts.join('|')}|`)
    }
    return rowLines
  }

  // Top border
  lines.push(horizontalLine('-'))

  // Header row
  const headers = options.columns.map((c) => c.header)
  lines.push(...createRow(headers))

  // Header separator
  lines.push(horizontalLine('-'))

  // Data rows
  for (const row of data) {
    lines.push(...createRow(row))
  }

  // Bottom border
  lines.push(horizontalLine('-'))

  return lines.join('\n')
}

/**
 * Render an empty table message.
 */
export function renderEmptyTable(message: string, totalWidth: number = 100): string {
  const innerWidth = totalWidth - 4 // Account for "| " and " |"
  const paddedMessage = message.padStart(Math.floor((innerWidth + message.length) / 2)).padEnd(innerWidth)
  const border = '+' + '-'.repeat(totalWidth - 2) + '+'
  return [border, `| ${paddedMessage} |`, border].join('\n')
}
