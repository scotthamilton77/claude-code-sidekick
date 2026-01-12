import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { resolveScope } from '../scope'

describe('resolveScope', () => {
  const tempRoot = join(process.cwd(), 'tmp-scope-tests')

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  // ==========================================================================
  // Scope override tests
  // ==========================================================================

  test('uses scope override when provided as project', () => {
    const projectDir = join(tempRoot, 'my-project')
    mkdirSync(projectDir, { recursive: true })

    const result = resolveScope({
      scopeOverride: 'project',
      projectDir,
    })

    expect(result.scope).toBe('project')
    expect(result.source).toBe('override')
    expect(result.projectRoot).toBe(projectDir)
    expect(result.dualInstallDetected).toBe(false)
    expect(result.warnings).toHaveLength(0)
  })

  test('uses scope override when provided as user', () => {
    const result = resolveScope({
      scopeOverride: 'user',
      projectDir: join(tempRoot, 'some-project'),
    })

    expect(result.scope).toBe('user')
    expect(result.source).toBe('override')
    expect(result.projectRoot).toBeUndefined()
    expect(result.dualInstallDetected).toBe(false)
  })

  test('scope override ignores hook script path', () => {
    const projectDir = join(tempRoot, 'project')
    const hookPath = join(projectDir, '.claude', 'hooks', 'sidekick', 'session-start')
    mkdirSync(join(projectDir, '.claude', 'hooks', 'sidekick'), { recursive: true })

    const result = resolveScope({
      scopeOverride: 'user',
      hookScriptPath: hookPath,
    })

    expect(result.scope).toBe('user')
    expect(result.source).toBe('override')
    expect(result.hookScriptPath).toBe(hookPath)
  })

  // ==========================================================================
  // normalizeDir fallback tests (non-existent paths)
  // ==========================================================================

  test('handles non-existent homeDir gracefully', () => {
    const nonExistentHome = join(tempRoot, 'non-existent-home-path-xyz')

    const result = resolveScope({
      homeDir: nonExistentHome,
    })

    expect(result.scope).toBe('user')
    expect(result.source).toBe('default')
  })

  // ==========================================================================
  // normalizeHookPath fallback test (broken symlink)
  // ==========================================================================

  test('handles hook script path that cannot be resolved', () => {
    const nonExistentPath = join(tempRoot, 'broken', 'link', 'to', 'hook')

    const result = resolveScope({
      hookScriptPath: nonExistentPath,
    })

    expect(result.scope).toBe('user')
    expect(result.source).toBe('default')
  })

  // ==========================================================================
  // Project scope detection tests
  // ==========================================================================

  test('detects project scope from hook path', () => {
    const projectDir = join(tempRoot, 'project')
    const hookPath = join(projectDir, '.claude', 'hooks', 'sidekick', 'session-start')
    mkdirSync(join(projectDir, '.claude', 'hooks', 'sidekick'), { recursive: true })

    const result = resolveScope({ hookScriptPath: hookPath })

    expect(result.scope).toBe('project')
    expect(result.projectRoot).toBe(projectDir)
    expect(result.source).toBe('hook-script-path')
  })

  test('detects user scope when hook is under home directory', () => {
    const homeDir = join(tempRoot, 'home')
    const hookPath = join(homeDir, '.claude', 'hooks', 'sidekick', 'session-start')
    mkdirSync(join(homeDir, '.claude', 'hooks', 'sidekick'), { recursive: true })

    const result = resolveScope({ hookScriptPath: hookPath, homeDir })

    expect(result.scope).toBe('user')
    expect(result.projectRoot).toBeUndefined()
    expect(result.source).toBe('hook-script-path')
  })

  test('walks up from cwd to find project scope', () => {
    const projectDir = join(tempRoot, 'walked-project')
    const nestedDir = join(projectDir, 'src', 'feature')
    mkdirSync(join(projectDir, '.claude', 'hooks', 'sidekick'), { recursive: true })
    mkdirSync(nestedDir, { recursive: true })

    const result = resolveScope({ cwd: nestedDir })

    expect(result.scope).toBe('project')
    expect(result.projectRoot).toBe(projectDir)
    expect(result.source).toBe('cwd-fallback')
  })

  test('emits warning when project hint mismatches hook path derived root', () => {
    const projectDir = join(tempRoot, 'project-one')
    const otherDir = join(tempRoot, 'project-two')
    const hookPath = join(projectDir, '.claude', 'hooks', 'sidekick', 'session-start')
    mkdirSync(join(projectDir, '.claude', 'hooks', 'sidekick'), { recursive: true })

    const result = resolveScope({ hookScriptPath: hookPath, projectDir: otherDir })

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('does not match')
  })

  test('reports dual installation when project settings mention sidekick', () => {
    const projectDir = join(tempRoot, 'project-dual')
    const settingsPath = join(projectDir, '.claude')
    mkdirSync(settingsPath, { recursive: true })
    writeFileSync(join(settingsPath, 'settings.json'), '{"hooks": ["sidekick"]}')

    const hookPath = join(tempRoot, 'home', '.claude', 'hooks', 'sidekick', 'session-start')
    mkdirSync(join(tempRoot, 'home', '.claude', 'hooks', 'sidekick'), { recursive: true })

    const result = resolveScope({
      hookScriptPath: hookPath,
      projectDir,
      homeDir: join(tempRoot, 'home'),
    })

    expect(result.scope).toBe('user')
    expect(result.dualInstallDetected).toBe(true)
  })
})
