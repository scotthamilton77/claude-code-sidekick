/**
 * Unit tests for First-Prompt Summary Handler
 *
 * Tests the classifyPrompt and buildPrompt functions, plus schema validation.
 *
 * @see docs/design/FEATURE-FIRST-PROMPT-SUMMARY.md
 */

import {
  DEFAULT_FIRST_PROMPT_CONFIG,
  FirstPromptConfigSchema,
  FirstPromptSummaryPayloadSchema,
  FirstPromptSummaryStateSchema,
} from '@sidekick/core'
import { describe, expect, it } from 'vitest'
import {
  buildPrompt,
  classifyPrompt,
  generateWithLLM,
  PromptClassification,
  PromptParts,
} from '../first-prompt-summary.handler.js'

describe('classifyPrompt', () => {
  describe('non-slash commands', () => {
    it('should return llm for plain text prompts', () => {
      expect(classifyPrompt('Help me fix this bug')).toBe('llm')
    })

    it('should return llm for prompts starting with whitespace', () => {
      expect(classifyPrompt('  Build a REST API')).toBe('llm')
    })

    it('should return llm for prompts with slash in middle', () => {
      expect(classifyPrompt('Fix the src/components/Button.tsx file')).toBe('llm')
    })

    it('should return llm for questions', () => {
      expect(classifyPrompt('What does this function do?')).toBe('llm')
    })

    it('should return llm for greetings', () => {
      expect(classifyPrompt('Hello!')).toBe('llm')
    })
  })

  describe('skip slash commands (meta-operations)', () => {
    const skipCommands = [
      'add-dir',
      'agents',
      'bashes',
      'bug',
      'clear',
      'compact',
      'config',
      'context',
      'cost',
      'doctor',
      'exit',
      'export',
      'help',
      'hooks',
      'ide',
      'install-github-app',
      'login',
      'logout',
      'mcp',
      'memory',
      'output-style',
      'permissions',
      'plugin',
      'pr-comments',
      'privacy-settings',
      'release-notes',
      'resume',
      'rewind',
      'sandbox',
      'security-review',
      'stats',
      'status',
      'statusline',
      'terminal-setup',
      'todos',
      'usage',
      'vim',
    ]

    it.each(skipCommands)('should return skip for /%s', (command) => {
      expect(classifyPrompt(`/${command}`)).toBe('skip')
    })

    it('should return skip for commands with arguments', () => {
      expect(classifyPrompt('/config get llmProvider')).toBe('skip')
      expect(classifyPrompt('/help agents')).toBe('skip')
      expect(classifyPrompt('/resume session-123')).toBe('skip')
    })

    it('should return skip for commands with leading whitespace', () => {
      expect(classifyPrompt('  /help')).toBe('skip')
    })
  })

  describe('llm slash commands (meaningful actions)', () => {
    const llmCommands = ['init', 'model', 'review', 'custom-command', 'my-workflow']

    it.each(llmCommands)('should return llm for /%s', (command) => {
      expect(classifyPrompt(`/${command}`)).toBe('llm')
    })

    it('should return llm for /init with arguments', () => {
      expect(classifyPrompt('/init typescript-project')).toBe('llm')
    })
  })

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(classifyPrompt('')).toBe('llm')
    })

    it('should handle whitespace-only string', () => {
      expect(classifyPrompt('   ')).toBe('llm')
    })

    it('should handle single slash', () => {
      // Single slash is not a valid command, treated as llm
      expect(classifyPrompt('/')).toBe('llm')
    })

    it('should be case-sensitive for commands', () => {
      // /HELP is not in the skip list (case-sensitive)
      expect(classifyPrompt('/HELP')).toBe('llm')
      expect(classifyPrompt('/Help')).toBe('llm')
    })
  })
})

