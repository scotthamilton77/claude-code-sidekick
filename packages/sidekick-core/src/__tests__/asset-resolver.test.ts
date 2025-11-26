import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createAssetResolver, type AssetResolverOptions } from '../assets'

describe('AssetResolver', () => {
  const tempRoot = join(tmpdir(), 'sidekick-asset-tests')
  const defaultAssetsDir = join(tempRoot, 'assets', 'sidekick')

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true })
    // Create default assets directory structure
    mkdirSync(join(defaultAssetsDir, 'prompts'), { recursive: true })
    mkdirSync(join(defaultAssetsDir, 'schemas'), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('returns default asset when no overrides exist', () => {
    writeFileSync(join(defaultAssetsDir, 'prompts', 'session-summary.prompt.txt'), 'Default prompt')

    const resolver = createAssetResolver({
      defaultAssetsDir,
      projectRoot: join(tempRoot, 'empty-project'),
      homeDir: join(tempRoot, 'empty-home'),
    })

    const content = resolver.resolve('prompts/session-summary.prompt.txt')

    expect(content).toBe('Default prompt')
  })

  test('user-persistent override takes precedence over defaults', () => {
    writeFileSync(join(defaultAssetsDir, 'prompts', 'test.prompt.txt'), 'Default')

    const homeDir = join(tempRoot, 'home')
    const userAssets = join(homeDir, '.sidekick', 'assets')
    mkdirSync(join(userAssets, 'prompts'), { recursive: true })
    writeFileSync(join(userAssets, 'prompts', 'test.prompt.txt'), 'User override')

    const resolver = createAssetResolver({
      defaultAssetsDir,
      projectRoot: undefined,
      homeDir,
    })

    const content = resolver.resolve('prompts/test.prompt.txt')

    expect(content).toBe('User override')
  })

  test('project-persistent override takes precedence over user', () => {
    writeFileSync(join(defaultAssetsDir, 'prompts', 'test.prompt.txt'), 'Default')

    const homeDir = join(tempRoot, 'home')
    const userAssets = join(homeDir, '.sidekick', 'assets')
    mkdirSync(join(userAssets, 'prompts'), { recursive: true })
    writeFileSync(join(userAssets, 'prompts', 'test.prompt.txt'), 'User override')

    const projectDir = join(tempRoot, 'project')
    const projectAssets = join(projectDir, '.sidekick', 'assets')
    mkdirSync(join(projectAssets, 'prompts'), { recursive: true })
    writeFileSync(join(projectAssets, 'prompts', 'test.prompt.txt'), 'Project override')

    const resolver = createAssetResolver({
      defaultAssetsDir,
      projectRoot: projectDir,
      homeDir,
    })

    const content = resolver.resolve('prompts/test.prompt.txt')

    expect(content).toBe('Project override')
  })

  test('project-local .local override has highest priority', () => {
    writeFileSync(join(defaultAssetsDir, 'prompts', 'test.prompt.txt'), 'Default')

    const projectDir = join(tempRoot, 'project')
    const projectAssets = join(projectDir, '.sidekick', 'assets')
    const localAssets = join(projectDir, '.sidekick', 'assets.local')
    mkdirSync(join(projectAssets, 'prompts'), { recursive: true })
    mkdirSync(join(localAssets, 'prompts'), { recursive: true })
    writeFileSync(join(projectAssets, 'prompts', 'test.prompt.txt'), 'Project')
    writeFileSync(join(localAssets, 'prompts', 'test.prompt.txt'), 'Local')

    const resolver = createAssetResolver({
      defaultAssetsDir,
      projectRoot: projectDir,
      homeDir: join(tempRoot, 'home'),
    })

    const content = resolver.resolve('prompts/test.prompt.txt')

    expect(content).toBe('Local')
  })

  test('returns null when asset not found anywhere', () => {
    const resolver = createAssetResolver({
      defaultAssetsDir,
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
    })

    const content = resolver.resolve('prompts/nonexistent.prompt.txt')

    expect(content).toBeNull()
  })

  test('resolveOrThrow throws when asset not found', () => {
    const resolver = createAssetResolver({
      defaultAssetsDir,
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
    })

    expect(() => resolver.resolveOrThrow('prompts/nonexistent.prompt.txt')).toThrow(/not found/i)
  })

  test('resolvePath returns path to the asset without reading', () => {
    writeFileSync(join(defaultAssetsDir, 'schemas', 'config.json'), '{}')

    const resolver = createAssetResolver({
      defaultAssetsDir,
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
    })

    const assetPath = resolver.resolvePath('schemas/config.json')

    expect(assetPath).toBe(join(defaultAssetsDir, 'schemas', 'config.json'))
    expect(existsSync(assetPath!)).toBe(true)
  })

  test('resolveJson parses JSON/JSONC content', () => {
    writeFileSync(
      join(defaultAssetsDir, 'schemas', 'test.json'),
      `{
  // This is a comment
  "name": "test",
  "version": 1
}`
    )

    const resolver = createAssetResolver({
      defaultAssetsDir,
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
    })

    const data = resolver.resolveJson('schemas/test.json')

    expect(data).toEqual({ name: 'test', version: 1 })
  })

  test('exposes cascade layers for debugging', () => {
    const projectDir = join(tempRoot, 'project')
    const homeDir = join(tempRoot, 'home')

    const resolver = createAssetResolver({
      defaultAssetsDir,
      projectRoot: projectDir,
      homeDir,
    })

    expect(resolver.cascadeLayers).toContain(defaultAssetsDir)
    expect(resolver.cascadeLayers).toContainEqual(expect.stringContaining('.sidekick'))
  })

  test('handles user-scope without project root', () => {
    writeFileSync(join(defaultAssetsDir, 'prompts', 'test.prompt.txt'), 'Default')

    const homeDir = join(tempRoot, 'home')
    const userAssets = join(homeDir, '.sidekick', 'assets')
    mkdirSync(join(userAssets, 'prompts'), { recursive: true })
    writeFileSync(join(userAssets, 'prompts', 'test.prompt.txt'), 'User override')

    const resolver = createAssetResolver({
      defaultAssetsDir,
      projectRoot: undefined,
      homeDir,
    })

    const content = resolver.resolve('prompts/test.prompt.txt')

    expect(content).toBe('User override')
  })
})
