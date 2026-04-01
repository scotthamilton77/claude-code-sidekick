/**
 * Daemon IPC Dispatch Safety Net Tests
 *
 * Tests the IPC routing table — verifies all methods dispatch correctly
 * and token validation works. These tests are designed to survive the
 * Daemon decomposition into extracted modules.
 *
 * Strategy: Tests ONLY through handleIpcRequest (stays on Daemon).
 * Does NOT access any fields that will MOVE during extraction.
 *
 * @see docs/design/DAEMON.md §4.1 IPC Protocol
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

let tmpDir: string

describe('Daemon IPC dispatch', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'ipc-dispatch-test-'))
    await fs.mkdir(join(tmpDir, '.sidekick'), { recursive: true })
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await new Promise((r) => setImmediate(r))
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true })
    }
  })

  /**
   * Helper to create a Daemon with handleIpcRequest access.
   */
  async function createTestDaemon(projectDir: string): Promise<{
    daemon: InstanceType<typeof import('../daemon.js').Daemon>
    sup: { token: string; handleIpcRequest(method: string, params: unknown): Promise<unknown> }
  }> {
    const { Daemon } = await import('../daemon.js')
    const daemon = new Daemon(projectDir)
    const sup = daemon as unknown as {
      token: string
      handleIpcRequest(method: string, params: unknown): Promise<unknown>
    }
    sup.token = 'test-token'
    return { daemon, sup }
  }

  // -------------------------------------------------------------------------
  // Core routes
  // -------------------------------------------------------------------------

  describe('core routes', () => {
    it('handshake with correct token returns version and ok status', async () => {
      const { sup } = await createTestDaemon(tmpDir)

      const result = await sup.handleIpcRequest('handshake', { token: 'test-token' })

      expect(result).toMatchObject({
        version: expect.any(String),
        status: 'ok',
      })
    })

    it('ping returns pong', async () => {
      const { sup } = await createTestDaemon(tmpDir)

      const result = await sup.handleIpcRequest('ping', { token: 'test-token' })

      expect(result).toBe('pong')
    })

    it('shutdown returns stopping status', async () => {
      const { daemon, sup } = await createTestDaemon(tmpDir)

      // Mock stop() to prevent actual process.exit
      vi.spyOn(daemon as unknown as { stop(): Promise<void> }, 'stop').mockResolvedValue(undefined)

      const result = await sup.handleIpcRequest('shutdown', { token: 'test-token' })

      expect(result).toEqual({ status: 'stopping' })
    })

    it('unknown method throws Method not found', async () => {
      const { sup } = await createTestDaemon(tmpDir)

      await expect(sup.handleIpcRequest('nonexistent', { token: 'test-token' })).rejects.toThrow(
        'Method not found: nonexistent'
      )
    })
  })

  // -------------------------------------------------------------------------
  // Token validation
  // -------------------------------------------------------------------------

  describe('token validation', () => {
    it('non-handshake request without token throws Unauthorized', async () => {
      const { sup } = await createTestDaemon(tmpDir)

      await expect(sup.handleIpcRequest('ping', {})).rejects.toThrow('Unauthorized')
    })

    it('non-handshake request with wrong token throws Unauthorized', async () => {
      const { sup } = await createTestDaemon(tmpDir)

      await expect(sup.handleIpcRequest('ping', { token: 'wrong-token' })).rejects.toThrow('Unauthorized')
    })

    it('handshake with wrong token throws Invalid token', async () => {
      const { sup } = await createTestDaemon(tmpDir)

      // Handshake skips the pre-check and validates inside the handler,
      // producing a different error message than Unauthorized
      await expect(sup.handleIpcRequest('handshake', { token: 'wrong-token' })).rejects.toThrow('Invalid token')
    })
  })

  // -------------------------------------------------------------------------
  // Feature routes exist (verified by NOT getting "Method not found")
  // -------------------------------------------------------------------------

  describe('feature routes exist', () => {
    it('hook.invoke without params throws parameter error', async () => {
      const { sup } = await createTestDaemon(tmpDir)

      await expect(sup.handleIpcRequest('hook.invoke', { token: 'test-token' })).rejects.toThrow(
        'hook.invoke requires hook and event parameters'
      )
    })

    it('reminder.consumed without params throws parameter error', async () => {
      const { sup } = await createTestDaemon(tmpDir)

      await expect(sup.handleIpcRequest('reminder.consumed', { token: 'test-token' })).rejects.toThrow(
        'reminder.consumed requires sessionId, reminderName, and metrics'
      )
    })

    it('completion.classify dispatches (not "Method not found")', async () => {
      const { sup } = await createTestDaemon(tmpDir)

      try {
        await sup.handleIpcRequest('completion.classify', { token: 'test-token' })
        // If it succeeds, the route exists — fine
      } catch (err) {
        const msg = (err as Error).message
        expect(msg).not.toContain('Method not found')
      }
    })

    it('persona.set dispatches (not "Method not found")', async () => {
      const { sup } = await createTestDaemon(tmpDir)

      try {
        await sup.handleIpcRequest('persona.set', { token: 'test-token' })
      } catch (err) {
        const msg = (err as Error).message
        expect(msg).not.toContain('Method not found')
      }
    })

    it('snarky.generate dispatches (not "Method not found")', async () => {
      const { sup } = await createTestDaemon(tmpDir)

      try {
        await sup.handleIpcRequest('snarky.generate', { token: 'test-token' })
      } catch (err) {
        const msg = (err as Error).message
        expect(msg).not.toContain('Method not found')
      }
    })

    it('resume.generate dispatches (not "Method not found")', async () => {
      const { sup } = await createTestDaemon(tmpDir)

      try {
        await sup.handleIpcRequest('resume.generate', { token: 'test-token' })
      } catch (err) {
        const msg = (err as Error).message
        expect(msg).not.toContain('Method not found')
      }
    })

    it('vc-unverified.set dispatches (not "Method not found")', async () => {
      const { sup } = await createTestDaemon(tmpDir)

      try {
        await sup.handleIpcRequest('vc-unverified.set', { token: 'test-token' })
      } catch (err) {
        const msg = (err as Error).message
        expect(msg).not.toContain('Method not found')
      }
    })

    it('vc-unverified.clear dispatches (not "Method not found")', async () => {
      const { sup } = await createTestDaemon(tmpDir)

      try {
        await sup.handleIpcRequest('vc-unverified.clear', { token: 'test-token' })
      } catch (err) {
        const msg = (err as Error).message
        expect(msg).not.toContain('Method not found')
      }
    })

    it('task.enqueue dispatches (not "Method not found")', async () => {
      const { sup } = await createTestDaemon(tmpDir)

      try {
        await sup.handleIpcRequest('task.enqueue', {
          token: 'test-token',
          type: 'test-task',
          payload: {},
        })
      } catch (err) {
        const msg = (err as Error).message
        expect(msg).not.toContain('Method not found')
      }
    })
  })
})