describe('buildPrompt', () => {
  describe('return structure', () => {
    it('should return PromptParts with system and user fields', () => {
      const result = buildPrompt('Fix the login bug')
      expect(result).toHaveProperty('system')
      expect(result).toHaveProperty('user')
      expect(typeof result.system).toBe('string')
      expect(typeof result.user).toBe('string')
    })
  })

  describe('context section (in user message)', () => {
    it('should include new session context when no resume context', () => {
      const { user } = buildPrompt('Fix the login bug')
      expect(user).toContain('New session')
      expect(user).not.toContain('Previous session')
    })

    it('should include resume context when provided', () => {
      const { user } = buildPrompt('Continue where we left off', 'Implementing user auth')
      expect(user).toContain('Previous session: Implementing user auth')
      expect(user).not.toContain('New session')
    })
  })

  describe('user input section', () => {
    it('should include the user prompt in user message', () => {
      const userInput = 'Help me refactor the database layer'
      const { user } = buildPrompt(userInput)
      expect(user).toContain(`User input: "${userInput}"`)
    })

    it('should preserve special characters in user prompt', () => {
      const userInput = 'Fix the `handleClick()` function in <Button />'
      const { user } = buildPrompt(userInput)
      expect(user).toContain(userInput)
    })
  })

  describe('system message constraints', () => {
    it('should include character limit instruction', () => {
      const { system } = buildPrompt('test')
      expect(system).toContain('Max 60 characters')
    })

    it('should include JSON output format', () => {
      const { system } = buildPrompt('test')
      expect(system).toContain('Output JSON')
      expect(system).toContain('"message"')
    })

    it('should include single line constraint', () => {
      const { system } = buildPrompt('test')
      expect(system).toContain('Single line')
    })
  })

  describe('negative examples (NEVER section)', () => {
    it('should include negative examples to prevent assistant mode', () => {
      const { system } = buildPrompt('test')
      expect(system).toContain('NEVER')
      expect(system).toContain('Clarifying questions')
      expect(system).toContain('Helpful preambles')
    })
  })

  describe('few-shot examples', () => {
    it('should include diverse few-shot examples', () => {
      const { system } = buildPrompt('test')
      expect(system).toContain('EXAMPLES')
      expect(system).toContain('debug')
      expect(system).toContain('hello!')
      expect(system).toContain('JWT')
    })
  })

  describe('tone guidelines', () => {
    it('should include sci-fi reference guideline', () => {
      const { system } = buildPrompt('test')
      expect(system).toContain("Hitchhiker's")
      expect(system).toContain('Star Trek')
    })

    it('should include snarky tone guideline', () => {
      const { system } = buildPrompt('test')
      expect(system).toContain('Snarky')
      expect(system).toContain('never mean')
    })
  })
})

describe('type safety', () => {
  it('classifyPrompt should return valid PromptClassification', () => {
    const validResults: PromptClassification[] = ['skip', 'static', 'llm']

    expect(validResults).toContain(classifyPrompt('/help'))
    expect(validResults).toContain(classifyPrompt('/init'))
    expect(validResults).toContain(classifyPrompt('plain text'))
  })
})

describe('FirstPromptSummaryPayloadSchema', () => {
  describe('valid payloads', () => {
    it('should accept minimal valid payload', () => {
      const payload = {
        sessionId: 'session-123',
        userPrompt: 'Help me fix a bug',
        stateDir: '/path/to/state',
      }

      const result = FirstPromptSummaryPayloadSchema.safeParse(payload)
      expect(result.success).toBe(true)
    })

    it('should accept payload with resumeContext', () => {
      const payload = {
        sessionId: 'session-456',
        userPrompt: 'Continue where we left off',
        stateDir: '/path/to/state',
        resumeContext: 'Implementing user authentication',
      }

      const result = FirstPromptSummaryPayloadSchema.safeParse(payload)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.resumeContext).toBe('Implementing user authentication')
      }
    })
  })

  describe('invalid payloads', () => {
    it('should reject missing sessionId', () => {
      const payload = {
        userPrompt: 'Help me',
        stateDir: '/path/to/state',
      }

      const result = FirstPromptSummaryPayloadSchema.safeParse(payload)
      expect(result.success).toBe(false)
    })

    it('should reject missing userPrompt', () => {
      const payload = {
        sessionId: 'session-123',
        stateDir: '/path/to/state',
      }

      const result = FirstPromptSummaryPayloadSchema.safeParse(payload)
      expect(result.success).toBe(false)
    })

    it('should reject missing stateDir', () => {
      const payload = {
        sessionId: 'session-123',
        userPrompt: 'Help me',
      }

      const result = FirstPromptSummaryPayloadSchema.safeParse(payload)
      expect(result.success).toBe(false)
    })

    it('should reject non-string values', () => {
      const payload = {
        sessionId: 123,
        userPrompt: 'Help me',
        stateDir: '/path/to/state',
      }

      const result = FirstPromptSummaryPayloadSchema.safeParse(payload)
      expect(result.success).toBe(false)
    })
  })
})

