/**
 * Shared filesystem utilities for the CLI package.
 */
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'

/**
 * Check if a file or directory exists.
 *
 * @param filePath - Absolute path to check
 * @returns true if the path exists, false otherwise
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Read a file as UTF-8 text, returning null if the file does not exist or is unreadable.
 *
 * @param filePath - Absolute path to the file
 * @returns File content or null
 */
export async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}
