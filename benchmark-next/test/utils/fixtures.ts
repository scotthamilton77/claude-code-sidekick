/**
 * Test fixture loading utilities
 */

import { readFile } from 'fs/promises'
import { join } from 'path'

export interface Fixture<T = unknown> {
  description: string
  track1_version: string
  input: T
  expected_output: unknown
  notes?: string[]
}

/**
 * Load a test fixture from the fixtures directory
 * @param path - Relative path from test/fixtures/ (e.g., "scoring/similarity/identical-strings.json")
 * @returns Parsed fixture object
 */
export async function loadFixture<T = unknown>(path: string): Promise<Fixture<T>> {
  const fixturePath = join(__dirname, '../fixtures', path)
  const content = await readFile(fixturePath, 'utf-8')
  return JSON.parse(content) as Fixture<T>
}

/**
 * Load multiple fixtures matching a glob pattern
 * @param pattern - Glob pattern (e.g., "scoring/similarity/*.json")
 * @returns Array of parsed fixture objects
 */
export async function loadFixtures<T = unknown>(pattern: string): Promise<Array<Fixture<T>>> {
  // TODO: Implement glob-based fixture loading
  // For now, return empty array
  throw new Error(`loadFixtures not yet implemented: ${pattern}`)
}
