/**
 * Tests for prompts.ts — display and input helpers for the setup wizard.
 *
 * Tests printHeader, printStatus, promptSelect, promptConfirm, and promptInput.
 * Uses a fake PromptContext with writable buffers and readable streams.
 */

import { describe, it, expect } from 'vitest'
import { PassThrough } from 'node:stream'
import type { PromptContext } from '../prompts.js'
import { printHeader, printStatus, promptSelect, promptConfirm, promptInput } from '../prompts.js'

// ============================================================================
// Helpers
// ============================================================================

import { stripAnsi } from '@sidekick/feature-statusline'

function createContext(inputLines: string[] = []): {
  ctx: PromptContext
  getOutput: () => string
  stdin: PassThrough
} {
  const chunks: Buffer[] = []
  const stdout = new PassThrough()
  stdout.on('data', (chunk: Buffer) => chunks.push(chunk))

  const stdin = new PassThrough()
  if (inputLines.length > 0) {
    for (const line of inputLines) {
      stdin.write(line + '\n')
    }
    stdin.end()
  }

  return {
    ctx: { stdin: stdin as NodeJS.ReadableStream, stdout },
    getOutput: () => Buffer.concat(chunks).toString(),
    stdin,
  }
}

// ============================================================================
// printHeader
// ============================================================================

describe('printHeader', () => {
  it('writes title with bold formatting and separator line', () => {
    const { ctx, getOutput } = createContext()
    printHeader(ctx, 'Setup Wizard')
    const output = getOutput()
    expect(output).toContain('Setup Wizard')
    expect(output).toContain('─')
  })

  it('includes description when provided', () => {
    const { ctx, getOutput } = createContext()
    printHeader(ctx, 'Title', 'Some description here')
    const output = getOutput()
    expect(output).toContain('Some description here')
  })

  it('omits description line when not provided', () => {
    const { ctx, getOutput } = createContext()
    printHeader(ctx, 'Title Only')
    const output = getOutput()
    // Should have title and separator but no extra dim-formatted line
    const lines = output.split('\n').filter((l) => l.length > 0)
    // Empty line, bold title, separator — at most 3 non-empty segments
    expect(lines.length).toBeLessThanOrEqual(3)
  })

  it('caps separator length at 60 characters', () => {
    const { ctx, getOutput } = createContext()
    const longTitle = 'A'.repeat(80)
    printHeader(ctx, longTitle)
    const output = getOutput()
    // Separator should be exactly 60 '─' characters (the min clamp)
    const separatorLine = output.split('\n').find((l) => /^─+$/.test(stripAnsi(l)))
    expect(separatorLine).toBeDefined()
    const cleaned = stripAnsi(separatorLine!)
    expect(cleaned.length).toBe(60)
  })
})

// ============================================================================
// printStatus
// ============================================================================

describe('printStatus', () => {
  it('writes success icon for success type', () => {
    const { ctx, getOutput } = createContext()
    printStatus(ctx, 'success', 'All good')
    const output = getOutput()
    expect(output).toContain('✓')
    expect(output).toContain('All good')
  })

  it('writes warning icon for warning type', () => {
    const { ctx, getOutput } = createContext()
    printStatus(ctx, 'warning', 'Watch out')
    const output = getOutput()
    expect(output).toContain('⚠')
    expect(output).toContain('Watch out')
  })

  it('writes info icon for info type', () => {
    const { ctx, getOutput } = createContext()
    printStatus(ctx, 'info', 'FYI')
    const output = getOutput()
    expect(output).toContain('•')
    expect(output).toContain('FYI')
  })

  it('writes error icon for error type', () => {
    const { ctx, getOutput } = createContext()
    printStatus(ctx, 'error', 'Kaboom')
    const output = getOutput()
    expect(output).toContain('✗')
    expect(output).toContain('Kaboom')
  })
})

// ============================================================================
// promptSelect
// ============================================================================

