/**
 * Shared Claude Code settings file utilities for the CLI package.
 */
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import * as path from 'node:path'

/**
 * Read a Claude Code settings JSON file, returning an empty object if
 * the file does not exist or contains invalid JSON.
 *
 * Only ENOENT (missing file) and JSON parse errors are swallowed.
 * Other errors (EACCES, EISDIR, etc.) propagate to the caller.
 *
 * @param settingsPath - Absolute path to the settings file
 * @returns Parsed settings object
 * @throws On non-ENOENT filesystem errors (EACCES, EISDIR, etc.)
 */
export async function readSettingsFile<T extends Record<string, unknown> = Record<string, unknown>>(
  settingsPath: string
): Promise<T> {
  let content: string
  try {
    content = await readFile(settingsPath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {} as T
    }
    throw err
  }

  try {
    return JSON.parse(content) as T
  } catch {
    // Invalid JSON — treat as empty settings
    return {} as T
  }
}

/**
 * Write a Claude Code settings JSON file, creating parent directories as needed.
 * If the settings object is empty, deletes the file instead of writing `{}`.
 *
 * @param settingsPath - Absolute path to the settings file
 * @param settings - Settings object to serialize
 * @returns 'written' if file was written, 'deleted' if empty settings caused deletion
 */
export async function writeSettingsFile(
  settingsPath: string,
  settings: Record<string, unknown>
): Promise<'written' | 'deleted'> {
  if (Object.keys(settings).length === 0) {
    try {
      await unlink(settingsPath)
    } catch {
      // File already doesn't exist -- not an error
    }
    return 'deleted'
  }

  await mkdir(path.dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')
  return 'written'
}
