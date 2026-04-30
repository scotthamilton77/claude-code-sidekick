/**
 * OpenRouter Emulator
 *
 * Emulates OpenRouter API responses for testing without making actual API calls.
 * OpenRouter uses OpenAI-compatible format with some additional metadata.
 */

import type { LLMRequest, LLMResponse } from '@sidekick/types'
import { AbstractEmulator } from './base-emulator'

export class OpenRouterEmulator extends AbstractEmulator {
  readonly id = 'openrouter-emulator'
  protected readonly emulatedProviderId = 'openrouter'

  protected generateResponse(request: LLMRequest, callNumber: number): LLMResponse {
    const model = request.model ?? this.config.model ?? 'openai/gpt-4'
    const content = `[OpenRouter Emulator] Call #${callNumber} - Model: ${model}`
    const inputTokens = this.estimateInputTokens(request)
    const outputTokens = Math.ceil(content.length / 4)

    // OpenRouter uses OpenAI-compatible format with additional fields
    const rawBody = {
      id: `gen-emu-${callNumber}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    }

    return {
      content,
      model,
      usage: {
        inputTokens,
        outputTokens,
      },
      finishReason: 'stop',
      rawResponse: {
        status: 200,
        body: JSON.stringify(rawBody),
      },
    }
  }
}
