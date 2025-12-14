/**
 * First-Prompt Summary Task Handler
 *
 * Generates a snarky, contextual message based on the user's first prompt.
 * Runs asynchronously via TaskEngine, triggered by UserPromptSubmit.
 *
 * @see docs/design/FEATURE-FIRST-PROMPT-SUMMARY.md
 */

import { FirstPromptSummaryPayloadSchema, Logger } from '@sidekick/core'
import type { FirstPromptClassification, FirstPromptSummaryState } from '@sidekick/types'
import fs from 'fs/promises'
import path from 'path'
import { TaskContext, TaskHandler } from '../task-engine.js'
import { TaskRegistry, validateSessionId } from '../task-registry.js'

// ============================================================================
// Slash Command Classification
// ============================================================================

/**
 * Commands that should skip LLM generation entirely.
 * These are meta-operations that don't warrant creative commentary.
 *
 * @see docs/design/FEATURE-FIRST-PROMPT-SUMMARY.md §3.1
 */
const SKIP_LLM_COMMANDS = new Set([
  'add-dir',
  'agents',
  'bashes',
  'bug',
  'clear',
  'compact',
  'config',
  'context',
  'cost',
  'doctor',
  'exit',
  'export',
  'help',
  'hooks',
  'ide',
  'install-github-app',
  'login',
  'logout',
  'mcp',
  'memory',
  'output-style',
  'permissions',
  'plugin',
  'pr-comments',
  'privacy-settings',
  'release-notes',
  'resume',
  'rewind',
  'sandbox',
  'security-review',
  'stats',
  'status',
  'statusline',
  'terminal-setup',
  'todos',
  'usage',
  'vim',
])

/** Classification result for prompt analysis */
export type PromptClassification = 'skip' | 'static' | 'llm'

/**
 * Determine whether to generate first-prompt summary via LLM.
 *
 * @returns 'skip' for commands that shouldn't generate anything,
 *          'static' for commands with static message,
 *          'llm' for prompts requiring LLM generation
 */
export function classifyPrompt(userPrompt: string): PromptClassification {
  const trimmed = userPrompt.trim()

  // Check for slash command
  const slashMatch = trimmed.match(/^\/(\S+)/)
  if (!slashMatch) {
    return 'llm' // Not a slash command, send to LLM
  }

  const command = slashMatch[1]
  if (SKIP_LLM_COMMANDS.has(command)) {
    return 'skip' // Skip generation entirely
  }

  return 'llm' // Send to LLM (includes /init, /model, /review, custom commands)
}

// ============================================================================
// LLM Prompt Generation
// ============================================================================

/**
 * Build the LLM prompt for first-prompt summary generation.
 *
 * @see docs/design/FEATURE-FIRST-PROMPT-SUMMARY.md §4.2
 */
export function buildPrompt(userPrompt: string, resumeContext?: string): string {
  const contextSection = resumeContext
    ? `## Context\nPrevious session goal: ${resumeContext}`
    : `## Context\nThis is a brand new session (no prior context).`

  return `You are generating a brief, snarky status message for a coding assistant's status line.

${contextSection}

## User's First Input
${userPrompt}

## Instructions
1. Classify the input:
   - COMMAND: Slash command or configuration action
   - CONVERSATIONAL: Greeting, small talk, or social interaction
   - INTERROGATIVE: Question about codebase, capabilities, or exploration
   - AMBIGUOUS: Context-setting but unclear specific goal
   - ACTIONABLE: Clear task with specific intent

2. Generate a single snarky line (max 60 characters) appropriate to the classification.

## Tone Guidelines
- Witty and slightly sardonic, never mean
- Self-aware about AI limitations
- References to sci-fi welcome (Hitchhiker's, Star Trek, etc.)
- Match energy: serious tasks get wry acknowledgment, casual inputs get playful response

## Output Format
Return ONLY the snarky message on a single line, no explanation or classification label.
Do not include quotes around the message.`
}

// ============================================================================
// Handler Dependencies & Config
// ============================================================================

export interface FirstPromptSummaryHandlerDeps {
  taskRegistry: TaskRegistry
  projectDir: string
  logger: Logger
}

/**
 * Default configuration for first-prompt summary generation.
 * TODO: Make configurable via sidekick config in Phase 4.
 */
const DEFAULT_CONFIG = {
  staticFallbackMessage: 'Deciphering intent...',
  /** LLM call timeout in ms */
  llmTimeoutMs: 10000,
}

// ============================================================================
// Handler Implementation
// ============================================================================

