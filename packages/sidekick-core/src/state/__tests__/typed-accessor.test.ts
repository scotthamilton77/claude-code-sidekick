/**
 * Tests for Typed State Accessors.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { MockStateService } from '@sidekick/testing-fixtures'
import { SessionStateAccessor, GlobalStateAccessor } from '../typed-accessor.js'
import { sessionState, globalState } from '../state-descriptor.js'

// ============================================================================
// Test Schemas and Descriptors
// ============================================================================

const TestDataSchema = z.object({
  id: z.string(),
  value: z.number(),
})
type TestData = z.infer<typeof TestDataSchema>

const DEFAULT_TEST_DATA: TestData = { id: 'default', value: 0 }

// Session-scoped descriptors
const SessionDescriptorWithNull = sessionState('test-session.json', TestDataSchema, null)
const SessionDescriptorWithDefault = sessionState('test-with-default.json', TestDataSchema, DEFAULT_TEST_DATA)
const SessionDescriptorNoDefault = sessionState('test-no-default.json', TestDataSchema)

// Global-scoped descriptors
const GlobalDescriptorWithNull = globalState('test-global.json', TestDataSchema, null)
const GlobalDescriptorWithDefault = globalState('test-global-default.json', TestDataSchema, DEFAULT_TEST_DATA)
const GlobalDescriptorNoDefault = globalState('test-global-no-default.json', TestDataSchema)

// ============================================================================
// SessionStateAccessor Tests
// ============================================================================

describe('SessionStateAccessor', () => {
  let mockStateService: MockStateService
  const sessionId = 'test-session-123'

  beforeEach(() => {
    mockStateService = new MockStateService('/test/project')
  })

  describe('constructor', () => {
    it('creates accessor for session-scoped descriptor', () => {
      const accessor = new SessionStateAccessor(mockStateService, SessionDescriptorWithNull)
      expect(accessor).toBeInstanceOf(SessionStateAccessor)
    })

    it('throws for global-scoped descriptor', () => {
      expect(() => {
        new SessionStateAccessor(mockStateService, GlobalDescriptorWithNull as any)
      }).toThrow('SessionStateAccessor requires a session-scoped descriptor')
    })
  })

  describe('getPath', () => {
    it('returns correct session state path', () => {
      const accessor = new SessionStateAccessor(mockStateService, SessionDescriptorWithNull)
      const path = accessor.getPath(sessionId)
      expect(path).toBe('/test/project/.sidekick/sessions/test-session-123/state/test-session.json')
    })
  })

  describe('read', () => {
    it('returns fresh data when file exists', async () => {
      const accessor = new SessionStateAccessor(mockStateService, SessionDescriptorWithNull)
      const testData: TestData = { id: 'test-1', value: 42 }

      // Set up test data
      const path = accessor.getPath(sessionId)
      mockStateService.setStored(path, testData)

      const result = await accessor.read(sessionId)

      expect(result.source).toBe('fresh')
      expect(result.data).toEqual(testData)
    })

    it('returns null default when file missing and default is null', async () => {
      const accessor = new SessionStateAccessor(mockStateService, SessionDescriptorWithNull)

      const result = await accessor.read(sessionId)

      expect(result.source).toBe('default')
      expect(result.data).toBeNull()
    })

    it('returns typed default when file missing and default is provided', async () => {
      const accessor = new SessionStateAccessor(mockStateService, SessionDescriptorWithDefault)

      const result = await accessor.read(sessionId)

      expect(result.source).toBe('default')
      expect(result.data).toEqual(DEFAULT_TEST_DATA)
    })

    it('throws when file missing and no default provided', async () => {
      const accessor = new SessionStateAccessor(mockStateService, SessionDescriptorNoDefault)

      await expect(accessor.read(sessionId)).rejects.toThrow('StateNotFoundError')
    })

    it('returns recovered with default when file is corrupt', async () => {
      const accessor = new SessionStateAccessor(mockStateService, SessionDescriptorWithDefault)
      const path = accessor.getPath(sessionId)

      // Set up invalid data
      mockStateService.setStored(path, { invalid: 'data' })

      const result = await accessor.read(sessionId)

      expect(result.source).toBe('recovered')
      expect(result.data).toEqual(DEFAULT_TEST_DATA)
    })
  })

  describe('write', () => {
    it('writes data to correct path', async () => {
      const accessor = new SessionStateAccessor(mockStateService, SessionDescriptorWithNull)
      const testData: TestData = { id: 'write-test', value: 100 }

      await accessor.write(sessionId, testData)

      const path = accessor.getPath(sessionId)
      expect(mockStateService.getStored(path)).toEqual(testData)
    })

    it('overwrites existing data', async () => {
      const accessor = new SessionStateAccessor(mockStateService, SessionDescriptorWithNull)
      const path = accessor.getPath(sessionId)

      // Write initial data
      mockStateService.setStored(path, { id: 'old', value: 1 })

      // Overwrite
      const newData: TestData = { id: 'new', value: 999 }
      await accessor.write(sessionId, newData)

      expect(mockStateService.getStored(path)).toEqual(newData)
    })

    it('throws for invalid data', async () => {
      const accessor = new SessionStateAccessor(mockStateService, SessionDescriptorWithNull)

      await expect(accessor.write(sessionId, { invalid: 'data' } as any)).rejects.toThrow()
    })
  })

  describe('delete', () => {
    it('deletes existing file', async () => {
      const accessor = new SessionStateAccessor(mockStateService, SessionDescriptorWithNull)
      const path = accessor.getPath(sessionId)

      // Set up data
      mockStateService.setStored(path, { id: 'to-delete', value: 1 })
      expect(mockStateService.has(path)).toBe(true)

      await accessor.delete(sessionId)

      expect(mockStateService.has(path)).toBe(false)
    })

    it('succeeds when file does not exist', async () => {
      const accessor = new SessionStateAccessor(mockStateService, SessionDescriptorWithNull)

      // Should not throw
      await expect(accessor.delete(sessionId)).resolves.toBeUndefined()
    })
  })
})

// ============================================================================
// GlobalStateAccessor Tests
// ============================================================================

describe('GlobalStateAccessor', () => {
  let mockStateService: MockStateService

  beforeEach(() => {
    mockStateService = new MockStateService('/test/project')
  })

  describe('constructor', () => {
    it('creates accessor for global-scoped descriptor', () => {
      const accessor = new GlobalStateAccessor(mockStateService, GlobalDescriptorWithNull)
      expect(accessor).toBeInstanceOf(GlobalStateAccessor)
    })

    it('throws for session-scoped descriptor', () => {
      expect(() => {
        new GlobalStateAccessor(mockStateService, SessionDescriptorWithNull as any)
      }).toThrow('GlobalStateAccessor requires a global-scoped descriptor')
    })
  })

  describe('getPath', () => {
    it('returns correct global state path', () => {
      const accessor = new GlobalStateAccessor(mockStateService, GlobalDescriptorWithNull)
      const path = accessor.getPath()
      expect(path).toBe('/test/project/.sidekick/state/test-global.json')
    })
  })

  describe('read', () => {
    it('returns fresh data when file exists', async () => {
      const accessor = new GlobalStateAccessor(mockStateService, GlobalDescriptorWithNull)
      const testData: TestData = { id: 'global-1', value: 77 }

      // Set up test data
      const path = accessor.getPath()
      mockStateService.setStored(path, testData)

      const result = await accessor.read()

      expect(result.source).toBe('fresh')
      expect(result.data).toEqual(testData)
    })

    it('returns null default when file missing and default is null', async () => {
      const accessor = new GlobalStateAccessor(mockStateService, GlobalDescriptorWithNull)

      const result = await accessor.read()

      expect(result.source).toBe('default')
      expect(result.data).toBeNull()
    })

    it('returns typed default when file missing and default is provided', async () => {
      const accessor = new GlobalStateAccessor(mockStateService, GlobalDescriptorWithDefault)

      const result = await accessor.read()

      expect(result.source).toBe('default')
      expect(result.data).toEqual(DEFAULT_TEST_DATA)
    })

    it('throws when file missing and no default provided', async () => {
      const accessor = new GlobalStateAccessor(mockStateService, GlobalDescriptorNoDefault)

      await expect(accessor.read()).rejects.toThrow('StateNotFoundError')
    })

    it('returns recovered with default when file is corrupt', async () => {
      const accessor = new GlobalStateAccessor(mockStateService, GlobalDescriptorWithDefault)
      const path = accessor.getPath()

      // Set up invalid data
      mockStateService.setStored(path, { bad: 'schema' })

      const result = await accessor.read()

      expect(result.source).toBe('recovered')
      expect(result.data).toEqual(DEFAULT_TEST_DATA)
    })
  })

  describe('write', () => {
    it('writes data to correct path', async () => {
      const accessor = new GlobalStateAccessor(mockStateService, GlobalDescriptorWithNull)
      const testData: TestData = { id: 'global-write', value: 200 }

      await accessor.write(testData)

      const path = accessor.getPath()
      expect(mockStateService.getStored(path)).toEqual(testData)
    })

    it('overwrites existing data', async () => {
      const accessor = new GlobalStateAccessor(mockStateService, GlobalDescriptorWithNull)
      const path = accessor.getPath()

      // Write initial data
      mockStateService.setStored(path, { id: 'old-global', value: 1 })

      // Overwrite
      const newData: TestData = { id: 'new-global', value: 888 }
      await accessor.write(newData)

      expect(mockStateService.getStored(path)).toEqual(newData)
    })

    it('throws for invalid data', async () => {
      const accessor = new GlobalStateAccessor(mockStateService, GlobalDescriptorWithNull)

      await expect(accessor.write({ wrong: 'shape' } as any)).rejects.toThrow()
    })
  })

  describe('delete', () => {
    it('deletes existing file', async () => {
      const accessor = new GlobalStateAccessor(mockStateService, GlobalDescriptorWithNull)
      const path = accessor.getPath()

      // Set up data
      mockStateService.setStored(path, { id: 'global-delete', value: 1 })
      expect(mockStateService.has(path)).toBe(true)

      await accessor.delete()

      expect(mockStateService.has(path)).toBe(false)
    })

    it('succeeds when file does not exist', async () => {
      const accessor = new GlobalStateAccessor(mockStateService, GlobalDescriptorWithNull)

      // Should not throw
      await expect(accessor.delete()).resolves.toBeUndefined()
    })
  })
})
