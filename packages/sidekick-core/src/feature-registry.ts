/**
 * @fileoverview Feature Registry - manages feature lifecycle and dependency resolution
 * Phase 4 Track B: Feature Registry implementation
 *
 * Responsibilities:
 * - Register features and track dependencies
 * - Validate dependency graph (DAG) - detect cycles and missing deps
 * - Compute topological sort for load order
 * - Provide feature lookup by ID
 */

import type { Feature } from './feature-types'

/**
 * Error thrown when a feature declares a dependency that doesn't exist
 */
export class DependencyError extends Error {
  constructor(featureId: string, missingDep: string) {
    super(`Feature "${featureId}" depends on missing feature "${missingDep}"`)
    this.name = 'DependencyError'
  }
}

/**
 * Error thrown when circular dependencies are detected
 */
export class CycleError extends Error {
  constructor(cyclePath: string[]) {
    super(`Circular dependency detected: ${cyclePath.join(' -> ')}`)
    this.name = 'CycleError'
  }
}

/**
 * Registry for managing feature lifecycle and dependencies
 */
export class FeatureRegistry {
  private features = new Map<string, Feature>()
  private validated = false

  /**
   * Register a feature
   * @throws Error if feature with same ID already registered
   */
  register(feature: Feature): void {
    const { id } = feature.manifest
    if (this.features.has(id)) {
      throw new Error(`Feature "${id}" is already registered`)
    }
    this.features.set(id, feature)
    this.validated = false // Invalidate validation cache
  }

  /**
   * Get a feature by ID
   */
  get(id: string): Feature | undefined {
    return this.features.get(id)
  }

  /**
   * Get all registered features
   */
  getAll(): Feature[] {
    return Array.from(this.features.values())
  }

  /**
   * Validate dependency graph
   * - Ensures all declared dependencies exist
   * - Detects cycles using DFS with recursion stack
   * @throws DependencyError if missing dependency found
   * @throws CycleError if circular dependency detected
   */
  validateDependencies(): void {
    // Check for missing dependencies
    for (const feature of this.features.values()) {
      const needs = feature.manifest.needs || []
      for (const depId of needs) {
        if (!this.features.has(depId)) {
          throw new DependencyError(feature.manifest.id, depId)
        }
      }
    }

    // Detect cycles using DFS
    const visited = new Set<string>()
    const recursionStack = new Set<string>()
    const path: string[] = []

    const dfs = (id: string): void => {
      if (recursionStack.has(id)) {
        // Found cycle - build cycle path
        const cycleStart = path.indexOf(id)
        const cyclePath = [...path.slice(cycleStart), id]
        throw new CycleError(cyclePath)
      }

      if (visited.has(id)) {
        return // Already processed this branch
      }

      visited.add(id)
      recursionStack.add(id)
      path.push(id)

      const feature = this.features.get(id)
      const needs = feature?.manifest.needs || []
      for (const depId of needs) {
        dfs(depId)
      }

      recursionStack.delete(id)
      path.pop()
    }

    // Visit all features
    for (const id of this.features.keys()) {
      if (!visited.has(id)) {
        dfs(id)
      }
    }

    this.validated = true
  }

  /**
   * Get features in topological order (dependencies before dependents)
   * Uses Kahn's algorithm for topological sort
   * @throws Error if validateDependencies() hasn't been called
   */
  getLoadOrder(): Feature[] {
    if (!this.validated) {
      throw new Error('Must call validateDependencies() before getLoadOrder()')
    }

    if (this.features.size === 0) {
      return []
    }

    // Build adjacency list and in-degree map
    const inDegree = new Map<string, number>()
    const adjList = new Map<string, string[]>()

    // Initialize
    for (const id of this.features.keys()) {
      inDegree.set(id, 0)
      adjList.set(id, [])
    }

    // Build graph: if A needs B, then edge B -> A (B must come before A)
    for (const feature of this.features.values()) {
      const id = feature.manifest.id
      const needs = feature.manifest.needs || []
      for (const depId of needs) {
        adjList.get(depId)!.push(id)
        inDegree.set(id, inDegree.get(id)! + 1)
      }
    }

    // Kahn's algorithm
    const queue: string[] = []
    const result: Feature[] = []

    // Start with features that have no dependencies
    for (const [id, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(id)
      }
    }

    while (queue.length > 0) {
      const id = queue.shift()!
      result.push(this.features.get(id)!)

      // Reduce in-degree for dependents
      for (const dependentId of adjList.get(id)!) {
        const newDegree = inDegree.get(dependentId)! - 1
        inDegree.set(dependentId, newDegree)
        if (newDegree === 0) {
          queue.push(dependentId)
        }
      }
    }

    return result
  }
}
