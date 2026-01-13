/**
 * Zod schemas for LLM provider validation
 *
 * Maps to Track 1: JSON validation in llm.sh and json.sh
 */

import { z } from 'zod'

/**
 * Provider type schema
 */
export const ProviderTypeSchema = z.enum(['claude-cli', 'openai-api', 'openrouter', 'custom'])

/**
 * Token usage schema
 */
export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
})

/**
 * Response metadata schema
 */
export const ResponseMetadataSchema = z.object({
  wallTimeMs: z.number().nonnegative(),
  apiDurationMs: z.number().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  usage: TokenUsageSchema.optional(),
  rawResponse: z.string(),
  httpStatusCode: z.number().int().optional(),
  providerMetadata: z.record(z.unknown()).optional(),
})

/**
 * LLM response schema
 */
export const LLMResponseSchema = z.object({
  content: z.string(),
  metadata: ResponseMetadataSchema,
})

/**
 * Circuit breaker state schema
 */
export const CircuitStateSchema = z.enum(['CLOSED', 'OPEN', 'HALF_OPEN'])

export const CircuitBreakerStateSchema = z.object({
  state: CircuitStateSchema,
  consecutiveFailures: z.number().int().nonnegative(),
  lastFailureTime: z.number().int().nonnegative(),
  backoffDuration: z.number().int().nonnegative(),
  nextRetryTime: z.number().int().nonnegative(),
})

/**
 * Base provider config schema
 */
const BaseProviderConfigSchema = z.object({
  type: ProviderTypeSchema,
  model: z.string().min(1),
  timeout: z.number().int().positive().optional(),
  options: z.record(z.unknown()).optional(),
})

/**
 * Claude CLI config schema
 */
export const ClaudeConfigSchema = BaseProviderConfigSchema.extend({
  type: z.literal('claude-cli'),
  binPath: z.string().optional(),
  outputFormat: z.enum(['json', 'text']).default('json'),
  settingSources: z.enum(['project', 'user', 'both']).default('project'),
})

/**
 * OpenAI API config schema
 */
export const OpenAIConfigSchema = BaseProviderConfigSchema.extend({
  type: z.literal('openai-api'),
  apiKey: z.string().min(1),
  endpoint: z.string().url().optional(),
  useJsonSchema: z.boolean().default(true),
})

/**
 * OpenRouter API config schema
 */
export const OpenRouterConfigSchema = BaseProviderConfigSchema.extend({
  type: z.literal('openrouter'),
  apiKey: z.string().min(1),
  endpoint: z.string().url().optional(),
  useJsonSchema: z.boolean().default(true),
})

/**
 * Custom provider config schema
 */
export const CustomConfigSchema = BaseProviderConfigSchema.extend({
  type: z.literal('custom'),
  binPath: z.string().min(1),
  commandTemplate: z.string().min(1),
})

/**
 * Union schema for any provider config
 */
export const AnyProviderConfigSchema = z.discriminatedUnion('type', [
  ClaudeConfigSchema,
  OpenAIConfigSchema,
  OpenRouterConfigSchema,
  CustomConfigSchema,
])

/**
 * Invoke options schema
 */
export const InvokeOptionsSchema = z
  .object({
    timeout: z.number().int().positive().optional(),
    jsonSchema: z.record(z.unknown()).optional(),
    maxRetries: z.number().int().nonnegative().optional(),
    debugDump: z.boolean().optional(),
  })
  .strict()

/**
 * Claude CLI JSON output schema (for parsing --output-format json)
 */
export const ClaudeOutputSchema = z.object({
  result: z.string(),
  duration_ms: z.number().optional(),
  total_cost_usd: z.number().optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
})

/**
 * OpenAI/OpenRouter chat completion response schema
 */
export const ChatCompletionResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullable(),
        role: z.string(),
        reasoning: z.string().optional(),
        tool_calls: z
          .array(
            z.object({
              function: z.object({
                name: z.string(),
                arguments: z.string(),
              }),
            })
          )
          .optional(),
      }),
    })
  ),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
  error: z
    .object({
      message: z.string(),
      type: z.string().optional(),
      code: z.string().optional(),
    })
    .optional(),
})

/**
 * Helper to validate and parse JSON with a schema
 */
export function validateWithSchema<T>(
  data: unknown,
  schema: z.ZodSchema<T>
): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}

/**
 * Extract structured errors from Zod validation
 */
export function formatZodError(error: z.ZodError): string {
  return error.errors
    .map((err) => {
      const path = err.path.length > 0 ? `[${err.path.join('.')}]` : ''
      return `${path} ${err.message}`
    })
    .join('; ')
}
