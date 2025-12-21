/**
 * Anthropic CLI Provider
 *
 * Wraps the local `claude` CLI command for LLM interactions.
 * Implements manual retry logic for transient failures since this
 * is a subprocess wrapper rather than an SDK.
 */

import { spawn } from 'node:child_process'
import type { Logger, LLMRequest, LLMResponse } from '@sidekick/types'
import { AbstractProvider } from './base'
import { AuthError, TimeoutError, ProviderError } from '../errors'

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

    let lastError: Error | undefined

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.executeCliRequest(request)
        this.logResponse(response, Date.now() - startTime)
        return response
      } catch (error) {
        lastError = error as Error
        this.logger.warn('CLI request failed, retrying', {
          provider: this.id,
          attempt: attempt + 1,
          maxRetries: this.maxRetries,
          error: (error as Error).message,
        })

        // Don't retry auth errors
        if (error instanceof AuthError) {
          throw error
        }

        // Wait before retry with exponential backoff
        if (attempt < this.maxRetries - 1) {
          await this.sleep(Math.min(1000 * Math.pow(2, attempt), 10000))
        }
      }
    }

    this.logError(lastError!)
    throw new ProviderError(`Failed after ${this.maxRetries} retries: ${lastError!.message}`, this.id, false, lastError)
  }

  private async executeCliRequest(request: LLMRequest): Promise<LLMResponse> {
    return new Promise((resolve, reject) => {
      const args = ['-p', '--model', request.model ?? this.defaultModel, '--output-format', 'json']

      // Build prompt from messages
      const prompt = this.buildPrompt(request)

      this.logger.debug('Spawning Claude CLI process', {
        cliPath: this.cliPath,
        args,
        timeout: this.timeout,
      })

      const child = spawn(this.cliPath, args, {
        timeout: this.timeout,
      })

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      child.on('error', (error) => {
        if (error.message.includes('ENOENT')) {
          reject(new ProviderError(`Claude CLI not found at path: ${this.cliPath}`, this.id, false, error))
        } else {
          reject(new ProviderError(`Spawn error: ${error.message}`, this.id, true, error))
        }
      })

      child.on('close', (code) => {
        this.logger.debug('Claude CLI process exited', {
          exitCode: code,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
        })

        if (code === 0) {
          try {
            const parsed = JSON.parse(stdout) as {
              content?: string
              message?: string
              usage?: { input_tokens?: number; output_tokens?: number }
            }
            const response: LLMResponse = {
              content: parsed.content ?? parsed.message ?? stdout,
              model: request.model ?? this.defaultModel,
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
            resolve(response)
          } catch {
            // If JSON parsing fails, return raw output
            resolve({
              content: stdout,
              model: request.model ?? this.defaultModel,
              rawResponse: {
                status: 200,
                body: stdout,
              },
            })
          }
        } else if (code === 124) {
          reject(new TimeoutError(this.id))
        } else if (code === 401 || stderr.includes('authentication') || stderr.includes('unauthorized')) {
          reject(new AuthError(this.id, new Error(stderr)))
        } else {
          reject(
            new ProviderError(
              `CLI exited with code ${code}: ${stderr || 'no error output'}`,
              this.id,
              code ? code >= 500 : false
            )
          )
        }
      })

      // Send prompt to stdin
      child.stdin.write(prompt)
      child.stdin.end()
    })
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
