/**
 * Task Type Definitions for Background Task Engine
 *
 * Defines the standard task types supported by the Supervisor's TaskEngine.
 * Task handlers are registered at supervisor startup and triggered by
 * handlers or periodic timers.
 *
 * @see docs/design/SUPERVISOR.md §4.3 Task Execution Engine
 */

import { z } from 'zod'

/**
 * Standard task type identifiers.
 * Per SUPERVISOR.md §4.3: session_summary, resume_generation, cleanup
 */
export const TaskTypes = {
  /** Generate or update session summary. Writes to sessions/{id}/summary.json */
  SESSION_SUMMARY: 'session_summary',
  /** Generate resume message from session state. Writes to sessions/{id}/resume-message.json */
  RESUME_GENERATION: 'resume_generation',
  /** Prune old session data. Triggered by periodic timer. */
  CLEANUP: 'cleanup',
  /** Persist metrics to state files. Periodic flush of TranscriptService metrics. */
  METRICS_PERSIST: 'metrics_persist',
  /** Generate first-prompt summary on UserPromptSubmit. Writes to sessions/{id}/state/first-prompt-summary.json */
  FIRST_PROMPT_SUMMARY: 'first_prompt_summary',
} as const

export type TaskType = (typeof TaskTypes)[keyof typeof TaskTypes]

/**
 * Base payload structure for all tasks.
 */
export interface TaskPayloadBase {
  sessionId?: string
}

/**
 * Payload for session_summary task.
 * Triggered by UpdateSessionSummary handler when summary cadence is met.
 */
export interface SessionSummaryPayload extends TaskPayloadBase {
  sessionId: string
  transcriptPath: string
  reason?: 'cadence_met' | 'title_change' | 'manual'
}

/**
 * Payload for resume_generation task.
 * Triggered alongside session_summary when significant changes detected.
 */
export interface ResumeGenerationPayload extends TaskPayloadBase {
  sessionId: string
  summaryPath: string
}

/**
 * Payload for cleanup task.
 * Triggered by periodic timer (configurable interval).
 */
export interface CleanupPayload extends TaskPayloadBase {
  /** Maximum age in milliseconds for session directories to retain */
  maxAgeMs?: number
  /** If true, perform dry-run without actual deletion */
  dryRun?: boolean
}

/**
 * Payload for metrics_persist task.
 * Triggered periodically to flush TranscriptService metrics.
 */
export interface MetricsPersistPayload extends TaskPayloadBase {
  sessionId: string
  metricsPath: string
}

/**
 * Payload for first_prompt_summary task.
 * Triggered on UserPromptSubmit when no session summary exists.
 *
 * @see docs/design/FEATURE-FIRST-PROMPT-SUMMARY.md §2
 */
export interface FirstPromptSummaryPayload extends TaskPayloadBase {
  sessionId: string
  /** User's first prompt text */
  userPrompt: string
  /** Path to state directory for this session */
  stateDir: string
  /** Resume message content (if resuming from previous session) */
  resumeContext?: string
}

/**
 * Union type for all task payloads.
 */
export type TaskPayload =
  | SessionSummaryPayload
  | ResumeGenerationPayload
  | CleanupPayload
  | MetricsPersistPayload
  | FirstPromptSummaryPayload

/**
 * Zod schemas for runtime payload validation.
 * Handlers should validate payloads using these schemas before processing.
 */
export const SessionSummaryPayloadSchema = z.object({
  sessionId: z.string(),
  transcriptPath: z.string(),
  reason: z.enum(['cadence_met', 'title_change', 'manual']).optional(),
})

export const ResumeGenerationPayloadSchema = z.object({
  sessionId: z.string(),
  summaryPath: z.string(),
})

export const CleanupPayloadSchema = z.object({
  maxAgeMs: z.number().optional(),
  dryRun: z.boolean().optional(),
})

export const MetricsPersistPayloadSchema = z.object({
  sessionId: z.string(),
  metricsPath: z.string(),
})

export const FirstPromptSummaryPayloadSchema = z.object({
  sessionId: z.string(),
  userPrompt: z.string(),
  stateDir: z.string(),
  resumeContext: z.string().optional(),
})

/**
 * Tracked task state for orphan prevention.
 * Written to .sidekick/state/task-registry.json when tasks are enqueued.
 * Cleaned on supervisor restart to detect orphaned tasks from crashed runs.
 *
 * @see ROADMAP.md Phase 5.2: Orphan prevention
 */
export interface TrackedTask {
  id: string
  type: TaskType
  sessionId?: string
  enqueuedAt: number
  startedAt?: number
}

/**
 * Task registry state file schema.
 */
export interface TaskRegistryState {
  /** Tasks that were active when supervisor last ran */
  activeTasks: TrackedTask[]
  /** Timestamp of last cleanup check */
  lastCleanupAt?: number
}
