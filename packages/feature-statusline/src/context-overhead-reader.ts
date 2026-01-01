/**
 * Context Overhead Reader
 *
 * Reads context metrics from base and project state files to calculate
 * the total fixed overhead that reduces available context window.
 *
 * @see METRICS_PLAN.md
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  BaseTokenMetricsStateSchema,
  ProjectContextMetricsSchema,
  DEFAULT_BASE_METRICS,
  DEFAULT_PROJECT_METRICS,
  type BaseTokenMetricsState,
  type ProjectContextMetrics,
} from '@sidekick/types'

/**
 * Combined overhead metrics from base and project state.
 */
export interface ContextOverhead {
  /** System prompt tokens (~3.2k) */
  systemPromptTokens: number
  /** System tools tokens (~17.9k) */
  systemToolsTokens: number
  /** MCP tools tokens (variable per project) */
  mcpToolsTokens: number
  /** Custom agents tokens (variable per project) */
  customAgentsTokens: number
  /** Memory files tokens (baseline for project) */
  memoryFilesTokens: number
  /** Autocompact buffer tokens (~45k reserved) */
  autocompactBufferTokens: number
  /** Total overhead (sum of all above) */
  totalOverhead: number
  /** Whether defaults were used (real capture hasn't run) */
  usingDefaults: boolean
}

/**
 * Configuration for reading context overhead.
 */
export interface ContextOverheadReaderConfig {
  /** User config directory (e.g., ~/.sidekick) */
  userConfigDir: string
  /** Project directory (e.g., /path/to/project) */
  projectDir: string
}

/**
 * Read base token metrics from global state file.
 */
async function readBaseMetrics(userConfigDir: string): Promise<BaseTokenMetricsState> {
  const filePath = path.join(userConfigDir, 'state', 'baseline-user-context-token-metrics.json')
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const parsed = BaseTokenMetricsStateSchema.safeParse(JSON.parse(content))
    if (parsed.success) {
      return parsed.data
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return DEFAULT_BASE_METRICS
}

/**
 * Read project context metrics from project state file.
 */
async function readProjectMetrics(projectDir: string): Promise<ProjectContextMetrics> {
  const filePath = path.join(projectDir, '.sidekick', 'state', 'baseline-project-context-token-metrics.json')
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const parsed = ProjectContextMetricsSchema.safeParse(JSON.parse(content))
    if (parsed.success) {
      return parsed.data
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return DEFAULT_PROJECT_METRICS
}

/**
 * Read and combine context overhead from base and project metrics.
 *
 * @param config - Reader configuration with paths
 * @returns Combined overhead metrics
 */
export async function readContextOverhead(config: ContextOverheadReaderConfig): Promise<ContextOverhead> {
  const [base, project] = await Promise.all([
    readBaseMetrics(config.userConfigDir),
    readProjectMetrics(config.projectDir),
  ])

  const totalOverhead =
    base.systemPromptTokens +
    base.systemToolsTokens +
    project.mcpToolsTokens +
    project.customAgentsTokens +
    project.memoryFilesTokens +
    base.autocompactBufferTokens

  return {
    systemPromptTokens: base.systemPromptTokens,
    systemToolsTokens: base.systemToolsTokens,
    mcpToolsTokens: project.mcpToolsTokens,
    customAgentsTokens: project.customAgentsTokens,
    memoryFilesTokens: project.memoryFilesTokens,
    autocompactBufferTokens: base.autocompactBufferTokens,
    totalOverhead,
    usingDefaults: base.capturedFrom === 'defaults',
  }
}

/**
 * Get total overhead from defaults (no file I/O).
 * Use when async reading is not possible.
 */
export function getDefaultOverhead(): ContextOverhead {
  const base = DEFAULT_BASE_METRICS
  const project = DEFAULT_PROJECT_METRICS

  const totalOverhead =
    base.systemPromptTokens +
    base.systemToolsTokens +
    project.mcpToolsTokens +
    project.customAgentsTokens +
    project.memoryFilesTokens +
    base.autocompactBufferTokens

  return {
    systemPromptTokens: base.systemPromptTokens,
    systemToolsTokens: base.systemToolsTokens,
    mcpToolsTokens: project.mcpToolsTokens,
    customAgentsTokens: project.customAgentsTokens,
    memoryFilesTokens: project.memoryFilesTokens,
    autocompactBufferTokens: base.autocompactBufferTokens,
    totalOverhead,
    usingDefaults: true,
  }
}
