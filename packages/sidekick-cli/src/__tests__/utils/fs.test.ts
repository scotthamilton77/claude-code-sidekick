/**
 * Tests for shared filesystem utilities.
 */
import { describe, test, expect, afterEach } from 'vitest'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { fileExists, readFileOrNull } from '../../utils/fs.js'

const TEST_DIR = `/tmp/claude/utils-fs-test-${Date.now()}`

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('fileExists', () => {
  test('returns true for existing file', async () => {
    await mkdir(TEST_DIR, { recursive: true })
    const filePath = path.join(TEST_DIR, 'exists.txt')
    await writeFile(filePath, 'content')

    expect(await fileExists(filePath)).toBe(true)
  })

  test('returns false for non-existent file', async () => {
    expect(await fileExists(path.join(TEST_DIR, 'nope.txt'))).toBe(false)
  })

  test('returns true for existing directory', async () => {
    await mkdir(TEST_DIR, { recursive: true })

    expect(await fileExists(TEST_DIR)).toBe(true)
  })
})

describe('readFileOrNull', () => {
  test('returns file content for existing file', async () => {
    await mkdir(TEST_DIR, { recursive: true })
    const filePath = path.join(TEST_DIR, 'readable.txt')
    await writeFile(filePath, 'hello world')

    expect(await readFileOrNull(filePath)).toBe('hello world')
  })

  test('returns null for non-existent file', async () => {
    expect(await readFileOrNull(path.join(TEST_DIR, 'missing.txt'))).toBeNull()
  })

  test('returns empty string for empty file', async () => {
    await mkdir(TEST_DIR, { recursive: true })
    const filePath = path.join(TEST_DIR, 'empty.txt')
    await writeFile(filePath, '')

    expect(await readFileOrNull(filePath)).toBe('')
  })
})
