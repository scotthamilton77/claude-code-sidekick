/**
 * Tests for isInSandbox() utility.
 *
 * @see sandbox.ts
 * @see sidekick-a08 — Sandbox-aware daemon short-circuit
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isInSandbox } from '../sandbox.js'

describe('isInSandbox()', () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env.SANDBOX_RUNTIME
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SANDBOX_RUNTIME
    } else {
      process.env.SANDBOX_RUNTIME = originalEnv
    }
  })

  it('should return true when SANDBOX_RUNTIME is "1"', () => {
    process.env.SANDBOX_RUNTIME = '1'
    expect(isInSandbox()).toBe(true)
  })

  it('should return false when SANDBOX_RUNTIME is unset', () => {
    delete process.env.SANDBOX_RUNTIME
    expect(isInSandbox()).toBe(false)
  })

  it('should return false when SANDBOX_RUNTIME is "0"', () => {
    process.env.SANDBOX_RUNTIME = '0'
    expect(isInSandbox()).toBe(false)
  })

  it('should return false when SANDBOX_RUNTIME is empty string', () => {
    process.env.SANDBOX_RUNTIME = ''
    expect(isInSandbox()).toBe(false)
  })
})
