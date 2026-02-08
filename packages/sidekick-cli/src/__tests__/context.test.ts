/**
 * Tests for CLI Context Builder
 *
 * Verifies CLIContext creation for consumption handler registration.
 */

import { describe, expect, test, vi } from 'vitest'
import { buildCLIContext } from '../context'
import type { RuntimeShell } from '../runtime'

// Mock the external dependencies
vi.mock('@sidekick/core', () => ({
  HandlerRegistryImpl: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    invokeHook: vi.fn(),
    setContext: vi.fn(),
  })),
  DaemonClient: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    status: vi.fn(),
  })),
}))

// Note: @sidekick/feature-reminders mock removed - no longer testing registerCLIFeatures

function createMockRuntime(overrides: Partial<RuntimeShell> = {}): RuntimeShell {
  return {
    projectRoot: '/project',
    config: {
      get: vi.fn(),
    } as unknown as RuntimeShell['config'],
    logger: {
      debug: vi.fn() as any,
      info: vi.fn() as any,
      warn: vi.fn() as any,
      error: vi.fn() as any,
      child: vi.fn().mockReturnThis(),
    } as unknown as RuntimeShell['logger'],
    assets: {
      resolve: vi.fn(),
    } as unknown as RuntimeShell['assets'],
    telemetry: {
      flush: vi.fn() as any,
    } as unknown as RuntimeShell['telemetry'],
    stateService: {
      read: vi.fn(),
      write: vi.fn(),
      delete: vi.fn(),
      sessionStatePath: vi.fn(),
    } as unknown as RuntimeShell['stateService'],
    correlationId: 'test-correlation-id',
    cleanup: vi.fn(),
    bindSessionId: vi.fn(),
    getLogCounts: vi.fn().mockReturnValue({ warnings: 0, errors: 0 }),
    resetLogCounts: vi.fn(),
    loadExistingLogCounts: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('buildCLIContext', () => {
  test('builds valid CLIContext from RuntimeShell', () => {
    const runtime = createMockRuntime()

    const context = buildCLIContext({
      runtime,
      sessionId: 'test-session-123',
      transcriptPath: '/project/.claude/transcript.jsonl',
    })

    expect(context.role).toBe('cli')
    expect(context.paths.projectDir).toBe('/project')
    expect(context.paths.projectConfigDir).toBe('/project/.sidekick')
    expect(context.config).toBe(runtime.config)
    expect(context.logger).toBe(runtime.logger)
    expect(context.assets).toBe(runtime.assets)
    expect(context.handlers).toBeDefined()
    expect(context.daemon).toBeDefined()
  })

  test('throws when projectRoot is undefined', () => {
    const runtime = createMockRuntime({
      projectRoot: undefined,
    })

    expect(() =>
      buildCLIContext({
        runtime,
        sessionId: 'test-session-123',
      })
    ).toThrow('Cannot build CLIContext without project root')
  })

  test('sets userConfigDir to ~/.sidekick', () => {
    const runtime = createMockRuntime()

    const context = buildCLIContext({
      runtime,
      sessionId: 'test-session-123',
    })

    // userConfigDir should be the home directory + .sidekick
    expect(context.paths.userConfigDir).toContain('.sidekick')
  })
})

// Note: registerCLIFeatures test removed - it was a one-line wrapper verification
// that tested implementation (mock.toHaveBeenCalledWith), not behavior.
// TypeScript provides compile-time checking that the function is called correctly.
// The actual behavior of reminder registration is tested in feature-reminders tests.
