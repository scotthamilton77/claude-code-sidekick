/**
 * Completion Classifier
 *
 * Uses LLM to classify the assistant's stopping intent to determine
 * if it's claiming task completion.
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */

import { z } from 'zod'
import type { SupervisorContext } from '@sidekick/types'
import type { CompletionCategory, CompletionClassification, CompletionDetectionSettings } from './types.js'
import { DEFAULT_COMPLETION_DETECTION_SETTINGS } from './types.js'

const PROMPT_FILE = 'prompts/completion-classifier.prompt.txt'
const SCHEMA_FILE = 'schemas/completion-classifier.schema.json'

/**
 * Zod schema for LLM response validation.
 * Matches assets/sidekick/schemas/completion-classifier.schema.json
 */
const CompletionClassifierResponseSchema = z.object({
  category: z.enum(['CLAIMING_COMPLETION', 'ASKING_QUESTION', 'ANSWERING_QUESTION', 'OTHER']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})

type CompletionClassifierResponse = z.infer<typeof CompletionClassifierResponseSchema>

/**
 * Conversation context extracted from transcript
 */
export interface ConversationContext {
  lastUserPrompt: string | null
  lastAssistantMessage: string | null
}

/**
 * Check if a user message content is a real user prompt vs system-generated content.
 * Filters by content patterns: warmup, slash commands, local command output.
 * Note: isMeta and isCompactSummary are checked via metadata flags, not content.
 * @internal Exported for testing
 */
export function isRealUserPromptContent(content: string): boolean {
  const trimmed = content.trim()

  // Empty or whitespace-only (check first for efficiency)
  if (trimmed.length === 0) return false

  // Warmup message
  if (trimmed.toLowerCase() === 'warmup') return false

  // Slash command invocations
  if (trimmed.startsWith('<command-name>') || trimmed.startsWith('<command-message>')) return false

  // Local command stdout
  if (trimmed.startsWith('<local-command-stdout>')) return false

  return true
}

/**
 * Extract the last user prompt and last assistant message from transcript.
 * Filters out:
 * - tool_use and tool_result entries (via entry.type)
 * - isMeta messages (via metadata flag)
 * - isCompactSummary messages (via metadata flag)
 * - System-generated content patterns (via isRealUserPromptContent)
 */
export function extractConversationContext(ctx: SupervisorContext): ConversationContext {
  const transcript = ctx.transcript.getTranscript()
  const entries = transcript.entries

  let lastUserPrompt: string | null = null
  let lastAssistantMessage: string | null = null

  // Iterate in reverse to find the most recent entries
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]

    // Only consider text entries (skip tool_use and tool_result)
    if (entry.type !== 'text') continue

    // Skip system-generated entries via metadata flags
    if (entry.metadata.isMeta === true) continue
    if (entry.metadata.isCompactSummary === true) continue

    // Extract content as string
    const content = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content)

    if (entry.role === 'assistant' && lastAssistantMessage === null) {
      lastAssistantMessage = content
    } else if (entry.role === 'user' && lastUserPrompt === null) {
      // Filter out system-generated content patterns
      if (isRealUserPromptContent(content)) {
        lastUserPrompt = content
      }
    }

    // Stop once we have both
    if (lastUserPrompt !== null && lastAssistantMessage !== null) {
      break
    }
  }

  return { lastUserPrompt, lastAssistantMessage }
}

/**
 * Interpolate the prompt template with conversation context.
 * @internal Exported for testing
 */
export function interpolatePrompt(template: string, context: ConversationContext): string {
  return template
    .replace(/\{\{lastUserPrompt\}\}/g, context.lastUserPrompt ?? '(no user prompt found)')
    .replace(/\{\{lastAssistantMessage\}\}/g, context.lastAssistantMessage ?? '(no assistant message found)')
}

/**
 * Parse and validate LLM response as JSON.
 * @internal Exported for testing
 */
