import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createFakeLogger } from '@sidekick/testing-fixtures'
import { loadUserProfile } from '../user-profile-loader'

const TEST_HOME = join(process.cwd(), 'tmp-test-home')
const SIDEKICK_DIR = join(TEST_HOME, '.sidekick')

describe('loadUserProfile', () => {
  beforeEach(() => {
    mkdirSync(SIDEKICK_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true })
  })

  it('returns null when file does not exist', () => {
    const result = loadUserProfile({ homeDir: TEST_HOME })
    expect(result).toBeNull()
  })

  it('loads valid user profile', () => {
    writeFileSync(
      join(SIDEKICK_DIR, 'user.yaml'),
      `
name: "Scott"
role: "Software Architect"
interests:
  - "Sci-Fi"
  - "80s sitcoms"
`
    )
    const result = loadUserProfile({ homeDir: TEST_HOME })
    expect(result).toEqual({
      name: 'Scott',
      role: 'Software Architect',
      interests: ['Sci-Fi', '80s sitcoms'],
    })
  })

  it('returns null and logs warning for malformed YAML', () => {
    writeFileSync(join(SIDEKICK_DIR, 'user.yaml'), '{{{{not yaml')
    const logger = createFakeLogger()
    const result = loadUserProfile({ homeDir: TEST_HOME, logger })
    expect(result).toBeNull()
    expect(logger.warn.mock.calls.length).toBeGreaterThan(0)
  })

  it('returns null and logs warning for missing required fields', () => {
    writeFileSync(
      join(SIDEKICK_DIR, 'user.yaml'),
      `
name: "Scott"
`
    )
    const logger = createFakeLogger()
    const result = loadUserProfile({ homeDir: TEST_HOME, logger })
    expect(result).toBeNull()
    expect(logger.warn.mock.calls.length).toBeGreaterThan(0)
  })

  it('returns null when ~/.sidekick/ directory does not exist', () => {
    rmSync(SIDEKICK_DIR, { recursive: true, force: true })
    const result = loadUserProfile({ homeDir: TEST_HOME })
    expect(result).toBeNull()
  })
})
