/**
 * Zod schemas for configuration validation
 *
 * Defines type-safe configuration schemas with runtime validation
 */

import { z } from 'zod';

/**
 * Log level options
 */
export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

/**
 * LLM provider options
 */
export const LLMProviderTypeSchema = z.enum([
  'claude-cli',
  'openai-api',
  'openrouter',
  'custom',
]);
export type LLMProviderType = z.infer<typeof LLMProviderTypeSchema>;

/**
 * Feature toggles configuration
 */
export const FeaturesConfigSchema = z.object({
  topicExtraction: z.boolean().default(true),
  resume: z.boolean().default(true),
  statusline: z.boolean().default(true),
  tracking: z.boolean().default(true),
  reminder: z.boolean().default(true),
  cleanup: z.boolean().default(true),
});
export type FeaturesConfig = z.infer<typeof FeaturesConfigSchema>;

/**
 * Claude CLI provider configuration
 */
export const ClaudeProviderConfigSchema = z.object({
  bin: z.string().optional(),
  model: z.string().default('haiku'),
});
export type ClaudeProviderConfig = z.infer<typeof ClaudeProviderConfigSchema>;

/**
 * OpenAI API provider configuration
 */
export const OpenAIProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  endpoint: z.string().default('https://api.openai.com/v1/chat/completions'),
  model: z.string().default('gpt-5-nano'),
});
export type OpenAIProviderConfig = z.infer<typeof OpenAIProviderConfigSchema>;

/**
 * OpenRouter provider configuration
 */
export const OpenRouterProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  endpoint: z.string().default('https://openrouter.ai/api/v1/chat/completions'),
  model: z.string().default('google/gemma-3-12b-it'),
});
export type OpenRouterProviderConfig = z.infer<
  typeof OpenRouterProviderConfigSchema
>;

/**
 * Custom provider configuration
 */
export const CustomProviderConfigSchema = z.object({
  command: z.string().optional(),
  bin: z.string().optional(),
  model: z.string().default('default'),
});
export type CustomProviderConfig = z.infer<typeof CustomProviderConfigSchema>;

/**
 * Circuit breaker configuration
 */
export const CircuitBreakerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  failureThreshold: z.number().int().positive().default(3),
  backoffInitial: z.number().int().positive().default(60),
  backoffMax: z.number().int().positive().default(3600),
  backoffMultiplier: z.number().positive().default(2),
});
export type CircuitBreakerConfig = z.infer<typeof CircuitBreakerConfigSchema>;

/**
 * LLM invocation settings
 */
export const LLMConfigSchema = z.object({
  provider: LLMProviderTypeSchema.default('openrouter'),
  fallbackProvider: LLMProviderTypeSchema.optional(),
  fallbackModel: z.string().optional(),
  timeoutSeconds: z.number().int().positive().default(10),
  // benchmarkTimeoutSeconds can be null to indicate "use timeoutSeconds"
  benchmarkTimeoutSeconds: z.number().int().positive().nullable().default(15),
  timeoutMaxRetries: z.number().int().nonnegative().default(3),
  debugDumpEnabled: z.boolean().default(false),

  // Provider-specific configs
  claude: ClaudeProviderConfigSchema.default({}),
  openai: OpenAIProviderConfigSchema.default({}),
  openrouter: OpenRouterProviderConfigSchema.default({}),
  custom: CustomProviderConfigSchema.default({}),

  // Circuit breaker
  circuitBreaker: CircuitBreakerConfigSchema.default({}),
});
export type LLMConfig = z.infer<typeof LLMConfigSchema>;

/**
 * Topic extraction configuration
 */
export const TopicConfigSchema = z.object({
  excerptLines: z.number().int().positive().default(80),
  filterToolMessages: z.boolean().default(true),
  cadenceHigh: z.number().int().positive().default(10),
  cadenceLow: z.number().int().positive().default(1),
  clarityThreshold: z.number().int().min(1).max(10).default(7),
});
export type TopicConfig = z.infer<typeof TopicConfigSchema>;

/**
 * Sleeper (background polling) configuration
 */
export const SleeperConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxDuration: z.number().int().positive().default(600),
  minSizeChange: z.number().int().positive().default(500),
  minInterval: z.number().int().positive().default(10),
  minSleep: z.number().int().positive().default(2),
  maxSleep: z.number().int().positive().default(20),
});
export type SleeperConfig = z.infer<typeof SleeperConfigSchema>;

/**
 * Resume (session continuity) configuration
 */
export const ResumeConfigSchema = z.object({
  minClarity: z.number().int().min(1).max(10).default(5),
});
export type ResumeConfig = z.infer<typeof ResumeConfigSchema>;

/**
 * Statusline configuration
 */
export const StatuslineConfigSchema = z.object({
  tokenThreshold: z.number().int().positive().default(160000),
});
export type StatuslineConfig = z.infer<typeof StatuslineConfigSchema>;

/**
 * Reminder configuration
 */
export const ReminderConfigSchema = z.object({
  staticCadence: z.number().int().positive().default(4),
});
export type ReminderConfig = z.infer<typeof ReminderConfigSchema>;

/**
 * Cleanup configuration
 */
export const CleanupConfigSchema = z.object({
  enabled: z.boolean().default(true),
  minCount: z.number().int().positive().default(5),
  ageDays: z.number().int().positive().default(2),
  dryRun: z.boolean().default(false),
});
export type CleanupConfig = z.infer<typeof CleanupConfigSchema>;

/**
 * Benchmark-specific configuration
 */
export const BenchmarkConfigSchema = z.object({
  referenceVersion: z.string().default('v1.0'),
  judgeModel: z.string().default('openrouter:deepseek/deepseek-r1-distill-qwen-14b'),
  scoringModelFallback: z.string().optional(),
  scoreWeightSchema: z.number().min(0).max(1).default(0.3),
  scoreWeightAccuracy: z.number().min(0).max(1).default(0.5),
  scoreWeightContent: z.number().min(0).max(1).default(0.2),
  earlyTermJsonFailures: z.number().int().positive().default(3),
  earlyTermTimeoutCount: z.number().int().positive().default(3),
  maxRetries: z.number().int().nonnegative().default(2),
});
export type BenchmarkConfig = z.infer<typeof BenchmarkConfigSchema>;

/**
 * Complete configuration schema
 */
export const ConfigSchema = z.object({
  logLevel: LogLevelSchema.default('info'),
  features: FeaturesConfigSchema.default({}),
  llm: LLMConfigSchema.default({}),
  topic: TopicConfigSchema.default({}),
  sleeper: SleeperConfigSchema.default({}),
  resume: ResumeConfigSchema.default({}),
  statusline: StatuslineConfigSchema.default({}),
  reminder: ReminderConfigSchema.default({}),
  cleanup: CleanupConfigSchema.default({}),
  benchmark: BenchmarkConfigSchema.default({}),
});
export type Config = z.infer<typeof ConfigSchema>;

/**
 * Partial configuration schema for user overrides
 * All fields are optional to allow partial configuration
 */
export const PartialConfigSchema = ConfigSchema.partial().deepPartial();
export type PartialConfig = z.infer<typeof PartialConfigSchema>;