describe('FirstPromptSummaryStateSchema', () => {
  describe('valid states', () => {
    it('should accept minimal valid state (llm source)', () => {
      const state = {
        session_id: 'session-123',
        timestamp: '2024-01-15T10:30:00.000Z',
        message: 'Processing your request...',
        source: 'llm',
        model: 'claude-3-5-haiku',
        user_prompt: 'Help me fix a bug',
        had_resume_context: false,
      }

      const result = FirstPromptSummaryStateSchema.safeParse(state)
      expect(result.success).toBe(true)
    })

    it('should accept state with classification', () => {
      const state = {
        session_id: 'session-123',
        timestamp: '2024-01-15T10:30:00.000Z',
        message: 'Engaging problem-solving subroutines...',
        classification: 'actionable',
        source: 'llm',
        model: 'claude-3-5-haiku',
        latency_ms: 150,
        user_prompt: 'Refactor the database layer',
        had_resume_context: false,
      }

      const result = FirstPromptSummaryStateSchema.safeParse(state)
      expect(result.success).toBe(true)
    })

    it('should accept state with static source (no model)', () => {
      const state = {
        session_id: 'session-123',
        timestamp: '2024-01-15T10:30:00.000Z',
        message: 'Deciphering intent...',
        source: 'static',
        user_prompt: '/config',
        had_resume_context: false,
      }

      const result = FirstPromptSummaryStateSchema.safeParse(state)
      expect(result.success).toBe(true)
    })

    it('should accept state with fallback source', () => {
      const state = {
        session_id: 'session-123',
        timestamp: '2024-01-15T10:30:00.000Z',
        message: 'Deciphering intent...',
        source: 'fallback',
        user_prompt: 'Complex prompt here',
        had_resume_context: true,
      }

      const result = FirstPromptSummaryStateSchema.safeParse(state)
      expect(result.success).toBe(true)
    })
  })

  describe('classification validation', () => {
    const validClassifications = ['command', 'conversational', 'interrogative', 'ambiguous', 'actionable']

    it.each(validClassifications)('should accept classification: %s', (classification) => {
      const state = {
        session_id: 'session-123',
        timestamp: '2024-01-15T10:30:00.000Z',
        message: 'Test message',
        classification,
        source: 'llm',
        model: 'test-model',
        user_prompt: 'Test prompt',
        had_resume_context: false,
      }

      const result = FirstPromptSummaryStateSchema.safeParse(state)
      expect(result.success).toBe(true)
    })

    it('should reject invalid classification', () => {
      const state = {
        session_id: 'session-123',
        timestamp: '2024-01-15T10:30:00.000Z',
        message: 'Test message',
        classification: 'invalid_classification',
        source: 'llm',
        model: 'test-model',
        user_prompt: 'Test prompt',
        had_resume_context: false,
      }

      const result = FirstPromptSummaryStateSchema.safeParse(state)
      expect(result.success).toBe(false)
    })
  })

  describe('source validation', () => {
    it.each(['llm', 'static', 'fallback'])('should accept source: %s', (source) => {
      const state = {
        session_id: 'session-123',
        timestamp: '2024-01-15T10:30:00.000Z',
        message: 'Test message',
        source,
        user_prompt: 'Test prompt',
        had_resume_context: false,
      }

      const result = FirstPromptSummaryStateSchema.safeParse(state)
      expect(result.success).toBe(true)
    })

    it('should reject invalid source', () => {
      const state = {
        session_id: 'session-123',
        timestamp: '2024-01-15T10:30:00.000Z',
        message: 'Test message',
        source: 'invalid_source',
        user_prompt: 'Test prompt',
        had_resume_context: false,
      }

      const result = FirstPromptSummaryStateSchema.safeParse(state)
      expect(result.success).toBe(false)
    })
  })

  describe('invalid states', () => {
    it('should reject missing required fields', () => {
      const state = {
        session_id: 'session-123',
        // missing timestamp, message, source, user_prompt, had_resume_context
      }

      const result = FirstPromptSummaryStateSchema.safeParse(state)
      expect(result.success).toBe(false)
    })

    it('should reject non-boolean had_resume_context', () => {
      const state = {
        session_id: 'session-123',
        timestamp: '2024-01-15T10:30:00.000Z',
        message: 'Test message',
        source: 'llm',
        user_prompt: 'Test prompt',
        had_resume_context: 'yes', // should be boolean
      }

      const result = FirstPromptSummaryStateSchema.safeParse(state)
      expect(result.success).toBe(false)
    })

    it('should reject non-number latency_ms', () => {
      const state = {
        session_id: 'session-123',
        timestamp: '2024-01-15T10:30:00.000Z',
        message: 'Test message',
        source: 'llm',
        latency_ms: '150ms', // should be number
        user_prompt: 'Test prompt',
        had_resume_context: false,
      }

      const result = FirstPromptSummaryStateSchema.safeParse(state)
      expect(result.success).toBe(false)
    })
  })
})

