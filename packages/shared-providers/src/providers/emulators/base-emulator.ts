/**
 * Abstract Base Emulator
 *
 * Base class for all LLM emulators. Handles call counting and logging,
 * delegating response generation to concrete implementations.
 */

import type { Logger, LLMRequest, LLMResponse } from '@sidekick/types'
import { AbstractProvider } from '../base'
import type { EmulatorStateManager } from './emulator-state'

export interface EmulatorConfig {
  model?: string
}

export abstract class AbstractEmulator extends AbstractProvider {
  protected abstract readonly emulatedProviderId: string

  constructor(
    protected readonly stateManager: EmulatorStateManager,
    protected readonly config: EmulatorConfig,
    logger: Logger
  ) {
    super(logger)
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now()
    this.logRequest(request)

    const callNumber = await this.stateManager.incrementCallCount(this.emulatedProviderId)
    const response = this.generateResponse(request, callNumber)

    this.logResponse(response, Date.now() - startTime)
    return response
  }

  /**
   * Generate a mock response for the given request.
   * Implemented by concrete emulators to match their provider's format.
   */
  protected abstract generateResponse(request: LLMRequest, callNumber: number): LLMResponse

  /**
   * Estimate input tokens from request (rough approximation: 4 chars per token).
   */
  protected estimateInputTokens(request: LLMRequest): number {
    let totalChars = 0

    if (request.system) {
      totalChars += request.system.length
    }

    for (const message of request.messages) {
      totalChars += message.content.length
    }

    return Math.ceil(totalChars / 4)
  }
}
