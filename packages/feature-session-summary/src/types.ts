/**
 * Type definitions for Session Summary feature
 * @see docs/design/FEATURE-SESSION-SUMMARY.md
 * @see docs/design/FEATURE-RESUME.md
 */

import type { ResumeMessageState, SessionSummaryState, SummaryCountdownState } from '@sidekick/types'

export type { ResumeMessageState, SessionSummaryState, SummaryCountdownState }

/**
 * LLM sub-feature configuration binding a profile to a specific task.
 * Used to route different sub-features (summary, snarky, resume) to different profiles.
 */
export interface LlmSubFeatureConfig {
  /** Profile ID from llm.profiles */
  profile: string
  /** Optional fallback profile ID from llm.fallbackProfiles */
  fallbackProfile?: string
}

/**
 * Configuration for session summary feature
 */
export interface SessionSummaryConfig {
  enabled: boolean
  /** LLM profiles for sub-features */
  llm?: {
    sessionSummary?: LlmSubFeatureConfig
    snarkyComment?: LlmSubFeatureConfig
    resumeMessage?: LlmSubFeatureConfig
  }
  excerptLines: number
  /**
   * Include tool messages ([TOOL]: and [RESULT]:) in excerpt.
   * When false, both tool_use and tool_result entries are omitted entirely.
   */
  includeToolMessages: boolean
  /**
   * Include full tool output content in [RESULT]: lines.
   * Only relevant when includeToolMessages is true.
   * When false, shows "[RESULT]: (output omitted)" instead.
   */
  includeToolOutputs: boolean
  /**
   * Include assistant thinking blocks in excerpt.
   * When true, shows "[THINKING]: ..." for thinking content.
   */
  includeAssistantThinking: boolean
  keepHistory: boolean
  maxTitleWords: number
  maxIntentWords: number
  maxSnarkyWords: number
  maxResumeWords: number
  snarkyMessages: boolean
  countdown: {
    lowConfidence: number
    mediumConfidence: number
    highConfidence: number
  }
  bookmark: {
    confidenceThreshold: number
    resetThreshold: number
  }
  /** Persona configuration for creative outputs */
  personas?: {
    /** Pin a specific persona for all new sessions (empty = random selection) */
    pinnedPersona?: string
    /** Comma-separated allow-list of persona IDs (empty = all available) */
    allowList: string
    /** Comma-separated block-list of persona IDs excluded from selection */
    blockList: string
    /** Maximum age (hours) for resume messages to be considered fresh */
    resumeFreshnessHours: number
    /** Inject active persona into Claude Code's system prompt via reminders */
    injectPersonaIntoClaude?: boolean
    /** Default LLM profile for all persona-driven outputs (empty = use feature default) */
    defaultLlmProfile?: string
    /** Per-persona LLM profile overrides (personaId → profileId) */
    llmProfiles?: Record<string, string>
    /** Per-persona selection weights (personaId → weight). Default weight = 1. Non-positive/non-finite = excluded. */
    weights?: Record<string, number>
  }
}

/**
 * Default configuration values
 */
export const DEFAULT_SESSION_SUMMARY_CONFIG: SessionSummaryConfig = {
  enabled: true,
  llm: {
    sessionSummary: { profile: 'fast-lite', fallbackProfile: 'cheap-fallback' },
    snarkyComment: { profile: 'creative', fallbackProfile: 'cheap-fallback' },
    resumeMessage: { profile: 'creative-long', fallbackProfile: 'cheap-fallback' },
  },
  excerptLines: 80,
  includeToolMessages: true,
  includeToolOutputs: false,
  includeAssistantThinking: false,
  keepHistory: false,
  maxTitleWords: 8,
  maxIntentWords: 15,
  maxSnarkyWords: 20,
  maxResumeWords: 20,
  snarkyMessages: true,
  countdown: {
    lowConfidence: 5,
    mediumConfidence: 10,
    highConfidence: 10000,
  },
  bookmark: {
    confidenceThreshold: 0.8,
    resetThreshold: 0.7,
  },
  personas: {
    pinnedPersona: '',
    allowList: '',
    blockList: 'disabled',
    resumeFreshnessHours: 4,
    injectPersonaIntoClaude: true,
    defaultLlmProfile: '',
    llmProfiles: {},
    weights: {},
  },
}

/**
 * Minimum confidence threshold for generating resume artifacts.
 * Both title and intent confidence must be >= this value.
 */
export const RESUME_MIN_CONFIDENCE = 0.7
