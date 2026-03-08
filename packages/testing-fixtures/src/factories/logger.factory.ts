/**
 * Fake Logger Factory
 *
 * Provides a lightweight Logger implementation using vi.fn() for use in tests
 * that need spy capabilities (toHaveBeenCalledWith, etc.).
 *
 * For tests that only need log recording without vitest spies, use MockLogger instead.
 */

import { vi } from 'vitest'
import type { Logger } from '@sidekick/types'

/**
 * Create a fake Logger with vi.fn() methods for spy-based assertions.
 * Each method is a vitest mock function that can be asserted on.
 * `child()` returns a new fake logger (recursive).
 *
 * @example
 * ```typescript
 * const logger = createFakeLogger()
 * myFunction(logger)
 * expect(logger.warn).toHaveBeenCalledWith('something happened')
 * ```
 */
export function createFakeLogger(): Logger {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => createFakeLogger()),
    flush: vi.fn().mockResolvedValue(undefined),
  } as unknown as Logger
}
