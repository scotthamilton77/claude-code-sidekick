/**
 * Fake Logger Factory
 *
 * Provides a lightweight Logger implementation using vi.fn() for use in tests
 * that need spy capabilities (toHaveBeenCalledWith, etc.).
 *
 * For tests that only need log recording without vitest spies, use MockLogger instead.
 */

import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { Logger } from '@sidekick/types'

/**
 * Logger where every method is a vitest Mock, enabling direct `.mock.calls`
 * access without casting. Intersected with Logger so it remains assignable
 * to Logger-typed parameters.
 */
export type MockedLogger = {
  [K in keyof Logger]: Mock
} & Logger

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
 * // Direct mock access without casting:
 * expect(logger.debug.mock.calls).toHaveLength(1)
 * ```
 */
export function createFakeLogger(): MockedLogger {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => createFakeLogger()),
    flush: vi.fn().mockResolvedValue(undefined),
  } as unknown as MockedLogger
}
