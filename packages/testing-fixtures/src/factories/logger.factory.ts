/**
 * Factory for creating fake Logger instances using vi.fn() mocks.
 *
 * Unlike MockLogger (which records logs for assertions), this factory
 * creates vi.fn()-based mocks suitable for spy assertions like
 * `expect(logger.debug).toHaveBeenCalledWith(...)`.
 */

import { vi } from 'vitest'
import type { Logger } from '@sidekick/types'

/**
 * Create a fake Logger where every method is a `vi.fn()`.
 * The `child()` method returns a new fake logger (recursive).
 */
export function createFakeLogger(): Logger {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mock: Record<string, any> = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => createFakeLogger()),
    flush: vi.fn().mockResolvedValue(undefined),
  }
  return mock as unknown as Logger
}
