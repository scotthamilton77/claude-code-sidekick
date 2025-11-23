/**
 * JSON extraction utilities for LLM output processing
 *
 * Matches Track 1 behavior from src/sidekick/lib/json.sh and lib/llm.sh
 */

/**
 * Extract JSON from markdown code block
 *
 * Handles Claude output that wraps JSON in ```json...```
 *
 * Maps to: json_extract_from_markdown() in lib/json.sh
 *
 * @param text - Text that may contain markdown-wrapped JSON
 * @returns Extracted JSON or original text if not wrapped
 */
export function extractJSONFromMarkdown(text: string): string {
  // Check if wrapped in markdown code block (```json ... ```)
  if (text.includes('```json')) {
    // Extract content between ```json and ```
    // Match the bash implementation: sed -n '/^```json$/,/^```$/p' | sed '1d;$d'
    const lines = text.split('\n')
    let startIdx = -1
    let endIdx = -1

    // Find start and end of code fence
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line && line.trim() === '```json') {
        startIdx = i
      } else if (startIdx !== -1 && line && line.trim() === '```') {
        endIdx = i
        break
      }
    }

    // Extract content between fences (excluding fence lines)
    if (startIdx !== -1 && endIdx !== -1) {
      return lines.slice(startIdx + 1, endIdx).join('\n')
    }
  }

  // Return as-is if no markdown fence found
  return text
}

/**
 * Extract JSON from LLM output
 *
 * Handles multiple wrapping formats:
 * - Raw JSON
 * - Markdown code fences (```json ... ```)
 * - JSON embedded in text
 * - Single-element array wrapping ([{...}])
 *
 * Maps to: llm_extract_json() in lib/llm.sh
 *
 * @param output - LLM output text
 * @returns Extracted JSON string
 */
export function extractJSON(output: string): string {
  // Try to extract from markdown code block first
  let extracted = extractJSONFromMarkdown(output)

  // If extraction didn't change the output, look for JSON object or array
  if (extracted === output) {
    // Match from first { to last } (for objects) or [ to ] (for arrays)
    // Bash implementation: echo "$output" | sed -n '/{/,/}/p'
    // Note: bash only looks for {}, but we handle [] for better array support
    const firstBrace = extracted.indexOf('{')
    const lastBrace = extracted.lastIndexOf('}')
    const firstBracket = extracted.indexOf('[')
    const lastBracket = extracted.lastIndexOf(']')

    // Determine if this looks like an array or object based on which comes first
    const isArray = firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)

    if (isArray && lastBracket !== -1 && lastBracket > firstBracket) {
      // Extract array from [ to ]
      extracted = extracted.substring(firstBracket, lastBracket + 1)
    } else if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      // Extract object from { to }
      extracted = extracted.substring(firstBrace, lastBrace + 1)
    }
  }

  // Trim whitespace
  extracted = extracted.trim()

  // Check if output is a single-element array and unwrap it
  // Some models incorrectly return [{...}] instead of {...}
  try {
    const parsed = JSON.parse(extracted) as unknown
    if (Array.isArray(parsed) && parsed.length === 1) {
      extracted = JSON.stringify(parsed[0])
    }
  } catch {
    // If parsing fails, return extracted as-is
    // The caller will handle validation
  }

  return extracted
}