export function parseResponse(content: string): CompletionClassifierResponse | null {
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim()
    }

    const parsed: unknown = JSON.parse(jsonStr)
    return CompletionClassifierResponseSchema.parse(parsed)
  } catch {
    return null
  }
}

/**
 * Options for classification
 */
export interface ClassifyCompletionOptions {
  ctx: SupervisorContext
  settings?: CompletionDetectionSettings
}

/**
 * Result of classification including decision guidance
 */
export interface ClassifyCompletionResult {
  classification: CompletionClassification
  shouldBlock: boolean
  userMessage?: string
}

/**
 * Default result when classification cannot be performed (defaults to blocking).
 */
const DEFAULT_RESULT: ClassifyCompletionResult = {
  classification: {
    category: 'CLAIMING_COMPLETION',
    confidence: 1.0,
    reasoning: 'Classification unavailable - defaulting to blocking',
  },
  shouldBlock: true,
}

/**
 * Classify the assistant's stopping intent using LLM.
 *
 * Returns classification result including whether to block the stop.
 * On any error, defaults to blocking (safe fallback).
 */
export async function classifyCompletion(options: ClassifyCompletionOptions): Promise<ClassifyCompletionResult> {
  const { ctx } = options
  const settings = options.settings ?? DEFAULT_COMPLETION_DETECTION_SETTINGS

  // Check if classification is enabled
  if (!settings.enabled) {
    ctx.logger.debug('Completion classification disabled - defaulting to block')
    return DEFAULT_RESULT
  }

  // Extract conversation context
  const context = extractConversationContext(ctx)

  if (!context.lastAssistantMessage) {
    ctx.logger.warn('No assistant message found in transcript - defaulting to block')
    return DEFAULT_RESULT
  }

  // Load prompt template
  const promptTemplate = ctx.assets.resolve(PROMPT_FILE)
  if (!promptTemplate) {
    ctx.logger.error('Failed to load completion classifier prompt template', { path: PROMPT_FILE })
    return DEFAULT_RESULT
  }

  // Interpolate prompt
  const prompt = interpolatePrompt(promptTemplate, context)

  // Load JSON schema for structured output
  const schemaContent = ctx.assets.resolve(SCHEMA_FILE)
  const jsonSchema = schemaContent
    ? {
        name: 'completion-classifier',
        schema: JSON.parse(schemaContent) as Record<string, unknown>,
      }
    : undefined

  // Get LLM provider from settings
  const llmConfig = settings.llm ?? DEFAULT_COMPLETION_DETECTION_SETTINGS.llm!
  const provider = ctx.profileFactory.createForProfile(llmConfig.profile, llmConfig.fallbackProfile)

  try {
    const response = await provider.complete({
      messages: [{ role: 'user', content: prompt }],
      jsonSchema,
    })

    const llmResponse = parseResponse(response.content)

    if (!llmResponse) {
      ctx.logger.warn('Failed to parse completion classifier response', {
        content: response.content.slice(0, 200),
      })
      return DEFAULT_RESULT
    }

    // Build classification result
    const classification: CompletionClassification = {
      category: llmResponse.category as CompletionCategory,
      confidence: llmResponse.confidence,
      reasoning: llmResponse.reasoning,
    }

    // Determine action based on classification
    const shouldBlock =
      classification.category === 'CLAIMING_COMPLETION' && classification.confidence >= settings.confidenceThreshold

    // Determine user message for non-blocking cases
    let userMessage: string | undefined
    if (!shouldBlock && classification.category === 'OTHER') {
      userMessage = "Agent's work may be incomplete - trust but verify!"
    }
    // ASKING_QUESTION and ANSWERING_QUESTION get no user message (silent)

    ctx.logger.info('Completion classification result', {
      category: classification.category,
      confidence: classification.confidence,
      shouldBlock,
      reasoning: classification.reasoning?.slice(0, 100),
    })

    return { classification, shouldBlock, userMessage }
  } catch (err) {
    ctx.logger.error('Completion classification failed', { error: String(err) })
    return DEFAULT_RESULT
  }
}
