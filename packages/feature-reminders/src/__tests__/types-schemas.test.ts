/**
 * Runtime validation tests for feature-reminders Zod schemas.
 *
 * Covers VerificationToolsMapSchema, throttle schemas, and DEFAULT_VERIFICATION_TOOLS shape.
 * Complements existing command-runner-schema.test.ts and verification-tool-config.test.ts.
 *
 * @see packages/feature-reminders/src/types.ts
 */

import { describe, expect, it } from 'vitest'
import {
  ToolPatternScopeSchema,
  ToolPatternSchema,
  VerificationToolConfigSchema,
  VerificationToolsMapSchema,
  CommandRunnerSchema,
  DEFAULT_VERIFICATION_TOOLS,
  DEFAULT_REMINDERS_SETTINGS,
} from '../types.js'

// ============================================================================
// ToolPatternScopeSchema
// ============================================================================

describe('ToolPatternScopeSchema', () => {
  it('accepts "project"', () => {
    expect(ToolPatternScopeSchema.safeParse('project').success).toBe(true)
  })

  it('accepts "package"', () => {
    expect(ToolPatternScopeSchema.safeParse('package').success).toBe(true)
  })

  it('accepts "file"', () => {
    expect(ToolPatternScopeSchema.safeParse('file').success).toBe(true)
  })

  it('rejects invalid scope', () => {
    expect(ToolPatternScopeSchema.safeParse('workspace').success).toBe(false)
  })
})

// ============================================================================
// ToolPatternSchema
// ============================================================================

