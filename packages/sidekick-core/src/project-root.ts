/**
 * Project Root Resolution Module
 *
 * Resolves the project root directory from CLI input.
 * The --project-dir flag (provided by Claude Code via $CLAUDE_PROJECT_DIR)
 * is the authoritative source for project root.
 */

import path from 'node:path'

export interface ProjectRootInput {
  projectDir?: string
}

export interface ProjectRootResolution {
  projectRoot?: string
}

/**
 * Resolve project root from CLI input.
 *
 * @param input - CLI input containing optional projectDir
 * @returns Resolution with projectRoot set if projectDir was provided
 */
export function resolveProjectRoot(input: ProjectRootInput): ProjectRootResolution {
  const projectRoot = input.projectDir ? path.resolve(input.projectDir) : undefined
  return { projectRoot }
}