describe('FirstPromptConfigSchema', () => {
  describe('default values', () => {
    it('should provide defaults when parsing empty object', () => {
      const result = FirstPromptConfigSchema.safeParse({})
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.enabled).toBe(true)
        expect(result.data.staticFallbackMessage).toBe('Deciphering intent...')
        expect(result.data.staticSkipMessage).toBeNull()
        expect(result.data.confidenceThreshold).toBe(0.6)
        expect(result.data.llmTimeoutMs).toBe(10000)
      }
    })

    it('should provide default model configuration', () => {
      const result = FirstPromptConfigSchema.safeParse({})
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.model.primary.provider).toBe('openrouter')
        expect(result.data.model.primary.model).toBe('x-ai/grok-4-fast')
        expect(result.data.model.fallback).not.toBeNull()
        expect(result.data.model.fallback?.provider).toBe('openrouter')
        expect(result.data.model.fallback?.model).toBe('google/gemini-2.5-flash-lite')
      }
    })

    it('should provide default skipCommands list', () => {
      const result = FirstPromptConfigSchema.safeParse({})
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skipCommands).toContain('help')
        expect(result.data.skipCommands).toContain('clear')
        expect(result.data.skipCommands).toContain('config')
        expect(result.data.skipCommands).toContain('vim')
        expect(result.data.skipCommands.length).toBeGreaterThan(30)
      }
    })
  })

  describe('valid configurations', () => {
    it('should accept partial overrides', () => {
      const config = {
        enabled: false,
        staticFallbackMessage: 'Custom fallback...',
      }

      const result = FirstPromptConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.enabled).toBe(false)
        expect(result.data.staticFallbackMessage).toBe('Custom fallback...')
        // Defaults should still apply for other fields
        expect(result.data.confidenceThreshold).toBe(0.6)
      }
    })

    it('should accept custom model configuration', () => {
      const config = {
        model: {
          primary: {
            provider: 'openai',
            model: 'gpt-4o-mini',
          },
          fallback: null,
        },
      }

      const result = FirstPromptConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.model.primary.provider).toBe('openai')
        expect(result.data.model.primary.model).toBe('gpt-4o-mini')
        expect(result.data.model.fallback).toBeNull()
      }
    })

    it('should accept custom skipCommands', () => {
      const config = {
        skipCommands: ['help', 'exit', 'custom-meta-command'],
      }

      const result = FirstPromptConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skipCommands).toEqual(['help', 'exit', 'custom-meta-command'])
      }
    })

    it('should accept staticSkipMessage string', () => {
      const config = {
        staticSkipMessage: 'Configuring settings...',
      }

      const result = FirstPromptConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.staticSkipMessage).toBe('Configuring settings...')
      }
    })
  })

  describe('invalid configurations', () => {
    it('should reject invalid provider', () => {
      const config = {
        model: {
          primary: {
            provider: 'invalid-provider',
            model: 'test',
          },
        },
      }

      const result = FirstPromptConfigSchema.safeParse(config)
      expect(result.success).toBe(false)
    })

    it('should reject non-boolean enabled', () => {
      const config = {
        enabled: 'true',
      }

      const result = FirstPromptConfigSchema.safeParse(config)
      expect(result.success).toBe(false)
    })

    it('should reject non-array skipCommands', () => {
      const config = {
        skipCommands: 'help,exit,clear',
      }

      const result = FirstPromptConfigSchema.safeParse(config)
      expect(result.success).toBe(false)
    })
  })
})

