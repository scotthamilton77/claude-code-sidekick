import { describe, it, expect } from 'vitest'
import { ToolPatternSchema, VerificationToolConfigSchema, DEFAULT_VERIFICATION_TOOLS } from '../types.js'

describe('ToolPatternSchema', () => {
  it('validates a complete tool pattern', () => {
    const result = ToolPatternSchema.safeParse({
      tool_id: 'pnpm-build',
      tool: 'pnpm build',
      scope: 'project',
    })
    expect(result.success).toBe(true)
  })

  it('defaults scope to project', () => {
    const result = ToolPatternSchema.parse({
      tool_id: 'tsc',
      tool: 'tsc',
    })
    expect(result.scope).toBe('project')
  })

  it('accepts null tool (disabled pattern)', () => {
    const result = ToolPatternSchema.safeParse({
      tool_id: 'esbuild',
      tool: null,
      scope: 'file',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing tool_id', () => {
    const result = ToolPatternSchema.safeParse({ tool: 'pnpm build' })
    expect(result.success).toBe(false)
  })

  it('validates scope enum', () => {
    const result = ToolPatternSchema.safeParse({
      tool_id: 'x',
      tool: 'x',
      scope: 'invalid',
    })
    expect(result.success).toBe(false)
  })
})

describe('VerificationToolConfig', () => {
  it('validates a well-formed tool config', () => {
    const config = {
      enabled: true,
      patterns: [{ tool_id: 'pnpm-build', tool: 'pnpm build', scope: 'project' }],
      clearing_threshold: 3,
      clearing_patterns: ['**/*.ts'],
    }
    const result = VerificationToolConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
  })

  it('rejects config missing required fields', () => {
    const result = VerificationToolConfigSchema.safeParse({ enabled: true })
    expect(result.success).toBe(false)
  })

  it('rejects empty patterns array', () => {
    const config = {
      enabled: true,
      patterns: [],
      clearing_threshold: 3,
      clearing_patterns: ['**/*.ts'],
    }
    const result = VerificationToolConfigSchema.safeParse(config)
    expect(result.success).toBe(false)
  })

  it('rejects non-positive clearing_threshold', () => {
    const config = {
      enabled: true,
      patterns: [{ tool_id: 'x', tool: 'x', scope: 'project' }],
      clearing_threshold: 0,
      clearing_patterns: ['**/*.ts'],
    }
    const result = VerificationToolConfigSchema.safeParse(config)
    expect(result.success).toBe(false)
  })

  it('provides sensible defaults for all tool categories', () => {
    expect(DEFAULT_VERIFICATION_TOOLS).toHaveProperty('build')
    expect(DEFAULT_VERIFICATION_TOOLS).toHaveProperty('typecheck')
    expect(DEFAULT_VERIFICATION_TOOLS).toHaveProperty('test')
    expect(DEFAULT_VERIFICATION_TOOLS).toHaveProperty('lint')
    expect(DEFAULT_VERIFICATION_TOOLS.build.patterns.length).toBeGreaterThan(0)
    expect(DEFAULT_VERIFICATION_TOOLS.build.clearing_threshold).toBeGreaterThan(0)
  })

  it('validates each default tool config against the schema', () => {
    for (const [name, config] of Object.entries(DEFAULT_VERIFICATION_TOOLS)) {
      const result = VerificationToolConfigSchema.safeParse(config)
      expect(result.success, `Default config for '${name}' should be valid`).toBe(true)
    }
  })
})
