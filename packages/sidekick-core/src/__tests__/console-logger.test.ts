/**
 * Console Logger Tests
 *
 * Tests for the minimal console logger used for bootstrap and testing.
 * Covers all log levels, level filtering, child(), and flush().
 *
 * @see logger.ts
 */

import { describe, it, expect } from 'vitest'
import { Writable } from 'node:stream'
import { createConsoleLogger } from '../logger'

function createTestSink(): { sink: Writable; lines: string[] } {
  const lines: string[] = []
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString().trim())
      callback()
    },
  })
  return { sink, lines }
}

describe('createConsoleLogger', () => {
  it('writes messages at or above minimum level', () => {
    const { sink, lines } = createTestSink()
    const logger = createConsoleLogger({ minimumLevel: 'warn', sink })

    logger.info('should be filtered')
    logger.warn('warning message')
    logger.error('error message')

    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('[WARN]')
    expect(lines[0]).toContain('warning message')
    expect(lines[1]).toContain('[ERROR]')
  })

  it('filters trace and debug at default info level', () => {
    const { sink, lines } = createTestSink()
    const logger = createConsoleLogger({ sink })

    logger.trace('trace message')
    logger.debug('debug message')
    logger.info('info message')

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('info message')
  })

  it('logs trace messages when minimum level is trace', () => {
    const { sink, lines } = createTestSink()
    const logger = createConsoleLogger({ minimumLevel: 'trace', sink })

    logger.trace('trace message', { detail: 'value' })

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('[TRACE]')
    expect(lines[0]).toContain('trace message')
    expect(lines[0]).toContain('"detail":"value"')
  })

  it('logs fatal messages', () => {
    const { sink, lines } = createTestSink()
    const logger = createConsoleLogger({ minimumLevel: 'trace', sink })

    logger.fatal('fatal error')

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('[FATAL]')
    expect(lines[0]).toContain('fatal error')
  })

  it('child() returns self (no-op for console logger)', () => {
    const { sink } = createTestSink()
    const logger = createConsoleLogger({ sink })

    const child = logger.child({ component: 'test' })

    expect(child).toBe(logger)
  })

  it('flush() resolves immediately (no-op)', async () => {
    const { sink } = createTestSink()
    const logger = createConsoleLogger({ sink })

    await expect(logger.flush()).resolves.toBeUndefined()
  })

  it('omits metadata suffix when meta is empty object', () => {
    const { sink, lines } = createTestSink()
    const logger = createConsoleLogger({ sink })

    logger.info('no meta', {})

    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('{}')
  })

  it('includes metadata suffix when meta has keys', () => {
    const { sink, lines } = createTestSink()
    const logger = createConsoleLogger({ sink })

    logger.info('with meta', { key: 'value' })

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('{"key":"value"}')
  })
})