describe('DEFAULT_FIRST_PROMPT_CONFIG', () => {
  it('should match documented defaults from design doc §5.3', () => {
    expect(DEFAULT_FIRST_PROMPT_CONFIG.enabled).toBe(true)
    expect(DEFAULT_FIRST_PROMPT_CONFIG.model.primary.provider).toBe('openrouter')
    expect(DEFAULT_FIRST_PROMPT_CONFIG.model.primary.model).toBe('x-ai/grok-4-fast')
    expect(DEFAULT_FIRST_PROMPT_CONFIG.model.fallback?.provider).toBe('openrouter')
    expect(DEFAULT_FIRST_PROMPT_CONFIG.model.fallback?.model).toBe('google/gemini-2.5-flash-lite')
    expect(DEFAULT_FIRST_PROMPT_CONFIG.staticFallbackMessage).toBe('Deciphering intent...')
    expect(DEFAULT_FIRST_PROMPT_CONFIG.staticSkipMessage).toBeNull()
    expect(DEFAULT_FIRST_PROMPT_CONFIG.confidenceThreshold).toBe(0.6)
  })

  it('should contain all documented skip commands', () => {
    const documentedSkipCommands = [
      'add-dir',
      'agents',
      'bashes',
      'bug',
      'clear',
      'compact',
      'config',
      'context',
      'cost',
      'doctor',
      'exit',
      'export',
      'help',
      'hooks',
      'ide',
      'install-github-app',
      'login',
      'logout',
      'mcp',
      'memory',
      'output-style',
      'permissions',
      'plugin',
      'pr-comments',
      'privacy-settings',
      'release-notes',
      'resume',
      'rewind',
      'sandbox',
      'security-review',
      'stats',
      'status',
      'statusline',
      'terminal-setup',
      'todos',
      'usage',
      'vim',
    ]

    for (const cmd of documentedSkipCommands) {
      expect(DEFAULT_FIRST_PROMPT_CONFIG.skipCommands).toContain(cmd)
    }
  })
})

describe('classifyPrompt with custom skipCommands', () => {
  it('should use provided skipCommands set', () => {
    const customSkipCommands = new Set(['custom-skip', 'another-skip'])

    // Custom command in set should be skipped
    expect(classifyPrompt('/custom-skip', customSkipCommands)).toBe('skip')
    expect(classifyPrompt('/another-skip', customSkipCommands)).toBe('skip')

    // Default skip command NOT in custom set should go to LLM
    expect(classifyPrompt('/help', customSkipCommands)).toBe('llm')
    expect(classifyPrompt('/config', customSkipCommands)).toBe('llm')
  })

  it('should fall back to defaults when skipCommands not provided', () => {
    // Default behavior when no skipCommands provided
    expect(classifyPrompt('/help')).toBe('skip')
    expect(classifyPrompt('/config')).toBe('skip')
    expect(classifyPrompt('/init')).toBe('llm')
  })

  it('should handle empty skipCommands set', () => {
    const emptySkipCommands = new Set<string>()

    // With empty set, all slash commands should go to LLM
    expect(classifyPrompt('/help', emptySkipCommands)).toBe('llm')
    expect(classifyPrompt('/config', emptySkipCommands)).toBe('llm')
    expect(classifyPrompt('/clear', emptySkipCommands)).toBe('llm')
  })
})

describe('generateWithLLM', () => {
  // Note: Integration tests for generateWithLLM with real providers are excluded
  // by default (expensive API calls) per AGENTS.md LLM test isolation constraint.
  // These tests validate the function signature and exported interface.

  it('should export generateWithLLM function', () => {
    // Verify the function is exported and has the expected signature
    expect(typeof generateWithLLM).toBe('function')
    expect(generateWithLLM.length).toBe(5) // 5 parameters (userPrompt, resumeContext, config, logger, signal?)
  })
})
