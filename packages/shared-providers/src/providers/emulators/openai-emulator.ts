/**
 * OpenAI Emulator
 *
 * Emulates OpenAI API responses for testing without making actual API calls.
 * Response format matches OpenAI's chat completion response structure.
 */

import type { LLMRequest, LLMResponse } from '@sidekick/types'
import { AbstractEmulator } from './base-emulator'

export class OpenAIEmulator extends AbstractEmulator {
  readonly id = 'openai-emulator'
  protected readonly emulatedProviderId = 'openai'

  protected generateResponse(request: LLMRequest, callNumber: number): LLMResponse {
    const model = request.model ?? this.config.model ?? 'gpt-4'
    const content = `[OpenAI Emulator] Call #${callNumber} - Model: ${model}`
    const inputTokens = this.estimateInputTokens(request)
    const outputTokens = Math.ceil(content.length / 4)

    // Match OpenAI's chat completion response format
    const rawBody = {
      id: `chatcmpl-emu-${callNumber}`,
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
