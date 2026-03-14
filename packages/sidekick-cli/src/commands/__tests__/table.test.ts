/**
 * Tests for ASCII table formatting utilities.
 *
 * Verifies behavior of wrapText, renderTable, and renderEmptyTable:
 * - Word wrapping within column widths
 * - Long word splitting when word exceeds column width
 * - Flex column width resolution
 * - Multi-line cell rendering
 * - Empty table message rendering
 *
 * These are pure functions with no external dependencies.
 */
import { describe, expect, test } from 'vitest'
import { renderTable, renderEmptyTable, type TableOptions } from '../table.js'

describe('renderTable', () => {
  const simpleOptions: TableOptions = {
    totalWidth: 40,
    columns: [
      { header: 'Name', width: 10 },
      { header: 'Value', width: 'flex' },
    ],
  }

  test('renders header and data rows', () => {
    const result = renderTable([['foo', 'bar']], simpleOptions)

    expect(result).toContain('Name')
    expect(result).toContain('Value')
    expect(result).toContain('foo')
    expect(result).toContain('bar')
  })

  test('wraps long text within column width', () => {
    const result = renderTable([['short', 'this is a longer text that should wrap']], simpleOptions)

    // Should produce multiple lines for the second column
    expect(result).toContain('this is a')
    expect(result).toContain('short')
  })

  test('splits words longer than column width into chunks', () => {
    const options: TableOptions = {
      totalWidth: 30,
      columns: [
        { header: 'A', width: 5 },
        { header: 'B', width: 5 },
      ],
    }

    // 'abcdefghij' is 10 chars, wider than the 5-char column
    const result = renderTable([['abcdefghij', 'ok']], options)

    // Word should be split into 'abcde' and 'fghij'
    expect(result).toContain('abcde')
    expect(result).toContain('fghij')
  })

  test('handles word break with existing line content', () => {
    const options: TableOptions = {
      totalWidth: 30,
      columns: [
        { header: 'Col', width: 5 },
        { header: 'Val', width: 5 },
      ],
    }

    // 'hi abcdefghij' — 'hi' fits, then 'abcdefghij' needs splitting
    const result = renderTable([['hi abcdefghij', 'ok']], options)

    expect(result).toContain('hi')
    expect(result).toContain('abcde')
  })

  test('handles empty data array', () => {
    const result = renderTable([], simpleOptions)

    // Should still have header
    expect(result).toContain('Name')
    expect(result).toContain('Value')
    // Should have border lines: top border, header, header separator, bottom border
    const lines = result.split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(4)
  })

  test('handles empty string cells', () => {
    const result = renderTable([['', '']], simpleOptions)

    // Should render without errors
    expect(result).toContain('|')
  })

  test('resolves flex column with minWidth', () => {
    const options: TableOptions = {
      totalWidth: 30,
      columns: [
        { header: 'Fixed', width: 10 },
        { header: 'Flex', width: 'flex', minWidth: 5 },
      ],
    }

    const result = renderTable([['data', 'value']], options)

    expect(result).toContain('data')
    expect(result).toContain('value')
  })

  test('handles null/undefined cell values gracefully', () => {
    const result = renderTable([['value', null as unknown as string]], simpleOptions)

    // Should render without throwing
    expect(result).toBeDefined()
  })
})

describe('renderEmptyTable', () => {
  test('renders centered message', () => {
    const result = renderEmptyTable('No data found', 40)

    expect(result).toContain('No data found')
    expect(result).toContain('+')
    expect(result).toContain('|')
  })

  test('uses default width of 100', () => {
    const result = renderEmptyTable('Empty')

    const lines = result.split('\n')
    // Border line should be 100 chars
    expect(lines[0].length).toBe(100)
  })
})