export function createFirstPromptSummaryHandler(deps: FirstPromptSummaryHandlerDeps): TaskHandler {
  return async (payload, ctx: TaskContext) => {
    const startTime = performance.now()

    // Validate payload
    const result = FirstPromptSummaryPayloadSchema.safeParse(payload)
    if (!result.success) {
      ctx.logger.error('Invalid payload', { errors: result.error.issues })
      throw new Error('Invalid task payload')
    }
    const p = result.data

    ctx.logger.info('First-prompt summary task started', {
      sessionId: p.sessionId,
      hasResumeContext: !!p.resumeContext,
    })

    // Validate session ID before path construction
    validateSessionId(p.sessionId)

    // Track task start
    await deps.taskRegistry.markTaskStarted(ctx.taskId)

    if (ctx.signal.aborted) {
      ctx.logger.info('First-prompt summary task cancelled')
      return
    }

    // Classify the prompt
    const classification = classifyPrompt(p.userPrompt)

    if (classification === 'skip') {
      ctx.logger.info('Skipping first-prompt summary for meta command', {
        sessionId: p.sessionId,
      })
      return
    }

    // Determine output path
    const summaryPath = path.join(p.stateDir, 'first-prompt-summary.json')

    // Check if file already exists (idempotency)
    try {
      await fs.access(summaryPath)
      ctx.logger.info('First-prompt summary already exists, skipping', {
        sessionId: p.sessionId,
      })
      return
    } catch {
      // File doesn't exist, proceed with generation
    }

    let message: string
    let source: 'llm' | 'static' | 'fallback'
    let llmClassification: FirstPromptClassification | undefined
    let model: string | undefined

    if (classification === 'llm') {
      // Try LLM generation
      try {
        const llmResult = await generateWithLLM(p.userPrompt, p.resumeContext, ctx.logger)
        message = llmResult.message
        source = 'llm'
        llmClassification = llmResult.classification
        model = llmResult.model
      } catch (err) {
        ctx.logger.warn('LLM generation failed, using fallback', {
          error: err instanceof Error ? err.message : String(err),
        })
        message = DEFAULT_CONFIG.staticFallbackMessage
        source = 'fallback'
      }
    } else {
      // Static message for skipped commands
      message = DEFAULT_CONFIG.staticFallbackMessage
      source = 'static'
    }

    // Build the state object
    const state: FirstPromptSummaryState = {
      session_id: p.sessionId,
      timestamp: new Date().toISOString(),
      message,
      classification: llmClassification,
      source,
      model,
      latency_ms: Math.round(performance.now() - startTime),
      user_prompt: p.userPrompt,
      had_resume_context: !!p.resumeContext,
    }

    // Write the file
    try {
      await fs.mkdir(path.dirname(summaryPath), { recursive: true })
      await fs.writeFile(summaryPath, JSON.stringify(state, null, 2), 'utf-8')
      ctx.logger.info('First-prompt summary task completed', {
        sessionId: p.sessionId,
        source,
        latencyMs: state.latency_ms,
      })
    } catch (err) {
      ctx.logger.error('Failed to write first-prompt summary', {
        sessionId: p.sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }
}

// ============================================================================
// LLM Integration (Placeholder)
// ============================================================================

interface LLMGenerationResult {
  message: string
  classification?: FirstPromptClassification
  model: string
}

/**
 * Generate first-prompt summary using LLM.
 *
 * TODO: Phase 2 implementation - integrate with @sidekick/shared-providers
 * For now, returns a placeholder to allow testing the flow.
 */
function generateWithLLM(
  userPrompt: string,
  resumeContext: string | undefined,
  logger: Logger
): Promise<LLMGenerationResult> {
  // Build the prompt (for logging/debugging)
  const prompt = buildPrompt(userPrompt, resumeContext)
  logger.debug('Built LLM prompt', { promptLength: prompt.length })

  // TODO: Integrate with LLMService from @sidekick/shared-providers
  // For now, return a placeholder that demonstrates the pattern
  //
  // Future implementation:
  // const llmService = createLLMService(config)
  // const response = await llmService.complete({
  //   messages: [{ role: 'user', content: prompt }],
  //   maxTokens: 100,
  // })
  // return {
  //   message: response.content.trim(),
  //   classification: inferClassification(response.content),
  //   model: response.model,
  // }

  // Placeholder: Return a static message until LLM integration is complete
  // This allows testing the full flow without LLM calls
  return Promise.resolve({
    message: 'Processing your request...',
    classification: 'actionable',
    model: 'placeholder',
  })
}
