/**
 * Subagent Hook Pipeline Integration Tests
 *
 * Tests the complete pipeline from raw JSON payloads through CLI parsing,
 * hook event construction, and handler dispatch — verifying subagent identity
 * (agentId/agentType) is preserved end-to-end.
 *
 * These tests avoid actual IPC/Unix socket operations so they run in the
 * Claude Code sandbox. Full daemon IPC round-trips require INTEGRATION_TESTS=1
 * outside sandbox (see packages/sidekick-core/src/ipc/__tests__/ipc.test.ts).
 *
 * @see docs/design/flow.md §5 Complete Hook Flows
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HandlerRegistryImpl } from '@sidekick/core'
import type { HookEvent, Logger } from '@sidekick/types'
import { parseHookInput } from '../cli.js'
import { buildHookEvent } from '../commands/hook.js'

// ============================================================================
// Test Helpers
// ============================================================================

function createMockLogger(): Logger {
  return {
    trace: vi.fn() as any,
    debug: vi.fn() as any,
    info: vi.fn() as any,
    warn: vi.fn() as any,
    error: vi.fn() as any,
    fatal: vi.fn() as any,
    child: vi.fn(() => createMockLogger()),
    flush: vi.fn(() => Promise.resolve()),
  }
}

// ============================================================================
// Pipeline Tests: raw JSON → parseHookInput → buildHookEvent → handler dispatch
// ============================================================================

describe('subagent hook pipeline (IPC-free integration)', () => {
  let registry: HandlerRegistryImpl
  let logger: Logger

  beforeEach(() => {
    logger = createMockLogger()
    registry = new HandlerRegistryImpl({
      logger,
      sessionId: 'test-session',
    })
  })

  describe('SubagentStart: raw JSON → handler receives event with identity intact', () => {
    it('dispatches SubagentStart with agentId and agentType preserved', async () => {
      const received: HookEvent[] = []
      registry.register({
        id: 'subagent-start-pipeline',
        priority: 50,
        filter: { kind: 'hook', hooks: ['SubagentStart'] },
        handler: (event) => {
          received.push(event as HookEvent)
          return Promise.resolve()
        },
      })

      const rawJson = JSON.stringify({
        session_id: 'sess-pipeline-test',
        transcript_path: '/tmp/transcript.jsonl',
        hook_event_name: 'SubagentStart',
        agent_id: 'agent-pipeline-001',
        agent_type: 'Bash',
      })

      const parsed = parseHookInput(rawJson)
      expect(parsed).toBeDefined()
      expect(parsed!.agentId).toBe('agent-pipeline-001')
      expect(parsed!.agentType).toBe('Bash')

      const event = buildHookEvent('SubagentStart', parsed!, 'corr-001')
      await registry.invokeHook('SubagentStart', event)

      expect(received).toHaveLength(1)
      const subagentEvent = received[0] as Extract<HookEvent, { hook: 'SubagentStart' }>
      expect(subagentEvent.hook).toBe('SubagentStart')
      expect(subagentEvent.context.agentId).toBe('agent-pipeline-001')
      expect(subagentEvent.context.agentType).toBe('Bash')
      // D1 builder invariant: payload must match context
      expect(subagentEvent.payload.agentId).toBe(subagentEvent.context.agentId)
      expect(subagentEvent.payload.agentType).toBe(subagentEvent.context.agentType)
    })
  })

  describe('SubagentStop: raw JSON → handler receives event with identity intact', () => {
    it('dispatches SubagentStop with all fields preserved', async () => {
      const received: HookEvent[] = []
      registry.register({
        id: 'subagent-stop-pipeline',
        priority: 50,
        filter: { kind: 'hook', hooks: ['SubagentStop'] },
        handler: (event) => {
          received.push(event as HookEvent)
          return Promise.resolve()
        },
      })

      const rawJson = JSON.stringify({
        session_id: 'sess-pipeline-test',
        transcript_path: '/tmp/transcript.jsonl',
        hook_event_name: 'SubagentStop',
        permission_mode: 'default',
        agent_id: 'agent-pipeline-002',
        agent_type: 'Explore',
        agent_transcript_path: '/tmp/agent-pipeline-002-transcript.jsonl',
        last_assistant_message: 'Task complete.',
      })

      const parsed = parseHookInput(rawJson)
      expect(parsed).toBeDefined()
      expect(parsed!.agentId).toBe('agent-pipeline-002')
      expect(parsed!.agentType).toBe('Explore')

      const event = buildHookEvent('SubagentStop', parsed!, 'corr-002')
      await registry.invokeHook('SubagentStop', event)

      expect(received).toHaveLength(1)
      const stopEvent = received[0] as Extract<HookEvent, { hook: 'SubagentStop' }>
      expect(stopEvent.hook).toBe('SubagentStop')
      expect(stopEvent.context.agentId).toBe('agent-pipeline-002')
      expect(stopEvent.context.agentType).toBe('Explore')
      // D1 builder invariant
      expect(stopEvent.payload.agentId).toBe(stopEvent.context.agentId)
      expect(stopEvent.payload.agentType).toBe(stopEvent.context.agentType)
      expect(stopEvent.payload.agentTranscriptPath).toBe('/tmp/agent-pipeline-002-transcript.jsonl')
      expect(stopEvent.payload.lastAssistantMessage).toBe('Task complete.')
    })

    it('handles last_assistant_message with newlines, double-quotes, and non-ASCII', async () => {
      const received: HookEvent[] = []
      registry.register({
        id: 'subagent-stop-edge-cases',
        priority: 50,
        filter: { kind: 'hook', hooks: ['SubagentStop'] },
        handler: (event) => {
          received.push(event as HookEvent)
          return Promise.resolve()
        },
      })

      const complexMessage = 'Analysis complete.\n\nFound 3 "critical" issues — details follow: ✓'
      const rawJson = JSON.stringify({
        session_id: 'sess-edge-cases',
        transcript_path: '/tmp/transcript.jsonl',
        hook_event_name: 'SubagentStop',
        permission_mode: 'default',
        agent_id: 'agent-edge-001',
        agent_type: 'Bash',
        agent_transcript_path: '/tmp/edge-agent-transcript.jsonl',
        last_assistant_message: complexMessage,
      })

      const parsed = parseHookInput(rawJson)
      expect(parsed).toBeDefined()

      const event = buildHookEvent('SubagentStop', parsed!, 'corr-edge')
      await registry.invokeHook('SubagentStop', event)

      expect(received).toHaveLength(1)
      const stopEvent = received[0] as Extract<HookEvent, { hook: 'SubagentStop' }>
      expect(stopEvent.payload.lastAssistantMessage).toBe(complexMessage)
    })
  })

  describe('PreToolUse with agent_id/agent_type: tracer bullet integration', () => {
    it('PreToolUse event with agent_id/agent_type populates context.agentId', async () => {
      const received: HookEvent[] = []
      registry.register({
        id: 'pre-tool-use-agent-pipeline',
        priority: 50,
        filter: { kind: 'hook', hooks: ['PreToolUse'] },
        handler: (event) => {
          received.push(event as HookEvent)
          return Promise.resolve()
        },
      })

      const rawJson = JSON.stringify({
        session_id: 'sess-pretooluse-agent',
        transcript_path: '/tmp/transcript.jsonl',
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
        tool_use_id: 'tu-agent-001',
        agent_id: 'agent-in-subagent',
        agent_type: 'Plan',
      })

      const parsed = parseHookInput(rawJson)
      expect(parsed).toBeDefined()
      expect(parsed!.agentId).toBe('agent-in-subagent')

      const event = buildHookEvent('PreToolUse', parsed!, 'corr-pretooluse')
      await registry.invokeHook('PreToolUse', event)

      expect(received).toHaveLength(1)
      expect(received[0].context.agentId).toBe('agent-in-subagent')
      expect(received[0].context.agentType).toBe('Plan')
    })
  })
})
