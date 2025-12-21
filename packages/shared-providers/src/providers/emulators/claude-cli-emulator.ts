/**
 * Claude CLI Emulator
 *
 * Spawns an actual shell script to emulate Claude CLI responses.
 * This tests the real process spawning code path used by AnthropicCliProvider.
 */

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import type { Logger, LLMRequest, LLMResponse } from '@sidekick/types'
import { AbstractProvider } from '../base'
import type { EmulatorConfig } from './base-emulator'

// Bundled script content - avoids needing to locate external file
const EMULATOR_SCRIPT = `#!/bin/bash
# Claude CLI Emulator Script
STATE_FILE="\${SIDEKICK_EMULATOR_STATE_PATH:-.sidekick/emulator-state/call-counts.json}"
MODEL="\${1:-claude-sonnet-4}"

mkdir -p "$(dirname "$STATE_FILE")"

if [ ! -f "$STATE_FILE" ]; then
  echo '{"version":1,"providers":{}}' > "$STATE_FILE"
fi

CALL_COUNT=$(jq -r '.providers["claude-cli"].callCount // 0' "$STATE_FILE" 2>/dev/null || echo "0")
CALL_COUNT=$((CALL_COUNT + 1))

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
jq --arg count "$CALL_COUNT" --arg ts "$TIMESTAMP" \\
  '.providers["claude-cli"] = {callCount: ($count | tonumber), lastCallAt: $ts}' \\
  "$STATE_FILE" > "\${STATE_FILE}.tmp" && mv "\${STATE_FILE}.tmp" "$STATE_FILE"

CONTENT="[Claude CLI Emulator] Call #\${CALL_COUNT} - Model: \${MODEL}"
echo "{\\"content\\":\\"\${CONTENT}\\",\\"message\\":\\"\${CONTENT}\\",\\"model\\":\\"\${MODEL}\\",\\"stop_reason\\":\\"end_turn\\"}"
`

export interface ClaudeCliEmulatorConfig extends EmulatorConfig {
  statePath?: string
  scriptPath?: string
}

export class ClaudeCliEmulator extends AbstractProvider {
  readonly id = 'claude-cli-emulator'
  private readonly scriptPath: string | null
  private readonly statePath: string

  constructor(
    private readonly config: ClaudeCliEmulatorConfig,
    logger: Logger
  ) {
    super(logger)
    // Use provided script path or null to use inline script
    this.scriptPath = config.scriptPath ? resolve(config.scriptPath) : null
    this.statePath = config.statePath ?? '.sidekick/emulator-state/call-counts.json'
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now()
    this.logRequest(request)

    const model = request.model ?? this.config.model ?? 'claude-sonnet-4'

    try {
      const output = await this.spawnScript(model)
      const response = this.parseOutput(output, request)

      this.logResponse(response, Date.now() - startTime)
      return response
    } catch (error) {
      this.logError(error as Error)
      throw error
    }
  }

  private spawnScript(model: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = this.scriptPath ? [this.scriptPath, model] : ['-c', EMULATOR_SCRIPT, 'bash', model]

      const proc = spawn('bash', args, {
        env: {
          ...process.env,
          SIDEKICK_EMULATOR_STATE_PATH: this.statePath,
        },
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('error', (error) => {
        reject(new Error(`Failed to spawn emulator script: ${error.message}`))
      })

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Emulator script exited with code ${code}: ${stderr}`))
        } else {
          resolve(stdout.trim())
        }
      })
    })
  }

  private parseOutput(output: string, request: LLMRequest): LLMResponse {
    const parsed = JSON.parse(output) as {
      content: string
      message: string
      model: string
      stop_reason: string
    }

    const inputTokens = this.estimateInputTokens(request)
    const outputTokens = Math.ceil(parsed.content.length / 4)

    return {
      content: parsed.content,
      model: parsed.model,
      usage: {
        inputTokens,
        outputTokens,
      },
      rawResponse: {
        status: 0, // Exit code
        body: output,
      },
    }
  }

  private estimateInputTokens(request: LLMRequest): number {
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
