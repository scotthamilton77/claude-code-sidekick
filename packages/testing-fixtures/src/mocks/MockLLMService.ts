/**
 * Mock LLM Service for Testing
 *
 * Provides a deterministic, queue-based mock for LLM API calls.
 * Supports queuing responses, recording requests, and assertion helpers.
 * Implements LLMProvider interface from @sidekick/types.
 *
 * @example
 * ```typescript
 * const llm = new MockLLMService();
 * llm.queueResponse('Test response');
 * const result = await llm.complete({ messages: [...] });
 * expect(llm.recordedRequests).toHaveLength(1);
 * ```
 */

import type { LLMProvider, LLMRequest, LLMResponse } from '@sidekick/types'

// Re-export types for convenience
export type { LLMRequest, LLMResponse }

export class MockLLMService implements LLMProvider {
  /** Provider identifier - implements LLMProvider.id */
  readonly id = 'mock-llm'

  private responseQueue: string[] = []
  private defaultResponse = 'Mock LLM response'

  public recordedRequests: LLMRequest[] = []

  /**
   * Queue a single response to be returned on next complete() call.
   */
  queueResponse(content: string): void {
    this.responseQueue.push(content)
  }

  /**
   * Queue multiple responses to be returned in order.
   */
  queueResponses(contents: string[]): void {
    this.responseQueue.push(...contents)
  }

  /**
   * Set a default response when queue is empty.
   */
  setDefaultResponse(content: string): void {
    this.defaultResponse = content
  }

  /**
   * Clear all state (queue, recorded requests, default response).
   */
  reset(): void {
    this.responseQueue = []
    this.recordedRequests = []
    this.defaultResponse = 'Mock LLM response'
  }

  /**
   * Main LLM completion method - returns queued response or default.
   * Implements LLMProvider.complete()
   */
  complete(request: LLMRequest): Promise<LLMResponse> {
    this.recordedRequests.push(request)

    const content = this.responseQueue.shift() ?? this.defaultResponse

    return Promise.resolve({
      content,
      model: request.model ?? 'mock-model',
      usage: {
        inputTokens: this.estimateTokens(request),
        outputTokens: this.estimateTokens({ messages: [{ role: 'assistant', content }] }),
      },
      rawResponse: {
        status: 200,
        body: JSON.stringify({ content }),
      },
    })
  }

  /**
   * Get the last recorded request (for assertions).
   */
  getLastRequest(): LLMRequest | undefined {
    return this.recordedRequests[this.recordedRequests.length - 1]
  }

  /**
   * Check if any recorded request matches the partial request.
   */
  wasCalledWith(partial: Partial<LLMRequest>): boolean {
    return this.recordedRequests.some((req) => this.matchesPartial(req, partial))
  }

  private matchesPartial(request: LLMRequest, partial: Partial<LLMRequest>): boolean {
    for (const key of Object.keys(partial) as Array<keyof LLMRequest>) {
      if (key === 'messages') {
        // Deep comparison for messages array
        const partialMessages = partial.messages
        if (!partialMessages) continue

        if (request.messages.length !== partialMessages.length) return false

        for (let i = 0; i < partialMessages.length; i++) {
          const reqMsg = request.messages[i]
          const partialMsg = partialMessages[i]

          if (reqMsg.role !== partialMsg.role || reqMsg.content !== partialMsg.content) {
            return false
          }
        }
      } else {
        if (request[key] !== partial[key]) return false
      }
    }
    return true
  }

  private estimateTokens(request: { messages: Array<{ role?: string; content: string }> }): number {
    // Simple estimation: 4 chars ≈ 1 token
    const totalChars = request.messages.reduce((sum, msg) => sum + msg.content.length, 0)
    return Math.ceil(totalChars / 4)
  }
}
