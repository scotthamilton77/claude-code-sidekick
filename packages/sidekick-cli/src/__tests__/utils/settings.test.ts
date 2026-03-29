/**
 * Tests for shared settings file utilities.
 */
import { describe, test, expect, afterEach } from 'vitest'
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { readSettingsFile, writeSettingsFile } from '../../utils/settings.js'
import { fileExists } from '../../utils/fs.js'

const TEST_DIR = `/tmp/claude/utils-settings-test-${Date.now()}`

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('readSettingsFile', () => {
  test('returns parsed JSON for valid settings file', async () => {
    await mkdir(TEST_DIR, { recursive: true })
    const filePath = path.join(TEST_DIR, 'settings.json')
    await writeFile(filePath, JSON.stringify({ foo: 'bar', num: 42 }))

    const result = await readSettingsFile(filePath)

    expect(result).toEqual({ foo: 'bar', num: 42 })
  })

  test('returns empty object for non-existent file', async () => {
    const result = await readSettingsFile(path.join(TEST_DIR, 'nope.json'))

    expect(result).toEqual({})
  })

  test('returns empty object for invalid JSON', async () => {
    await mkdir(TEST_DIR, { recursive: true })
    const filePath = path.join(TEST_DIR, 'bad.json')
    await writeFile(filePath, 'not valid json {{{')

    const result = await readSettingsFile(filePath)

    expect(result).toEqual({})
  })

  test('throws on non-ENOENT filesystem errors (e.g. EISDIR)', async () => {
    await mkdir(TEST_DIR, { recursive: true })
    // Attempting to read a directory as a file triggers EISDIR
    await expect(readSettingsFile(TEST_DIR)).rejects.toThrow()
  })

  test('supports generic type parameter', async () => {
    await mkdir(TEST_DIR, { recursive: true })
    const filePath = path.join(TEST_DIR, 'typed.json')
    await writeFile(filePath, JSON.stringify({ statusLine: { type: 'command', command: 'foo' } }))

    interface Settings extends Record<string, unknown> {
      statusLine?: { type: string; command: string }
    }
    const result = await readSettingsFile<Settings>(filePath)

    expect(result.statusLine?.command).toBe('foo')
  })
})

describe('writeSettingsFile', () => {
  test('writes JSON with 2-space indent and trailing newline', async () => {
    await mkdir(TEST_DIR, { recursive: true })
    const filePath = path.join(TEST_DIR, 'out.json')

    await writeSettingsFile(filePath, { hello: 'world' })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toBe('{\n  "hello": "world"\n}\n')
  })

  test('creates parent directories if needed', async () => {
    const filePath = path.join(TEST_DIR, 'deep', 'nested', 'settings.json')

    await writeSettingsFile(filePath, { created: true })

    expect(await fileExists(filePath)).toBe(true)
  })

  test('returns "written" when file is written', async () => {
    await mkdir(TEST_DIR, { recursive: true })
    const filePath = path.join(TEST_DIR, 'written.json')

    const result = await writeSettingsFile(filePath, { data: true })

    expect(result).toBe('written')
  })

  test('deletes file when settings object is empty', async () => {
    await mkdir(TEST_DIR, { recursive: true })
    const filePath = path.join(TEST_DIR, 'to-delete.json')
    await writeFile(filePath, '{"old": "data"}')

    const result = await writeSettingsFile(filePath, {})

    expect(result).toBe('deleted')
    expect(await fileExists(filePath)).toBe(false)
  })

  test('returns "deleted" even when file does not exist', async () => {
    const filePath = path.join(TEST_DIR, 'already-gone.json')

    const result = await writeSettingsFile(filePath, {})

    expect(result).toBe('deleted')
  })
})