describe('ToolPatternSchema', () => {
  it('accepts valid pattern with defaults', () => {
    const result = ToolPatternSchema.safeParse({
      tool_id: 'tsc',
      tool: 'tsc',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      // scope defaults to 'project'
      expect(result.data.scope).toBe('project')
    }
  })

  it('accepts null tool (catch-all pattern)', () => {
    const result = ToolPatternSchema.safeParse({
      tool_id: 'catch-all',
      tool: null,
      scope: 'file',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tool).toBeNull()
    }
  })

  it('rejects missing tool_id', () => {
    const result = ToolPatternSchema.safeParse({
      tool: 'tsc',
      scope: 'project',
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// VerificationToolConfigSchema
// ============================================================================

describe('VerificationToolConfigSchema', () => {
  const validConfig = {
    enabled: true,
    patterns: [{ tool_id: 'tsc', tool: 'tsc', scope: 'project' as const }],
    clearing_threshold: 3,
    clearing_patterns: ['**/*.ts'],
  }

  it('accepts valid config', () => {
    const result = VerificationToolConfigSchema.safeParse(validConfig)
    expect(result.success).toBe(true)
  })

  it('rejects empty patterns array', () => {
    const result = VerificationToolConfigSchema.safeParse({
      ...validConfig,
      patterns: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty clearing_patterns array', () => {
    const result = VerificationToolConfigSchema.safeParse({
      ...validConfig,
      clearing_patterns: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects zero clearing_threshold', () => {
    const result = VerificationToolConfigSchema.safeParse({
      ...validConfig,
      clearing_threshold: 0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative clearing_threshold', () => {
    const result = VerificationToolConfigSchema.safeParse({
      ...validConfig,
      clearing_threshold: -1,
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-integer clearing_threshold', () => {
    const result = VerificationToolConfigSchema.safeParse({
      ...validConfig,
      clearing_threshold: 2.5,
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// VerificationToolsMapSchema
// ============================================================================

describe('VerificationToolsMapSchema', () => {
  it('accepts a record of tool configs', () => {
    const result = VerificationToolsMapSchema.safeParse({
      build: {
        enabled: true,
        patterns: [{ tool_id: 'tsc', tool: 'tsc', scope: 'project' }],
        clearing_threshold: 3,
        clearing_patterns: ['**/*.ts'],
      },
      test: {
        enabled: false,
        patterns: [{ tool_id: 'vitest', tool: 'vitest', scope: 'project' }],
        clearing_threshold: 5,
        clearing_patterns: ['**/*.test.ts'],
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.build.enabled).toBe(true)
      expect(result.data.test.enabled).toBe(false)
    }
  })

  it('accepts empty map', () => {
    const result = VerificationToolsMapSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('rejects map with invalid config value', () => {
    const result = VerificationToolsMapSchema.safeParse({
      build: { enabled: 'yes' }, // invalid
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// CommandRunnerSchema
// ============================================================================

describe('CommandRunnerSchema', () => {
  it('accepts valid prefix', () => {
    const result = CommandRunnerSchema.safeParse({ prefix: 'npx' })
    expect(result.success).toBe(true)
  })

  it('trims whitespace', () => {
    const result = CommandRunnerSchema.safeParse({ prefix: '  pnpm exec  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.prefix).toBe('pnpm exec')
    }
  })

  it('rejects empty prefix', () => {
    const result = CommandRunnerSchema.safeParse({ prefix: '' })
    expect(result.success).toBe(false)
  })

  it('rejects whitespace-only prefix', () => {
    const result = CommandRunnerSchema.safeParse({ prefix: '   ' })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// DEFAULT_VERIFICATION_TOOLS shape validation
// ============================================================================

describe('DEFAULT_VERIFICATION_TOOLS', () => {
  it('validates against VerificationToolsMapSchema', () => {
    const result = VerificationToolsMapSchema.safeParse(DEFAULT_VERIFICATION_TOOLS)
    expect(result.success).toBe(true)
  })

  it('contains expected tool categories', () => {
    expect(DEFAULT_VERIFICATION_TOOLS).toHaveProperty('build')
    expect(DEFAULT_VERIFICATION_TOOLS).toHaveProperty('typecheck')
    expect(DEFAULT_VERIFICATION_TOOLS).toHaveProperty('test')
    expect(DEFAULT_VERIFICATION_TOOLS).toHaveProperty('lint')
  })

  it('has at least one pattern per tool', () => {
    for (const [name, config] of Object.entries(DEFAULT_VERIFICATION_TOOLS)) {
      expect(config.patterns.length).toBeGreaterThan(0)
      // Each pattern should have a tool_id
      for (const pattern of config.patterns) {
        expect(pattern.tool_id).toBeTruthy()
      }
    }
  })

  it('has all tools enabled by default', () => {
    for (const config of Object.values(DEFAULT_VERIFICATION_TOOLS)) {
      expect(config.enabled).toBe(true)
    }
  })

  it('has positive clearing thresholds', () => {
    for (const config of Object.values(DEFAULT_VERIFICATION_TOOLS)) {
      expect(config.clearing_threshold).toBeGreaterThan(0)
    }
  })

  it('has valid scopes for all patterns', () => {
    const validScopes = ['project', 'package', 'file']
    for (const config of Object.values(DEFAULT_VERIFICATION_TOOLS)) {
      for (const pattern of config.patterns) {
        expect(validScopes).toContain(pattern.scope)
      }
    }
  })
})

// ============================================================================
// DEFAULT_REMINDERS_SETTINGS shape validation
// ============================================================================

describe('DEFAULT_REMINDERS_SETTINGS', () => {
  it('has valid verification_tools', () => {
    expect(DEFAULT_REMINDERS_SETTINGS.verification_tools).toBeDefined()
    const result = VerificationToolsMapSchema.safeParse(DEFAULT_REMINDERS_SETTINGS.verification_tools)
    expect(result.success).toBe(true)
  })

  it('has valid command_runners', () => {
    expect(DEFAULT_REMINDERS_SETTINGS.command_runners).toBeDefined()
    for (const runner of DEFAULT_REMINDERS_SETTINGS.command_runners!) {
      const result = CommandRunnerSchema.safeParse(runner)
      expect(result.success).toBe(true)
    }
  })

  it('has positive pause_and_reflect_threshold', () => {
    expect(DEFAULT_REMINDERS_SETTINGS.pause_and_reflect_threshold).toBeGreaterThan(0)
  })

  it('has non-empty source_code_patterns', () => {
    expect(DEFAULT_REMINDERS_SETTINGS.source_code_patterns.length).toBeGreaterThan(0)
  })

  it('has reminder_thresholds with positive values', () => {
    expect(DEFAULT_REMINDERS_SETTINGS.reminder_thresholds).toBeDefined()
    for (const value of Object.values(DEFAULT_REMINDERS_SETTINGS.reminder_thresholds!)) {
      expect(value).toBeGreaterThan(0)
    }
  })
})
