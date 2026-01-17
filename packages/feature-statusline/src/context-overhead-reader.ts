/**
 * Context Overhead Reader
 *
 * Reads context metrics from base and project state files to calculate
 * the total fixed overhead that reduces available context window.
 *
 * @see METRICS_PLAN.md
 */

import * as path from 'node:path'
import { StateService } from '@sidekick/core'
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
 * Uses StateService for consistent validation and error handling.
 *
 * Note: User config dir is already ~/.sidekick/, so paths are constructed directly
 * rather than using StateService path helpers (which assume .sidekick/ prefix).
 */
async function readBaseMetrics(userConfigDir: string): Promise<BaseTokenMetricsState> {
  // User config dir paths: {userConfigDir}/state/filename.json
  const stateService = new StateService(userConfigDir)
  const filePath = path.join(userConfigDir, 'state', 'baseline-user-context-token-metrics.json')
  const result = await stateService.read(filePath, BaseTokenMetricsStateSchema, DEFAULT_BASE_METRICS)
  return result.data
}

/**
 * Read project context metrics from project state file.
 * Uses StateService for consistent validation and error handling.
 */
async function readProjectMetrics(projectDir: string): Promise<ProjectContextMetrics> {
  // Project dir paths: {projectDir}/.sidekick/state/filename.json
  const stateService = new StateService(projectDir)
  const filePath = path.join(projectDir, '.sidekick', 'state', 'baseline-project-context-token-metrics.json')
  const result = await stateService.read(filePath, ProjectContextMetricsSchema, DEFAULT_PROJECT_METRICS)
  return result.data
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
