// packages/sidekick-core/src/__tests__/gitignore.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import {
  installGitignoreSection,
  removeGitignoreSection,
  detectGitignoreStatus,
  SIDEKICK_SECTION_START,
  SIDEKICK_SECTION_END,
  GITIGNORE_ENTRIES,
} from '../gitignore'

describe('gitignore utilities', () => {
  const testDir = path.join(__dirname, 'gitignore-test-tmp')

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('installGitignoreSection', () => {
    it('creates .gitignore if it does not exist', async () => {
      const result = await installGitignoreSection(testDir)

      expect(result.status).toBe('installed')
      expect(result.entriesAdded).toEqual(GITIGNORE_ENTRIES)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf-8')
      expect(content).toContain(SIDEKICK_SECTION_START)
      expect(content).toContain(SIDEKICK_SECTION_END)
      expect(content).toContain('.sidekick/logs/')
    })

    it('appends to existing .gitignore', async () => {
      const gitignorePath = path.join(testDir, '.gitignore')
      writeFileSync(gitignorePath, 'node_modules/\n.env\n')

      const result = await installGitignoreSection(testDir)

      expect(result.status).toBe('installed')

      const content = readFileSync(gitignorePath, 'utf-8')
      expect(content).toContain('node_modules/')
      expect(content).toContain('.env')
      expect(content).toContain(SIDEKICK_SECTION_START)
      expect(content).toContain('.sidekick/logs/')
    })

    it('returns already-installed if section exists', async () => {
      const gitignorePath = path.join(testDir, '.gitignore')
      writeFileSync(
        gitignorePath,
        `node_modules/\n${SIDEKICK_SECTION_START}\n.sidekick/logs/\n${SIDEKICK_SECTION_END}\n`
      )

      const result = await installGitignoreSection(testDir)

      expect(result.status).toBe('already-installed')
    })

    it('is idempotent - multiple calls do not duplicate section', async () => {
      await installGitignoreSection(testDir)
      await installGitignoreSection(testDir)

      const content = readFileSync(path.join(testDir, '.gitignore'), 'utf-8')
      const startCount = (content.match(new RegExp(SIDEKICK_SECTION_START, 'g')) || []).length
      expect(startCount).toBe(1)
    })
  })

  describe('removeGitignoreSection', () => {
    it('removes the sidekick section', async () => {
      const gitignorePath = path.join(testDir, '.gitignore')
      writeFileSync(
        gitignorePath,
        `node_modules/\n\n${SIDEKICK_SECTION_START}\n.sidekick/logs/\n${SIDEKICK_SECTION_END}\n.env\n`
      )

      const result = await removeGitignoreSection(testDir)

      expect(result).toBe(true)

      const content = readFileSync(gitignorePath, 'utf-8')
      expect(content).not.toContain(SIDEKICK_SECTION_START)
      expect(content).not.toContain('.sidekick/logs/')
      expect(content).toContain('node_modules/')
      expect(content).toContain('.env')
    })

    it('returns false if section not found', async () => {
      const gitignorePath = path.join(testDir, '.gitignore')
      writeFileSync(gitignorePath, 'node_modules/\n')

      const result = await removeGitignoreSection(testDir)

      expect(result).toBe(false)
    })

    it('returns false if file does not exist', async () => {
      const result = await removeGitignoreSection(testDir)
      expect(result).toBe(false)
    })

    it('returns false if markers are malformed (end before start)', async () => {
      const gitignorePath = path.join(testDir, '.gitignore')
      // Write malformed content with end marker before start marker
      writeFileSync(
        gitignorePath,
        `node_modules/\n${SIDEKICK_SECTION_END}\n.sidekick/logs/\n${SIDEKICK_SECTION_START}\n`
      )

      const result = await removeGitignoreSection(testDir)

      expect(result).toBe(false)
      // File should be unchanged
      const content = readFileSync(gitignorePath, 'utf-8')
      expect(content).toContain(SIDEKICK_SECTION_START)
      expect(content).toContain(SIDEKICK_SECTION_END)
    })
  })

  describe('detectGitignoreStatus', () => {
    it('returns installed when section is present', async () => {
      const gitignorePath = path.join(testDir, '.gitignore')
      writeFileSync(gitignorePath, `${SIDEKICK_SECTION_START}\n.sidekick/logs/\n${SIDEKICK_SECTION_END}\n`)

      const status = await detectGitignoreStatus(testDir)
      expect(status).toBe('installed')
    })

    it('returns missing when section is not present', async () => {
      const gitignorePath = path.join(testDir, '.gitignore')
      writeFileSync(gitignorePath, 'node_modules/\n')

      const status = await detectGitignoreStatus(testDir)
      expect(status).toBe('missing')
    })

    it('returns missing when file does not exist', async () => {
      const status = await detectGitignoreStatus(testDir)
      expect(status).toBe('missing')
    })
  })

  describe('section format', () => {
    it('uses correct markers', () => {
      expect(SIDEKICK_SECTION_START).toBe('# >>> sidekick')
      expect(SIDEKICK_SECTION_END).toBe('# <<< sidekick')
    })

    it('includes expected entries', () => {
      expect(GITIGNORE_ENTRIES).toContain('.sidekick/logs/')
      expect(GITIGNORE_ENTRIES).toContain('.sidekick/sessions/')
      expect(GITIGNORE_ENTRIES).toContain('.sidekick/state/')
      expect(GITIGNORE_ENTRIES).toContain('.sidekick/.env')
      expect(GITIGNORE_ENTRIES).toContain('.sidekick/.env.local')
    })
  })
})
