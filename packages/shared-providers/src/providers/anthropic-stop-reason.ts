/**
 * Maps Anthropic's `stop_reason` values onto the OpenAI-style
 * `finish_reason` taxonomy used by `LLMResponse.finishReason`.
 * Unknown values pass through unchanged so downstream consumers can
 * still observe novel reasons rather than losing information.
 */
export function mapAnthropicStopReason(stopReason: string | undefined): string | undefined {
  if (!stopReason) return undefined
  switch (stopReason) {
    case 'end_turn':
      return 'stop'
    case 'max_tokens':
      return 'length'
    case 'stop_sequence':
      return 'stop'
    case 'tool_use':
      return 'tool_calls'
    default:
      return stopReason
  }
}
