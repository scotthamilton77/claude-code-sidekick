import { describe, it, expect } from 'vitest'
import { CommandRunnerSchema } from '../types.js'

describe('CommandRunnerSchema', () => {
  it('accepts valid runner with prefix', () => {
    const result = CommandRunnerSchema.safeParse({ prefix: 'uv run' })
    expect(result.success).toBe(true)
  })

  it('accepts single-token prefix', () => {
    const result = CommandRunnerSchema.safeParse({ prefix: 'npx' })
    expect(result.success).toBe(true)
  })

  it('rejects empty prefix', () => {
    const result = CommandRunnerSchema.safeParse({ prefix: '' })
    expect(result.success).toBe(false)
  })

  it('rejects missing prefix', () => {
    const result = CommandRunnerSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})
