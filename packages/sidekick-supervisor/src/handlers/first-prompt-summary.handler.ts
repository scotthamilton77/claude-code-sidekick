/**
 * First-Prompt Summary Task Handler
 *
 * Generates a snarky, contextual message based on the user's first prompt.
 * Runs asynchronously via TaskEngine, triggered by UserPromptSubmit.
 *
 * @see docs/design/FEATURE-FIRST-PROMPT-SUMMARY.md
 */

import {
  DEFAULT_FIRST_PROMPT_CONFIG,
  FirstPromptSummaryPayloadSchema,
  type FirstPromptClassification,
  type FirstPromptConfig,
  type FirstPromptSummaryState,
  type Logger,
} from '@sidekick/core'
import fs from 'fs/promises'
import path from 'path'
import { TaskContext, TaskHandler } from '../task-engine.js'
import { TaskRegistry, validateSessionId } from '../task-registry.js'

// ============================================================================
// Slash Command Classification
// ============================================================================

/** Classification result for prompt analysis */
export type PromptClassification = 'skip' | 'static' | 'llm'

/**
 * Determine whether to generate first-prompt summary via LLM.
 *
 * @param userPrompt - The user's input text
 * @param skipCommands - Set of slash commands that should skip LLM generation
 * @returns 'skip' for commands that shouldn't generate anything,
 *          'static' for commands with static message,
 *          'llm' for prompts requiring LLM generation
 *
 * @see docs/design/FEATURE-FIRST-PROMPT-SUMMARY.md §3.1
 */
export function classifyPrompt(userPrompt: string, skipCommands?: Set<string>): PromptClassification {
  const trimmed = userPrompt.trim()

  // Check for slash command
  const slashMatch = trimmed.match(/^\/(\S+)/)
  if (!slashMatch) {
    return 'llm' // Not a slash command, send to LLM
  }

  const command = slashMatch[1]
  const skipSet = skipCommands ?? new Set(DEFAULT_FIRST_PROMPT_CONFIG.skipCommands)
  if (skipSet.has(command)) {
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
  /** Feature configuration. Uses defaults if not provided. */
  config?: FirstPromptConfig
}

// ============================================================================
// Handler Implementation
// ============================================================================

export function createFirstPromptSummaryHandler(deps: FirstPromptSummaryHandlerDeps): TaskHandler {
  // Merge provided config with defaults
  const config = deps.config ?? DEFAULT_FIRST_PROMPT_CONFIG
  const skipCommandsSet = new Set(config.skipCommands)

  return async (payload, ctx: TaskContext) => {
    const startTime = performance.now()

    // Check if feature is enabled
    if (!config.enabled) {
      ctx.logger.debug('First-prompt summary feature is disabled')
      return
    }

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

    // Classify the prompt using configurable skip commands
    const classification = classifyPrompt(p.userPrompt, skipCommandsSet)

    if (classification === 'skip') {
      // Check if we should write a static skip message
      if (config.staticSkipMessage !== null) {
        await writeStaticMessage(p, config.staticSkipMessage, startTime, ctx.logger)
      } else {
        ctx.logger.info('Skipping first-prompt summary for meta command', {
          sessionId: p.sessionId,
        })
      }
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
        const llmResult = await generateWithLLM(p.userPrompt, p.resumeContext, config, ctx.logger)
        message = llmResult.message
        source = 'llm'
        llmClassification = llmResult.classification
        model = llmResult.model
      } catch (err) {
        ctx.logger.warn('LLM generation failed, using fallback', {
          error: err instanceof Error ? err.message : String(err),
        })
        message = config.staticFallbackMessage
        source = 'fallback'
      }
    } else {
      // Static message for skipped commands
      message = config.staticFallbackMessage
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

/**
 * Write a static message file for skipped commands when staticSkipMessage is configured.
 */
async function writeStaticMessage(
  payload: { sessionId: string; userPrompt: string; stateDir: string; resumeContext?: string },
  message: string,
  startTime: number,
  logger: Logger
): Promise<void> {
  const summaryPath = path.join(payload.stateDir, 'first-prompt-summary.json')

  const state: FirstPromptSummaryState = {
    session_id: payload.sessionId,
    timestamp: new Date().toISOString(),
    message,
    source: 'static',
    latency_ms: Math.round(performance.now() - startTime),
    user_prompt: payload.userPrompt,
    had_resume_context: !!payload.resumeContext,
  }

  try {
    await fs.mkdir(path.dirname(summaryPath), { recursive: true })
    await fs.writeFile(summaryPath, JSON.stringify(state, null, 2), 'utf-8')
    logger.info('First-prompt summary static message written', {
      sessionId: payload.sessionId,
    })
  } catch (err) {
    logger.error('Failed to write static first-prompt summary', {
      sessionId: payload.sessionId,
      error: err instanceof Error ? err.message : String(err),
    })
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
 * Uses the model configuration from FirstPromptConfig to select provider and model.
 * Falls back to staticFallbackMessage if both primary and fallback providers fail.
 *
 * @see docs/design/FEATURE-FIRST-PROMPT-SUMMARY.md §5
 */
function generateWithLLM(
  userPrompt: string,
  resumeContext: string | undefined,
  config: FirstPromptConfig,
  logger: Logger
): Promise<LLMGenerationResult> {
  // Build the prompt (for logging/debugging)
  const prompt = buildPrompt(userPrompt, resumeContext)
  logger.debug('Built LLM prompt', {
    promptLength: prompt.length,
    primaryProvider: config.model.primary.provider,
    primaryModel: config.model.primary.model,
    hasFallback: config.model.fallback !== null,
  })

  // TODO: Integrate with LLMService from @sidekick/shared-providers
  // Future implementation will use config.model.primary and config.model.fallback
  // with config.llmTimeoutMs for timeout handling
  //
  // const llmService = createLLMService({
  //   provider: config.model.primary.provider,
  //   model: config.model.primary.model,
  //   timeout: config.llmTimeoutMs,
  // })
  // try {
  //   const response = await llmService.complete({
  //     messages: [{ role: 'user', content: prompt }],
  //     maxTokens: 100,
  //   })
  //   return {
  //     message: response.content.trim(),
  //     classification: inferClassification(response.content),
  //     model: response.model,
  //   }
  // } catch (primaryError) {
  //   if (config.model.fallback) {
  //     // Try fallback provider
  //     const fallbackService = createLLMService({
  //       provider: config.model.fallback.provider,
  //       model: config.model.fallback.model,
  //       timeout: config.llmTimeoutMs,
  //     })
  //     const response = await fallbackService.complete(...)
  //     return { ... }
  //   }
  //   throw primaryError
  // }

  // Placeholder: Return a static message until LLM integration is complete
  // This allows testing the full flow without LLM calls
  return Promise.resolve({
    message: 'Processing your request...',
    classification: 'actionable',
    model: `${config.model.primary.provider}/${config.model.primary.model}`,
  })
}
