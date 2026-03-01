import { describe, it, expect } from 'vitest'
import { UserProfileSchema } from '../user-profile'

describe('UserProfileSchema', () => {
  it('parses valid profile', () => {
    const result = UserProfileSchema.safeParse({
      name: 'Scott',
      role: 'Software Architect',
      interests: ['Sci-Fi', '80s sitcoms'],
    })
    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      name: 'Scott',
      role: 'Software Architect',
      interests: ['Sci-Fi', '80s sitcoms'],
    })
  })

  it('rejects missing name', () => {
    const result = UserProfileSchema.safeParse({ role: 'Dev', interests: [] })
    expect(result.success).toBe(false)
  })

  it('rejects missing role', () => {
    const result = UserProfileSchema.safeParse({ name: 'Scott', interests: [] })
    expect(result.success).toBe(false)
  })

  it('rejects missing interests', () => {
    const result = UserProfileSchema.safeParse({ name: 'Scott', role: 'Dev' })
    expect(result.success).toBe(false)
  })

  it('rejects non-string interests', () => {
    const result = UserProfileSchema.safeParse({ name: 'Scott', role: 'Dev', interests: [42] })
    expect(result.success).toBe(false)
  })
})
