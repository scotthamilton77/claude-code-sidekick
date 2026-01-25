/**
 * Tests for Daemon State Descriptors
 *
 * Verifies the exported state descriptors have correct properties
 * and that default factories produce fresh objects.
 */

import { describe, expect, it } from 'vitest'
import { DaemonStatusDescriptor, TaskRegistryDescriptor } from '../state-descriptors.js'

describe('DaemonStatusDescriptor', () => {
  it('has correct filename', () => {
    expect(DaemonStatusDescriptor.filename).toBe('daemon-status.json')
  })

  it('has global scope', () => {
    expect(DaemonStatusDescriptor.scope).toBe('global')
  })

  it('has a default value factory', () => {
    expect(DaemonStatusDescriptor.defaultValue).toBeTypeOf('function')
  })

  it('default factory returns valid DaemonStatus shape', () => {
    const factory = DaemonStatusDescriptor.defaultValue as () => unknown
    const defaultValue = factory()

    expect(defaultValue).toEqual({
      timestamp: 0,
      pid: 0,
      version: '',
      uptimeSeconds: 0,
      memory: { heapUsed: 0, heapTotal: 0, rss: 0 },
      queue: { pending: 0, active: 0 },
      activeTasks: [],
    })
  })

  it('default factory returns fresh objects each call', () => {
    const factory = DaemonStatusDescriptor.defaultValue as () => unknown
    const first = factory()
    const second = factory()

    expect(first).not.toBe(second)
    expect(first).toEqual(second)
  })
})

describe('TaskRegistryDescriptor', () => {
  it('has correct filename', () => {
    expect(TaskRegistryDescriptor.filename).toBe('task-registry.json')
  })

  it('has global scope', () => {
    expect(TaskRegistryDescriptor.scope).toBe('global')
  })

  it('has a default value factory', () => {
    expect(TaskRegistryDescriptor.defaultValue).toBeTypeOf('function')
  })

  it('default factory returns valid TaskRegistryState shape', () => {
    const factory = TaskRegistryDescriptor.defaultValue as () => unknown
    const defaultValue = factory()

    expect(defaultValue).toEqual({ activeTasks: [] })
  })

  it('default factory returns fresh objects each call', () => {
    const factory = TaskRegistryDescriptor.defaultValue as () => unknown
    const first = factory()
    const second = factory()

    expect(first).not.toBe(second)
    expect(first).toEqual(second)
  })
})
