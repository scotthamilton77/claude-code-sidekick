// packages/sidekick-core/src/__tests__/gitignore.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import {
  installGitignoreSection,
  removeGitignoreSection,
  detectGitignoreStatus,
  detectLegacyGitignoreSection,
  removeLegacyGitignoreSection,
  SIDEKICK_SECTION_START,
  SIDEKICK_SECTION_END,
  SIDEKICK_GITIGNORE_HEADER,
  GITIGNORE_ENTRIES,
} from '../gitignore'

describe('gitignore utilities', () => {
  const testDir = path.join(__dirname, 'gitignore-test-tmp')
  const sidekickDir = path.join(testDir, '.sidekick')
  const sidekickGitignore = path.join(sidekickDir, '.gitignore')
  const rootGitignore = path.join(testDir, '.gitignore')

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('installGitignoreSection', () => {
    it('creates .sidekick/.gitignore with header and all entries', async () => {
      const result = await installGitignoreSection(testDir)

      expect(result.status).toBe('installed')
      expect(result.entriesAdded).toEqual(GITIGNORE_ENTRIES)

      const content = readFileSync(sidekickGitignore, 'utf-8')
      expect(content).toContain(SIDEKICK_GITIGNORE_HEADER)
      for (const entry of GITIGNORE_ENTRIES) {
        expect(content).toContain(entry)
      }
    })

    it('creates .sidekick/ directory if it does not exist', async () => {
      expect(existsSync(sidekickDir)).toBe(false)

      await installGitignoreSection(testDir)

      expect(existsSync(sidekickDir)).toBe(true)
      expect(existsSync(sidekickGitignore)).toBe(true)
    })

    it('does NOT touch root .gitignore', async () => {
      writeFileSync(rootGitignore, 'node_modules/\n')

      await installGitignoreSection(testDir)

      expect(readFileSync(rootGitignore, 'utf-8')).toBe('node_modules/\n')
    })

    it('does NOT create root .gitignore when none exists', async () => {
      await installGitignoreSection(testDir)

      expect(existsSync(rootGitignore)).toBe(false)
    })

    it('returns already-installed when all entries are present', async () => {
      await installGitignoreSection(testDir)

      const result = await installGitignoreSection(testDir)

      expect(result.status).toBe('already-installed')
    })

    it('repairs incomplete .sidekick/.gitignore by overwriting', async () => {
      mkdirSync(sidekickDir, { recursive: true })
      writeFileSync(sidekickGitignore, '# partial\nlogs/\n')

      const result = await installGitignoreSection(testDir)

      expect(result.status).toBe('installed')
      const content = readFileSync(sidekickGitignore, 'utf-8')
      for (const entry of GITIGNORE_ENTRIES) {
        expect(content).toContain(entry)
      }
    })

    it('is idempotent — entries appear exactly once', async () => {
      await installGitignoreSection(testDir)
      await installGitignoreSection(testDir)

      const lines = readFileSync(sidekickGitignore, 'utf-8').split('\n')
      for (const entry of GITIGNORE_ENTRIES) {
        expect(lines.filter((line) => line === entry).length).toBe(1)
      }
    })
  })

  describe('detectGitignoreStatus', () => {
    it('returns installed when .sidekick/.gitignore has all entries', async () => {
      await installGitignoreSection(testDir)

      expect(await detectGitignoreStatus(testDir)).toBe('installed')
    })

    it('returns incomplete when .sidekick/.gitignore exists but missing entries', async () => {
      mkdirSync(sidekickDir, { recursive: true })
      writeFileSync(sidekickGitignore, 'logs/\nsessions/\n') // missing 7 entries

      expect(await detectGitignoreStatus(testDir)).toBe('incomplete')
    })

    it('returns legacy when root .gitignore has sidekick markers, no .sidekick/.gitignore', async () => {
      const legacy = `node_modules/\n${SIDEKICK_SECTION_START}\n.sidekick/logs/\n${SIDEKICK_SECTION_END}\n`
      writeFileSync(rootGitignore, legacy)

      expect(await detectGitignoreStatus(testDir)).toBe('legacy')
    })

    it('returns missing when neither format present', async () => {
      expect(await detectGitignoreStatus(testDir)).toBe('missing')
    })

    it('returns missing when root .gitignore exists without sidekick section', async () => {
      writeFileSync(rootGitignore, 'node_modules/\n.env\n')

      expect(await detectGitignoreStatus(testDir)).toBe('missing')
    })

    it('returns installed when both formats present (new format takes precedence)', async () => {
      await installGitignoreSection(testDir)
      writeFileSync(rootGitignore, `${SIDEKICK_SECTION_START}\n.sidekick/logs/\n${SIDEKICK_SECTION_END}\n`)

      expect(await detectGitignoreStatus(testDir)).toBe('installed')
    })
  })

  describe('detectLegacyGitignoreSection', () => {
    it('returns true when root .gitignore contains sidekick start marker', async () => {
      writeFileSync(
        rootGitignore,
        `node_modules/\n${SIDEKICK_SECTION_START}\n.sidekick/logs/\n${SIDEKICK_SECTION_END}\n`
      )

      expect(await detectLegacyGitignoreSection(testDir)).toBe(true)
    })

    it('returns false when root .gitignore has no sidekick marker', async () => {
      writeFileSync(rootGitignore, 'node_modules/\n')

      expect(await detectLegacyGitignoreSection(testDir)).toBe(false)
    })

    it('returns false when root .gitignore does not exist', async () => {
      expect(await detectLegacyGitignoreSection(testDir)).toBe(false)
    })
  })

  describe('removeLegacyGitignoreSection', () => {
    it('removes sidekick section and preserves surrounding content', async () => {
      writeFileSync(
        rootGitignore,
        `node_modules/\n\n${SIDEKICK_SECTION_START}\n.sidekick/logs/\n${SIDEKICK_SECTION_END}\n.env\n`
      )

      const result = await removeLegacyGitignoreSection(testDir)

      expect(result).toBe(true)
      const content = readFileSync(rootGitignore, 'utf-8')
      expect(content).not.toContain(SIDEKICK_SECTION_START)
      expect(content).not.toContain(SIDEKICK_SECTION_END)
      expect(content).toContain('node_modules/')
      expect(content).toContain('.env')
    })

    it('returns false when section is not present', async () => {
      writeFileSync(rootGitignore, 'node_modules/\n')

      expect(await removeLegacyGitignoreSection(testDir)).toBe(false)
    })

    it('returns false when root .gitignore does not exist', async () => {
      expect(await removeLegacyGitignoreSection(testDir)).toBe(false)
    })

    it('returns false when markers are malformed (end before start)', async () => {
      writeFileSync(rootGitignore, `${SIDEKICK_SECTION_END}\n.sidekick/logs/\n${SIDEKICK_SECTION_START}\n`)

      expect(await removeLegacyGitignoreSection(testDir)).toBe(false)
      // File unchanged
      const content = readFileSync(rootGitignore, 'utf-8')
      expect(content).toContain(SIDEKICK_SECTION_START)
    })
  })

  describe('removeGitignoreSection', () => {
    it('deletes .sidekick/.gitignore', async () => {
      await installGitignoreSection(testDir)

      const result = await removeGitignoreSection(testDir)

      expect(result).toBe(true)
      expect(existsSync(sidekickGitignore)).toBe(false)
    })

    it('removes legacy root section when only legacy format present', async () => {
      writeFileSync(
        rootGitignore,
        `node_modules/\n${SIDEKICK_SECTION_START}\n.sidekick/logs/\n${SIDEKICK_SECTION_END}\n`
      )

      const result = await removeGitignoreSection(testDir)

      expect(result).toBe(true)
      expect(readFileSync(rootGitignore, 'utf-8')).not.toContain(SIDEKICK_SECTION_START)
    })

    it('removes both formats when both present', async () => {
      await installGitignoreSection(testDir)
      writeFileSync(rootGitignore, `${SIDEKICK_SECTION_START}\n.sidekick/logs/\n${SIDEKICK_SECTION_END}\n`)

      const result = await removeGitignoreSection(testDir)

      expect(result).toBe(true)
      expect(existsSync(sidekickGitignore)).toBe(false)
      expect(readFileSync(rootGitignore, 'utf-8')).not.toContain(SIDEKICK_SECTION_START)
    })

    it('returns false when neither format present', async () => {
      expect(await removeGitignoreSection(testDir)).toBe(false)
    })
  })

  describe('constants', () => {
    it('GITIGNORE_ENTRIES uses relative paths (no .sidekick/ prefix)', () => {
      for (const entry of GITIGNORE_ENTRIES) {
        expect(entry).not.toMatch(/^\.sidekick\//)
      }
    })

    it('includes all expected entries', () => {
      expect(GITIGNORE_ENTRIES).toContain('logs/')
      expect(GITIGNORE_ENTRIES).toContain('sessions/')
      expect(GITIGNORE_ENTRIES).toContain('state/')
      expect(GITIGNORE_ENTRIES).toContain('setup-status.json')
      expect(GITIGNORE_ENTRIES).toContain('.env')
      expect(GITIGNORE_ENTRIES).toContain('.env.local')
      expect(GITIGNORE_ENTRIES).toContain('sidekick*.pid')
      expect(GITIGNORE_ENTRIES).toContain('sidekick*.token')
      expect(GITIGNORE_ENTRIES).toContain('*.local.yaml')
    })

    it('SIDEKICK_GITIGNORE_HEADER is a comment line', () => {
      expect(SIDEKICK_GITIGNORE_HEADER).toMatch(/^#/)
    })
  })
})