describe('promptSelect', () => {
  it('returns selected option by number', async () => {
    const { ctx } = createContext(['2'])
    const result = await promptSelect(ctx, 'Pick one:', [
      { value: 'a' as const, label: 'Option A' },
      { value: 'b' as const, label: 'Option B' },
      { value: 'c' as const, label: 'Option C' },
    ])
    expect(result).toBe('b')
  })

  it('returns default (first) option on empty input', async () => {
    const { ctx } = createContext([''])
    const result = await promptSelect(ctx, 'Pick one:', [
      { value: 'first' as const, label: 'First' },
      { value: 'second' as const, label: 'Second' },
    ])
    expect(result).toBe('first')
  })

  it('respects custom defaultIndex', async () => {
    const { ctx } = createContext([''])
    const result = await promptSelect(
      ctx,
      'Pick:',
      [
        { value: 'a' as const, label: 'A' },
        { value: 'b' as const, label: 'B' },
        { value: 'c' as const, label: 'C' },
      ],
      2
    )
    expect(result).toBe('c')
  })

  it('shows option descriptions in output', async () => {
    const { ctx, getOutput } = createContext(['1'])
    await promptSelect(ctx, 'Choose:', [{ value: 'x' as const, label: 'X Label', description: 'X Description' }])
    const output = getOutput()
    expect(output).toContain('X Label')
    expect(output).toContain('X Description')
  })

  it('retries on invalid input then accepts valid input', async () => {
    // '99' is invalid, then '1' is valid
    const { ctx } = createContext(['99', '1'])
    const result = await promptSelect(ctx, 'Pick:', [{ value: 'only' as const, label: 'Only Option' }])
    expect(result).toBe('only')
  })

  it('returns default option when stdin closes without answer (EOF)', async () => {
    const { ctx, stdin } = createContext()
    const promise = promptSelect(ctx, 'Pick one:', [
      { value: 'a' as const, label: 'Option A' },
      { value: 'b' as const, label: 'Option B' },
    ])
    // Close stdin to simulate EOF
    stdin.end()
    expect(await promise).toBe('a')
  })

  it('handles partial input then EOF without double-resolution', async () => {
    const { ctx, stdin } = createContext()
    const promise = promptSelect(ctx, 'Pick:', [
      { value: 'a' as const, label: 'Option A' },
      { value: 'b' as const, label: 'Option B' },
    ])
    // Write valid selection without newline, then close
    // readline emits 'line' with buffered data on close, then 'close' fires
    stdin.write('2')
    stdin.end()
    expect(await promise).toBe('b')
  })
})

// ============================================================================
// promptConfirm
// ============================================================================

describe('promptConfirm', () => {
  it('returns true on "y" input', async () => {
    const { ctx } = createContext(['y'])
    expect(await promptConfirm(ctx, 'Continue?')).toBe(true)
  })

  it('returns true on "yes" input', async () => {
    const { ctx } = createContext(['yes'])
    expect(await promptConfirm(ctx, 'Continue?')).toBe(true)
  })

  it('returns false on "n" input', async () => {
    const { ctx } = createContext(['n'])
    expect(await promptConfirm(ctx, 'Continue?')).toBe(false)
  })

  it('returns false on "no" input', async () => {
    const { ctx } = createContext(['no'])
    expect(await promptConfirm(ctx, 'Continue?')).toBe(false)
  })

  it('returns default (true) on empty input when defaultYes=true', async () => {
    const { ctx } = createContext([''])
    expect(await promptConfirm(ctx, 'Continue?', true)).toBe(true)
  })

  it('returns default (false) on empty input when defaultYes=false', async () => {
    const { ctx } = createContext([''])
    expect(await promptConfirm(ctx, 'Continue?', false)).toBe(false)
  })

  it('shows [Y/n] hint when defaultYes=true', async () => {
    const { ctx, getOutput } = createContext(['y'])
    await promptConfirm(ctx, 'Continue?', true)
    expect(getOutput()).toContain('[Y/n]')
  })

  it('shows [y/N] hint when defaultYes=false', async () => {
    const { ctx, getOutput } = createContext(['n'])
    await promptConfirm(ctx, 'Continue?', false)
    expect(getOutput()).toContain('[y/N]')
  })

  it('retries on invalid input then accepts valid', async () => {
    const { ctx } = createContext(['maybe', 'y'])
    expect(await promptConfirm(ctx, 'Sure?')).toBe(true)
  })

  it('returns default when stdin closes without answer (EOF)', async () => {
    const { ctx, stdin } = createContext()
    const promise = promptConfirm(ctx, 'Continue?', true)
    // Close stdin to simulate EOF
    stdin.end()
    expect(await promise).toBe(true)
  })

  it('handles partial input then EOF without double-resolution', async () => {
    const { ctx, stdin } = createContext()
    const promise = promptConfirm(ctx, 'Continue?')
    // Write data without newline, then close
    stdin.write('y')
    stdin.end()
    expect(await promise).toBe(true)
  })
})

// ============================================================================
// promptInput
// ============================================================================

describe('promptInput', () => {
  it('returns trimmed user input', async () => {
    const { ctx } = createContext(['  sk-mykey123  '])
    const result = await promptInput(ctx, 'Enter API key')
    expect(result).toBe('sk-mykey123')
  })

  it('returns empty string for empty input', async () => {
    const { ctx } = createContext([''])
    const result = await promptInput(ctx, 'Enter value')
    expect(result).toBe('')
  })

  it('shows question in output', async () => {
    const { ctx, getOutput } = createContext(['answer'])
    await promptInput(ctx, 'What is your name')
    expect(getOutput()).toContain('What is your name')
  })

  it('returns empty string when stdin closes without answer (EOF)', async () => {
    const { ctx, stdin } = createContext()
    const promise = promptInput(ctx, 'Enter API key')
    // Close stdin to simulate EOF
    stdin.end()
    expect(await promise).toBe('')
  })

  it('handles partial input then EOF without double-resolution', async () => {
    const { ctx, stdin } = createContext()
    const promise = promptInput(ctx, 'Enter key')
    // Write data without newline, then close
    stdin.write('my-api-key')
    stdin.end()
    expect(await promise).toBe('my-api-key')
  })
})
