/**
 * @fileoverview Tests for FeatureRegistry - manages feature lifecycle and dependency resolution
 */

import { describe, expect, test, beforeEach } from 'vitest'
import type { Feature, FeatureManifest } from '../feature-types'
import { FeatureRegistry } from '../feature-registry'

// Helper to create test features
function createFeature(id: string, needs?: string[]): Feature {
  const manifest: FeatureManifest = {
    id,
    version: '1.0.0',
    description: `Test feature ${id}`,
    needs,
  }
  return {
    manifest,
    register: () => {}, // No-op for tests
  }
}

describe('FeatureRegistry', () => {
  let registry: FeatureRegistry

  beforeEach(() => {
    registry = new FeatureRegistry()
  })

  test('registers features and retrieves by id', () => {
    const featureA = createFeature('feature-a')
    const featureB = createFeature('feature-b')

    registry.register(featureA)
    registry.register(featureB)

    expect(registry.get('feature-a')).toBe(featureA)
    expect(registry.get('feature-b')).toBe(featureB)
    expect(registry.get('nonexistent')).toBeUndefined()
  })

  test('getAll returns all registered features', () => {
    const featureA = createFeature('feature-a')
    const featureB = createFeature('feature-b')

    registry.register(featureA)
    registry.register(featureB)

    const all = registry.getAll()
    expect(all).toHaveLength(2)
    expect(all).toContain(featureA)
    expect(all).toContain(featureB)
  })

  test('prevents duplicate feature registration', () => {
    const featureA = createFeature('feature-a')

    registry.register(featureA)

    expect(() => registry.register(featureA)).toThrow(/already registered/)
  })

  test('validates missing dependency throws DependencyError', () => {
    const featureA = createFeature('feature-a', ['missing-dep'])
    registry.register(featureA)

    expect(() => registry.validateDependencies()).toThrow(/missing.*missing-dep/)
  })

  test('validates cycle throws CycleError with path', () => {
    // Create cycle: A -> B -> C -> A
    const featureA = createFeature('feature-a', ['feature-c'])
    const featureB = createFeature('feature-b', ['feature-a'])
    const featureC = createFeature('feature-c', ['feature-b'])

    registry.register(featureA)
    registry.register(featureB)
    registry.register(featureC)

    expect(() => registry.validateDependencies()).toThrow(/Circular dependency/)
    try {
      registry.validateDependencies()
    } catch (err: any) {
      expect(err.message).toContain('feature-a')
      expect(err.message).toContain('feature-c')
      expect(err.message).toContain('feature-b')
    }
  })

  test('handles features with no dependencies', () => {
    const featureA = createFeature('feature-a')
    const featureB = createFeature('feature-b')

    registry.register(featureA)
    registry.register(featureB)

    registry.validateDependencies() // Should not throw

    const order = registry.getLoadOrder()
    expect(order).toHaveLength(2)
    // Both features should be present (order may vary for independent features)
    expect(order.map((f) => f.manifest.id).sort()).toEqual(['feature-a', 'feature-b'])
  })

  test('returns correct topological order', () => {
    // B depends on A, C depends on B
    const featureA = createFeature('feature-a')
    const featureB = createFeature('feature-b', ['feature-a'])
    const featureC = createFeature('feature-c', ['feature-b'])

    registry.register(featureC)
    registry.register(featureA)
    registry.register(featureB)

    registry.validateDependencies() // Must validate before getting load order

    const order = registry.getLoadOrder()
    const ids = order.map((f) => f.manifest.id)

    // A must come before B, B must come before C
    expect(ids.indexOf('feature-a')).toBeLessThan(ids.indexOf('feature-b'))
    expect(ids.indexOf('feature-b')).toBeLessThan(ids.indexOf('feature-c'))
  })

  test('handles diamond dependency pattern correctly', () => {
    // Diamond: D depends on B and C, both B and C depend on A
    //     A
    //    / \
    //   B   C
    //    \ /
    //     D
    const featureA = createFeature('feature-a')
    const featureB = createFeature('feature-b', ['feature-a'])
    const featureC = createFeature('feature-c', ['feature-a'])
    const featureD = createFeature('feature-d', ['feature-b', 'feature-c'])

    registry.register(featureD)
    registry.register(featureC)
    registry.register(featureB)
    registry.register(featureA)

    registry.validateDependencies() // Must validate before getting load order

    const order = registry.getLoadOrder()
    const ids = order.map((f) => f.manifest.id)

    // A must come before B and C
    expect(ids.indexOf('feature-a')).toBeLessThan(ids.indexOf('feature-b'))
    expect(ids.indexOf('feature-a')).toBeLessThan(ids.indexOf('feature-c'))
    // B and C must come before D
    expect(ids.indexOf('feature-b')).toBeLessThan(ids.indexOf('feature-d'))
    expect(ids.indexOf('feature-c')).toBeLessThan(ids.indexOf('feature-d'))
  })

  test('detects self-dependency as cycle', () => {
    const featureA = createFeature('feature-a', ['feature-a'])
    registry.register(featureA)

    expect(() => registry.validateDependencies()).toThrow(/Circular dependency/)
  })

  test('validateDependencies succeeds with valid graph', () => {
    const featureA = createFeature('feature-a')
    const featureB = createFeature('feature-b', ['feature-a'])

    registry.register(featureA)
    registry.register(featureB)

    // Should not throw
    expect(() => registry.validateDependencies()).not.toThrow()
  })

  test('getLoadOrder throws if dependencies not validated', () => {
    const featureA = createFeature('feature-a', ['missing'])
    registry.register(featureA)

    // Should throw because validation hasn't been run
    expect(() => registry.getLoadOrder()).toThrow(/Must call validateDependencies/)
  })

  test('getLoadOrder returns empty array for empty registry', () => {
    registry.validateDependencies() // No features, validation succeeds
    expect(registry.getLoadOrder()).toEqual([])
  })
})
