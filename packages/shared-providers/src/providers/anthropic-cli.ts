/**
 * Anthropic CLI Provider
 *
 * Wraps the local `claude` CLI command for LLM interactions.
 * Uses shared spawnClaudeCli utility for subprocess management
 * with automatic retry logic for transient failures.
 */

import type { Logger, LLMRequest, LLMResponse } from '@sidekick/types'
import { AbstractProvider } from './base'
import { spawnClaudeCli } from '../claude-cli-spawn'

export interface AnthropicCliConfig {
  model: string
  cliPath?: string
  timeout?: number
  maxRetries?: number
}

export class AnthropicCliProvider extends AbstractProvider {
  readonly id = 'claude-cli'
  private readonly defaultModel: string
  private readonly cliPath: string
  private readonly timeout: number
  private readonly maxRetries: number

  constructor(config: AnthropicCliConfig, logger: Logger) {
    super(logger)
    this.defaultModel = config.model
    this.cliPath = config.cliPath ?? 'claude'
    this.timeout = config.timeout ?? 60000
    this.maxRetries = config.maxRetries ?? 3

    this.logger.debug('Anthropic CLI provider initialized', {
      provider: this.id,
      model: this.defaultModel,
      cliPath: this.cliPath,
    })
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now()
    this.logRequest(request)

    const args = [
      '-p',
      '--no-session-persistence',
      '--setting-sources',
      'local',
      '--model',
      request.model ?? this.defaultModel,
      '--output-format',
      'json',
    ]

    // Build prompt from messages
    const prompt = this.buildPrompt(request)

    try {
      const result = await spawnClaudeCli({
        args,
        cliPath: this.cliPath,
        timeout: this.timeout,
        maxRetries: this.maxRetries,
        stdin: prompt,
        logger: this.logger,
        providerId: this.id,
      })

      const response = this.parseCliResponse(result.stdout, request.model ?? this.defaultModel)
      this.logResponse(response, Date.now() - startTime)
      return response
    } catch (error) {
      this.logError(error as Error)
      throw error
    }
  }

  private parseCliResponse(stdout: string, model: string): LLMResponse {
    try {
      const parsed = JSON.parse(stdout) as {
        result?: string
        content?: string
        message?: string
        usage?: { input_tokens?: number; output_tokens?: number }
      }
      return {
        // Claude CLI --output-format json uses 'result' field for the response text
        content: parsed.result ?? parsed.content ?? parsed.message ?? stdout,
        model,
        usage: parsed.usage
          ? {
              inputTokens: parsed.usage.input_tokens ?? 0,
              outputTokens: parsed.usage.output_tokens ?? 0,
            }
          : undefined,
        rawResponse: {
          status: 200,
          body: stdout,
        },
      }
    } catch {
      // If JSON parsing fails, return raw output
      return {
        content: stdout,
        model,
        rawResponse: {
          status: 200,
          body: stdout,
        },
      }
    }
  }

  private buildPrompt(request: LLMRequest): string {
    let prompt = ''

    if (request.system) {
      prompt += `System: ${request.system}\n\n`
    }

    for (const msg of request.messages) {
      prompt += `${msg.role}: ${msg.content}\n\n`
    }

    return prompt
  }
}
