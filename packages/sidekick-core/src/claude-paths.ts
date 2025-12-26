/**
 * Utilities for working with Claude Code file paths and conventions.
 *
 * Claude Code stores transcripts at:
 * ~/.claude/projects/{encoded-project-path}/{sessionId}.jsonl
 *
 * Where encoded-project-path replaces '/' with '-'
 * e.g., /Users/scott/project -> -Users-scott-project
 */

import { homedir } from 'os'
import path from 'path'

/**
 * Encode a project directory path to Claude Code's format.
 * Replaces '/' with '-' to create a flat directory name.
 *
 * @param projectDir - Absolute path to project directory
 * @returns Encoded path string (e.g., "-Users-scott-project")
 */
export function encodeProjectPath(projectDir: string): string {
  return projectDir.replace(/\//g, '-')
}

/**
 * Reconstruct the transcript file path for a session.
 * Uses Claude Code's convention: ~/.claude/projects/{encoded-path}/{sessionId}.jsonl
 *
 * @param projectDir - Absolute path to project directory
 * @param sessionId - Claude Code session UUID
 * @returns Absolute path to transcript file
 */
export function reconstructTranscriptPath(projectDir: string, sessionId: string): string {
  const encodedPath = encodeProjectPath(projectDir)
  return path.join(homedir(), '.claude', 'projects', encodedPath, `${sessionId}.jsonl`)
}
