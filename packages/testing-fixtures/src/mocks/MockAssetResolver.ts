/**
 * Mock Asset Resolver for Testing
 *
 * Provides an in-memory asset resolver for testing without file I/O.
 * Allows registering assets and simulating cascade behavior.
 *
 * @example
 * ```typescript
 * const assets = new MockAssetResolver();
 * assets.register('prompts/test.txt', 'Test prompt content');
 * expect(assets.resolve('prompts/test.txt')).toBe('Test prompt content');
 * ```
 */

import type { AssetResolver } from '@sidekick/core'
import { toErrorMessage } from '@sidekick/core'
import { parse as parseYaml } from 'yaml'

export class MockAssetResolver implements AssetResolver {
  private assets = new Map<string, string>()
  public cascadeLayers: string[] = ['/mock/assets']

  /**
   * Register an asset with content.
   */
  register(relativePath: string, content: string): void {
    this.assets.set(relativePath, content)
  }

  /**
   * Register multiple assets at once.
   */
  registerAll(assets: Record<string, string>): void {
    for (const [path, content] of Object.entries(assets)) {
      this.register(path, content)
    }
  }

  resolve(relativePath: string): string | null {
    return this.assets.get(relativePath) ?? null
  }

  resolveOrThrow(relativePath: string): string {
    const content = this.resolve(relativePath)
    if (content === null) {
      throw new Error(`Asset not found: ${relativePath}`)
    }
    return content
  }

  resolvePath(relativePath: string): string | null {
    if (this.assets.has(relativePath)) {
      return `/mock/assets/${relativePath}`
    }
    return null
  }

  resolveJson<T = unknown>(relativePath: string): T | null {
    const content = this.resolve(relativePath)
    if (content === null) {
      return null
    }
    return JSON.parse(content) as T
  }

  resolveYaml<T = unknown>(relativePath: string): T | null {
    const content = this.resolve(relativePath)
    if (content === null) {
      return null
    }
    try {
      return parseYaml(content) as T
    } catch (error) {
      throw new Error(`Failed to parse YAML asset ${relativePath}: ${toErrorMessage(error)}`, { cause: error })
    }
  }

  /**
   * Reset all registered assets.
   */
  reset(): void {
    this.assets.clear()
  }

  /**
   * Check if an asset is registered.
   */
  has(relativePath: string): boolean {
    return this.assets.has(relativePath)
  }
}
