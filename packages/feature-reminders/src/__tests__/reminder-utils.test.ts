/**
 * Tests for reminder utilities
 * @see docs/design/FEATURE-REMINDERS.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { interpolateTemplate, resolveReminder } from '../reminder-utils'

describe('reminder-utils', () => {
  describe('interpolateTemplate', () => {
    it('replaces single variable', () => {
      const result = interpolateTemplate('Used {{count}} tools', { count: 5 })
      expect(result).toBe('Used 5 tools')
    })

    it('replaces multiple variables', () => {
      const result = interpolateTemplate('Turn {{turn}}, tools {{tools}}', { turn: 3, tools: 10 })
      expect(result).toBe('Turn 3, tools 10')
    })

    it('preserves unmatched placeholders', () => {
      const result = interpolateTemplate('Value: {{missing}}', {})
      expect(result).toBe('Value: {{missing}}')
    })

    it('handles string values', () => {
      const result = interpolateTemplate('Name: {{name}}', { name: 'test' })
      expect(result).toBe('Name: test')
    })

    it('handles boolean values', () => {
      const result = interpolateTemplate('Active: {{active}}', { active: true })
      expect(result).toBe('Active: true')
    })

    it('handles number zero', () => {
      const result = interpolateTemplate('Count: {{count}}', { count: 0 })
      expect(result).toBe('Count: 0')
    })

    it('does not replace null values', () => {
      const result = interpolateTemplate('Value: {{value}}', { value: null })
      expect(result).toBe('Value: {{value}}')
    })

    it('does not replace undefined values', () => {
      const result = interpolateTemplate('Value: {{value}}', { value: undefined })
      expect(result).toBe('Value: {{value}}')
    })

    it('handles multiple occurrences of same variable', () => {
      const result = interpolateTemplate('{{x}} plus {{x}} equals {{y}}', { x: 2, y: 4 })
      expect(result).toBe('2 plus 2 equals 4')
    })
  })

  describe('resolveReminder', () => {
    // Using /tmp/claude/ for sandbox compatibility
    const testAssetsDir = '/tmp/claude/test-assets-reminders'

    beforeEach(() => {
      mkdirSync(join(testAssetsDir, 'reminders'), { recursive: true })
    })

    afterEach(() => {
      rmSync(testAssetsDir, { recursive: true, force: true })
    })

    it('returns null for non-existent reminder', () => {
      const result = resolveReminder('nonexistent', {}, testAssetsDir)
      expect(result).toBeNull()
    })

    it('loads and parses YAML reminder definition', () => {
      const yamlContent = `id: test-reminder
blocking: true
priority: 80
persistent: false
additionalContext: "Test context"
`
      writeFileSync(join(testAssetsDir, 'reminders', 'test-reminder.yaml'), yamlContent)

      const result = resolveReminder('test-reminder', {}, testAssetsDir)
      expect(result).toEqual({
        name: 'test-reminder',
        blocking: true,
        priority: 80,
        persistent: false,
        additionalContext: 'Test context',
        userMessage: undefined,
        reason: undefined,
      })
    })

    it('interpolates template variables in content fields', () => {
      const yamlContent = `id: pause-and-reflect
blocking: true
priority: 80
persistent: false
additionalContext: "Used {{toolsThisTurn}} tools"
reason: "Checkpoint at {{toolsThisTurn}} tools"
`
      writeFileSync(join(testAssetsDir, 'reminders', 'pause-and-reflect.yaml'), yamlContent)

      const result = resolveReminder('pause-and-reflect', { toolsThisTurn: 25 }, testAssetsDir)
      expect(result?.additionalContext).toBe('Used 25 tools')
      expect(result?.reason).toBe('Checkpoint at 25 tools')
    })

    it('handles all optional fields', () => {
      const yamlContent = `id: full-reminder
blocking: false
priority: 50
persistent: true
userMessage: "User message with {{count}}"
additionalContext: "Additional context with {{count}}"
reason: "Stop reason with {{count}}"
`
      writeFileSync(join(testAssetsDir, 'reminders', 'full-reminder.yaml'), yamlContent)

      const result = resolveReminder('full-reminder', { count: 10 }, testAssetsDir)
      expect(result).toEqual({
        name: 'full-reminder',
        blocking: false,
        priority: 50,
        persistent: true,
        userMessage: 'User message with 10',
        additionalContext: 'Additional context with 10',
        reason: 'Stop reason with 10',
      })
    })

    it('handles minimal YAML definition', () => {
      const yamlContent = `id: minimal
blocking: true
priority: 60
persistent: false
`
      writeFileSync(join(testAssetsDir, 'reminders', 'minimal.yaml'), yamlContent)

      const result = resolveReminder('minimal', {}, testAssetsDir)
      expect(result).toEqual({
        name: 'minimal',
        blocking: true,
        priority: 60,
        persistent: false,
        userMessage: undefined,
        additionalContext: undefined,
        reason: undefined,
      })
    })

    it('returns null and logs error for malformed YAML', () => {
      const yamlContent = `this is not: valid: yaml: content:`
      writeFileSync(join(testAssetsDir, 'reminders', 'malformed.yaml'), yamlContent)

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = resolveReminder('malformed', {}, testAssetsDir)

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load reminder malformed'),
        expect.any(Error)
      )
      consoleSpy.mockRestore()
    })
  })
})
