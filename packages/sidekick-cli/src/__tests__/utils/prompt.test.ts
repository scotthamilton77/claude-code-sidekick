/**
 * Tests for shared promptConfirm utility.
 *
 * Uses Readable.from() to simulate stdin with predetermined responses.
 */
import { describe, test, expect } from 'vitest'
import { Readable, Writable } from 'node:stream'
import { promptConfirm } from '../../utils/prompt.js'

/** Create a writable stream that captures output. */
function createCapture(): Writable & { data: string } {
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      ;(stream as Writable & { data: string }).data += chunk.toString()
      callback()
    },
  }) as Writable & { data: string }
  stream.data = ''
  return stream
}

/** Create a readable stream from lines. */
function createInput(...lines: string[]): Readable {
  return Readable.from(lines.map((l) => l + '\n'))
}

describe('promptConfirm', () => {
  test('returns true for "y" input', async () => {
    const stdout = createCapture()
    const result = await promptConfirm({ stdin: createInput('y'), stdout }, 'Continue?')

    expect(result).toBe(true)
  })

  test('returns true for "yes" input', async () => {
    const stdout = createCapture()
    const result = await promptConfirm({ stdin: createInput('yes'), stdout }, 'Continue?')

    expect(result).toBe(true)
  })

  test('returns true for "Y" input (case insensitive)', async () => {
    const stdout = createCapture()
    const result = await promptConfirm({ stdin: createInput('Y'), stdout }, 'Continue?')

    expect(result).toBe(true)
  })

  test('returns false for "n" input', async () => {
    const stdout = createCapture()
    const result = await promptConfirm({ stdin: createInput('n'), stdout }, 'Continue?')

    expect(result).toBe(false)
  })

  test('returns false for "no" input', async () => {
    const stdout = createCapture()
    const result = await promptConfirm({ stdin: createInput('no'), stdout }, 'Continue?')

    expect(result).toBe(false)
  })

  test('returns defaultYes=false on empty input when default is false', async () => {
    const stdout = createCapture()
    const result = await promptConfirm({ stdin: createInput(''), stdout }, 'Continue?', false)

    expect(result).toBe(false)
  })

  test('returns defaultYes=true on empty input when default is true', async () => {
    const stdout = createCapture()
    const result = await promptConfirm({ stdin: createInput(''), stdout }, 'Continue?', true)

    expect(result).toBe(true)
  })

  test('displays [Y/n] hint when defaultYes is true', async () => {
    const stdout = createCapture()
    await promptConfirm({ stdin: createInput('y'), stdout }, 'Proceed?', true)

    expect(stdout.data).toContain('[Y/n]')
  })

  test('displays [y/N] hint when defaultYes is false', async () => {
    const stdout = createCapture()
    await promptConfirm({ stdin: createInput('y'), stdout }, 'Proceed?', false)

    expect(stdout.data).toContain('[y/N]')
  })

  test('retries on invalid input, then accepts valid answer', async () => {
    const stdout = createCapture()
    // First line is invalid, second is valid
    const result = await promptConfirm({ stdin: createInput('maybe', 'y'), stdout }, 'Continue?')

    expect(result).toBe(true)
    expect(stdout.data).toContain('Please enter y or n.')
  })

  test('resolves with default on EOF (closed stdin)', async () => {
    const stdout = createCapture()
    // Create a stream that immediately ends (no data)
    const stdin = new Readable({
      read() {
        this.push(null)
      },
    })
    const result = await promptConfirm({ stdin, stdout }, 'Continue?', true)

    expect(result).toBe(true)
  })

  test('resolves with false default on EOF when defaultYes is false', async () => {
    const stdout = createCapture()
    const stdin = new Readable({
      read() {
        this.push(null)
      },
    })
    const result = await promptConfirm({ stdin, stdout }, 'Continue?', false)

    expect(result).toBe(false)
  })
})
