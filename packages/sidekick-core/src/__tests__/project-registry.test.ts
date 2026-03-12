import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import {
  encodeProjectDir,
  decodeProjectDir,
  ProjectRegistryService,
} from '../project-registry.js'

// --- Encoding/Decoding ---

describe('encodeProjectDir', () => {
  it('replaces slashes with dashes', () => {
    expect(encodeProjectDir('/Users/scott/src/project')).toBe('-Users-scott-src-project')
  })

  it('handles root path', () => {
    expect(encodeProjectDir('/')).toBe('-')
  })
})

describe('decodeProjectDir', () => {
  it('restores slashes from dashes', () => {
    expect(decodeProjectDir('-Users-scott-src-project')).toBe('/Users/scott/src/project')
  })

  it('handles root path', () => {
    expect(decodeProjectDir('-')).toBe('/')
  })

  it('roundtrips with encodeProjectDir for paths without dashes', () => {
    const original = '/Users/scott/src/projects/myproject'
    expect(decodeProjectDir(encodeProjectDir(original))).toBe(original)
  })
})

// --- ProjectRegistryService ---

function createTestDir(): string {
  const dir = join(tmpdir(), `test-registry-${randomBytes(8).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('ProjectRegistryService', () => {
  let registryRoot: string
  let service: ProjectRegistryService

  beforeEach(() => {
    registryRoot = createTestDir()
    service = new ProjectRegistryService(registryRoot)
  })

  afterEach(() => {
    if (existsSync(registryRoot)) {
      rmSync(registryRoot, { recursive: true })
    }
  })

  describe('register()', () => {
    it('creates registry entry for a project', async () => {
      const projectDir = '/Users/scott/src/my-project'
      await service.register(projectDir)

      const entryDir = join(registryRoot, '-Users-scott-src-my-project')
      const entryFile = join(entryDir, 'registry.json')
      expect(existsSync(entryFile)).toBe(true)

      const entry = JSON.parse(readFileSync(entryFile, 'utf-8'))
      expect(entry.path).toBe(projectDir)
      expect(entry.displayName).toBe('my-project')
      expect(entry.lastActive).toBeDefined()
    })

    it('updates lastActive on re-registration', async () => {
      const projectDir = '/Users/scott/src/my-project'
      await service.register(projectDir)

      const entryFile = join(registryRoot, '-Users-scott-src-my-project', 'registry.json')
      const first = JSON.parse(readFileSync(entryFile, 'utf-8'))

      // Small delay to ensure different timestamp
      await new Promise(r => setTimeout(r, 10))
      await service.register(projectDir)

      const second = JSON.parse(readFileSync(entryFile, 'utf-8'))
      expect(new Date(second.lastActive).getTime()).toBeGreaterThanOrEqual(
        new Date(first.lastActive).getTime()
      )
    })
  })

  describe('list()', () => {
    it('returns empty array when no projects registered', async () => {
      const entries = await service.list()
      expect(entries).toEqual([])
    })

    it('returns all registered projects', async () => {
      await service.register('/Users/scott/project-a')
      await service.register('/Users/scott/project-b')

      const entries = await service.list()
      expect(entries).toHaveLength(2)
      expect(entries.map(e => e.displayName).sort()).toEqual(['project-a', 'project-b'])
    })

    it('skips directories without registry.json', async () => {
      mkdirSync(join(registryRoot, '-Users-scott-orphan'), { recursive: true })
      const entries = await service.list()
      expect(entries).toEqual([])
    })

    it('skips entries with invalid JSON', async () => {
      const badDir = join(registryRoot, '-Users-scott-bad')
      mkdirSync(badDir, { recursive: true })
      writeFileSync(join(badDir, 'registry.json'), 'not json')

      const entries = await service.list()
      expect(entries).toEqual([])
    })
  })

  describe('prune()', () => {
    it('removes entries whose path no longer exists', async () => {
      // Register a non-existent project path
      const fakePath = join(tmpdir(), `nonexistent-${randomBytes(4).toString('hex')}`)
      await service.register(fakePath)

      const before = await service.list()
      expect(before).toHaveLength(1)

      const pruned = await service.prune({ retentionDays: 30 })
      expect(pruned).toHaveLength(1)
      expect(pruned[0].reason).toBe('path-missing')

      const after = await service.list()
      expect(after).toEqual([])
    })

    it('removes entries older than retentionDays', async () => {
      // Create a real directory so path-exists check passes
      const realDir = createTestDir()
      await service.register(realDir)

      // Backdate the entry to 60 days ago
      const encoded = encodeProjectDir(realDir)
      const entryFile = join(registryRoot, encoded, 'registry.json')
      const entry = JSON.parse(readFileSync(entryFile, 'utf-8'))
      entry.lastActive = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
      writeFileSync(entryFile, JSON.stringify(entry))

      const pruned = await service.prune({ retentionDays: 30 })
      expect(pruned).toHaveLength(1)
      expect(pruned[0].reason).toBe('age-exceeded')

      rmSync(realDir, { recursive: true })
    })

    it('keeps fresh entries with valid paths', async () => {
      const realDir = createTestDir()
      await service.register(realDir)

      const pruned = await service.prune({ retentionDays: 30 })
      expect(pruned).toEqual([])

      const entries = await service.list()
      expect(entries).toHaveLength(1)

      rmSync(realDir, { recursive: true })
    })
  })
})
