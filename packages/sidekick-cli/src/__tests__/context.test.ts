/**
 * Tests for CLI Context Builder
 *
 * Phase 8.5.4: Verifies CLIContext creation for consumption handler registration.
 */

import { describe, expect, test, vi } from 'vitest'
import { buildCLIContext, registerCLIFeatures } from '../context'
import type { RuntimeShell } from '../runtime'

// Mock the external dependencies
vi.mock('@sidekick/core', () => ({
  HandlerRegistryImpl: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    invokeHook: vi.fn(),
    setContext: vi.fn(),
  })),
  SupervisorClient: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    status: vi.fn(),
  })),
}))

vi.mock('@sidekick/feature-reminders', () => ({
  registerConsumptionHandlers: vi.fn(),
}))

function createMockRuntime(overrides: Partial<RuntimeShell> = {}): RuntimeShell {
  return {
    scope: {
      scope: 'project',
      source: 'hook-script-path',
      hookScriptPath: '/project/.claude/hooks/sidekick/session-start',
      projectRoot: '/project',
      dualInstallDetected: false,
      warnings: [],
    },
    config: {
      get: vi.fn(),
    } as unknown as RuntimeShell['config'],
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as RuntimeShell['logger'],
    assets: {
      resolve: vi.fn(),
    } as unknown as RuntimeShell['assets'],
    telemetry: {
      flush: vi.fn(),
    } as unknown as RuntimeShell['telemetry'],
    correlationId: 'test-correlation-id',
    cleanup: vi.fn(),
    bindSessionId: vi.fn(),
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
    expect(context.paths.hookScriptPath).toBe('/project/.claude/hooks/sidekick/session-start')
    expect(context.config).toBe(runtime.config)
    expect(context.logger).toBe(runtime.logger)
    expect(context.assets).toBe(runtime.assets)
    expect(context.handlers).toBeDefined()
    expect(context.supervisor).toBeDefined()
  })

  test('throws when projectRoot is undefined', () => {
    const runtime = createMockRuntime({
      scope: {
        scope: 'user',
        source: 'hook-script-path',
        hookScriptPath: '/home/user/.claude/hooks/sidekick/session-start',
        projectRoot: undefined,
        dualInstallDetected: false,
        warnings: [],
      },
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

describe('registerCLIFeatures', () => {
  test('registers consumption handlers from feature-reminders', async () => {
    const { registerConsumptionHandlers } = await import('@sidekick/feature-reminders')
    const runtime = createMockRuntime()
    const context = buildCLIContext({
      runtime,
      sessionId: 'test-session-123',
    })

    registerCLIFeatures(context)

    expect(registerConsumptionHandlers).toHaveBeenCalledWith(context)
  })
})
