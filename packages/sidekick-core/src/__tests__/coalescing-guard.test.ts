import { describe, it, expect, vi } from 'vitest'
import { CoalescingGuard } from '../coalescing-guard.js'

describe('CoalescingGuard', () => {
  it('executes fn and returns true for a single call', async () => {
    const guard = new CoalescingGuard<string>()
    const fn = vi.fn().mockResolvedValue(undefined)
    const result = await guard.run('key1', fn)
    expect(result).toBe(true)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('coalesces concurrent calls with same key — fn runs exactly twice', async () => {
    const guard = new CoalescingGuard<string>()
    let resolveFirst!: () => void
    const barrier = new Promise<void>((r) => { resolveFirst = r })
    let callCount = 0
    const fn = vi.fn(async () => {
      callCount++
      if (callCount === 1) await barrier // block first call
    })

    const p1 = guard.run('key1', fn)
    const coalesced = await guard.run('key1', fn)
    expect(coalesced).toBe(false) // second call was coalesced

    resolveFirst() // unblock first call
    await p1
    // Wait for fire-and-forget rerun to settle
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('executes independently for different keys', async () => {
    const guard = new CoalescingGuard<string>()
    const fn1 = vi.fn().mockResolvedValue(undefined)
    const fn2 = vi.fn().mockResolvedValue(undefined)

    const [r1, r2] = await Promise.all([
      guard.run('key1', fn1),
      guard.run('key2', fn2),
    ])
    expect(r1).toBe(true)
    expect(r2).toBe(true)
    expect(fn1).toHaveBeenCalledOnce()
    expect(fn2).toHaveBeenCalledOnce()
  })

  it('three rapid calls — fn runs exactly twice (third coalesces into pending)', async () => {
    const guard = new CoalescingGuard<string>()
    let resolveFirst!: () => void
    const barrier = new Promise<void>((r) => { resolveFirst = r })
    let callCount = 0
    const fn = vi.fn(async () => {
      callCount++
      if (callCount === 1) await barrier
    })

    const p1 = guard.run('key1', fn)
    const r2 = await guard.run('key1', fn)
    const r3 = await guard.run('key1', fn)
    expect(r2).toBe(false)
    expect(r3).toBe(false)

    resolveFirst()
    await p1
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(fn).toHaveBeenCalledTimes(2) // not 3
  })

  it('clear() resets inflight state', async () => {
    const guard = new CoalescingGuard<string>()
    let resolveFirst!: () => void
    const barrier = new Promise<void>((r) => { resolveFirst = r })
    const fn = vi.fn(async () => { await barrier })

    const p1 = guard.run('key1', fn)
    // While in-flight, clear should wipe state
    guard.clear()

    // After clear, a new call should execute (not coalesce)
    const fn2 = vi.fn().mockResolvedValue(undefined)
    const result = await guard.run('key1', fn2)
    expect(result).toBe(true)
    expect(fn2).toHaveBeenCalledOnce()

    // Clean up the dangling promise
    resolveFirst()
    await p1
  })

  it('cleans up on error — suppresses pending rerun, next call works', async () => {
    const guard = new CoalescingGuard<string>()
    const error = new Error('boom')
    let callCount = 0
    const failingFn = vi.fn(async () => {
      callCount++
      if (callCount === 1) throw error
    })

    // First call throws, second is coalesced
    const p1 = guard.run('key1', failingFn)
    const coalesced = await guard.run('key1', failingFn)
    expect(coalesced).toBe(false)

    await expect(p1).rejects.toThrow('boom')
    await new Promise<void>((r) => setTimeout(r, 10))
    // Rerun was suppressed because first call failed
    expect(failingFn).toHaveBeenCalledTimes(1)

    // Guard is clean — next call works normally
    const successFn = vi.fn().mockResolvedValue(undefined)
    const result = await guard.run('key1', successFn)
    expect(result).toBe(true)
    expect(successFn).toHaveBeenCalledOnce()
  })
})
