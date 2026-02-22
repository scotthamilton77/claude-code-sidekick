import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  detectShell,
  isAliasInRcFile,
  installAlias,
  uninstallAlias,
  getAliasBlock,
} from '../commands/setup/shell-alias'
import * as fs from 'node:fs'

vi.mock('node:fs')

const mockReadFileSync = vi.mocked(fs.readFileSync)
const mockWriteFileSync = vi.mocked(fs.writeFileSync)

const MARKER_START = '# >>> sidekick alias >>>'
const MARKER_END = '# <<< sidekick alias <<<'

describe('shell-alias', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('detectShell', () => {
    it('returns zsh when SHELL ends with /zsh', () => {
      expect(detectShell('/bin/zsh')).toEqual({ shell: 'zsh', rcFile: '.zshrc' })
    })

    it('returns bash when SHELL ends with /bash', () => {
      expect(detectShell('/bin/bash')).toEqual({ shell: 'bash', rcFile: '.bashrc' })
    })

    it('returns null for unsupported shells', () => {
      expect(detectShell('/usr/bin/fish')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(detectShell('')).toBeNull()
    })

    it('returns null for undefined', () => {
      expect(detectShell(undefined)).toBeNull()
    })
  })

  describe('getAliasBlock', () => {
    it('returns the marker-bracketed alias block', () => {
      const block = getAliasBlock()
      expect(block).toContain(MARKER_START)
      expect(block).toContain("alias sidekick='npx @scotthamilton77/sidekick'")
      expect(block).toContain(MARKER_END)
    })
  })

  describe('isAliasInRcFile', () => {
    it('returns true when marker block is present', () => {
      const content = `# some config\n${MARKER_START}\nalias sidekick='npx @scotthamilton77/sidekick'\n${MARKER_END}\n`
      mockReadFileSync.mockReturnValue(content)
      expect(isAliasInRcFile('/home/user/.zshrc')).toBe(true)
    })

    it('returns false when marker block is absent', () => {
      mockReadFileSync.mockReturnValue('# some config\nexport PATH=...\n')
      expect(isAliasInRcFile('/home/user/.zshrc')).toBe(false)
    })

    it('returns false when file does not exist', () => {
      mockReadFileSync.mockImplementation(() => {
        throw Object.assign(new Error(), { code: 'ENOENT' })
      })
      expect(isAliasInRcFile('/home/user/.zshrc')).toBe(false)
    })
  })

  describe('installAlias', () => {
    it('appends alias block to existing rc file', () => {
      const existingContent = '# existing config\nexport PATH=/usr/bin\n'
      mockReadFileSync.mockReturnValue(existingContent)

      const result = installAlias('/home/user/.zshrc')

      expect(result).toBe('installed')
      expect(mockWriteFileSync).toHaveBeenCalledOnce()
      const written = mockWriteFileSync.mock.calls[0][1] as string
      expect(written).toContain(existingContent)
      expect(written).toContain(MARKER_START)
      expect(written).toContain(MARKER_END)
    })

    it('creates rc file if it does not exist', () => {
      mockReadFileSync.mockImplementation(() => {
        throw Object.assign(new Error(), { code: 'ENOENT' })
      })

      const result = installAlias('/home/user/.zshrc')

      expect(result).toBe('installed')
      expect(mockWriteFileSync).toHaveBeenCalledOnce()
      const written = mockWriteFileSync.mock.calls[0][1] as string
      expect(written).toContain(MARKER_START)
    })

    it('returns already-installed when marker block exists', () => {
      const content = `# config\n${MARKER_START}\nalias sidekick='npx @scotthamilton77/sidekick'\n${MARKER_END}\n`
      mockReadFileSync.mockReturnValue(content)

      const result = installAlias('/home/user/.zshrc')

      expect(result).toBe('already-installed')
      expect(mockWriteFileSync).not.toHaveBeenCalled()
    })
  })

  describe('uninstallAlias', () => {
    it('removes the marker block from rc file', () => {
      const before = `# before\n${MARKER_START}\nalias sidekick='npx @scotthamilton77/sidekick'\n${MARKER_END}\n# after\n`
      mockReadFileSync.mockReturnValue(before)

      const result = uninstallAlias('/home/user/.zshrc')

      expect(result).toBe('removed')
      const written = mockWriteFileSync.mock.calls[0][1] as string
      expect(written).toContain('# before')
      expect(written).toContain('# after')
      expect(written).not.toContain(MARKER_START)
      expect(written).not.toContain(MARKER_END)
    })

    it('returns not-found when marker block is absent', () => {
      mockReadFileSync.mockReturnValue('# config\n')

      const result = uninstallAlias('/home/user/.zshrc')

      expect(result).toBe('not-found')
      expect(mockWriteFileSync).not.toHaveBeenCalled()
    })

    it('returns not-found when file does not exist', () => {
      mockReadFileSync.mockImplementation(() => {
        throw Object.assign(new Error(), { code: 'ENOENT' })
      })

      const result = uninstallAlias('/home/user/.zshrc')

      expect(result).toBe('not-found')
    })
  })
})
