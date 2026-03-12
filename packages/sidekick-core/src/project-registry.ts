import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { basename, join } from 'node:path'
import { ProjectRegistryEntrySchema, type ProjectRegistryEntry } from '@sidekick/types'

/**
 * Encode an absolute project path to a directory name.
 * Mirrors Claude Code's ~/.claude/projects/ convention: replace '/' with '-'.
 */
export function encodeProjectDir(absPath: string): string {
  return absPath.replace(/\//g, '-')
}

/**
 * Decode an encoded directory name back to an absolute path.
 */
export function decodeProjectDir(encoded: string): string {
  return encoded.replace(/-/g, '/')
}

export interface PruneOptions {
  retentionDays: number
}

export interface PruneResult {
  path: string
  reason: 'path-missing' | 'age-exceeded'
}

const REGISTRY_FILE = 'registry.json'

/**
 * Manages the project registry at ~/.sidekick/projects/.
 * Each registered project gets a subdirectory named by its encoded path,
 * containing a registry.json with metadata.
 */
export class ProjectRegistryService {
  constructor(private readonly registryRoot: string) {}

  /**
   * Register or update a project in the registry.
   * Creates the directory and writes registry.json with current timestamp.
   */
  async register(projectDir: string): Promise<void> {
    const encoded = encodeProjectDir(projectDir)
    const entryDir = join(this.registryRoot, encoded)
    const entryFile = join(entryDir, REGISTRY_FILE)

    await fs.mkdir(entryDir, { recursive: true })

    const entry: ProjectRegistryEntry = {
      path: projectDir,
      displayName: basename(projectDir),
      lastActive: new Date().toISOString(),
    }

    // Atomic write: temp file + rename
    const tmpPath = `${entryFile}.${Date.now()}.tmp`
    await fs.writeFile(tmpPath, JSON.stringify(entry, null, 2), 'utf-8')
    await fs.rename(tmpPath, entryFile)
  }

  /**
   * List all valid registered projects.
   * Skips entries with missing/invalid registry.json.
   */
  async list(): Promise<ProjectRegistryEntry[]> {
    if (!existsSync(this.registryRoot)) {
      return []
    }

    const entries: ProjectRegistryEntry[] = []
    const dirents = await fs.readdir(this.registryRoot, { withFileTypes: true })

    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue

      const entryFile = join(this.registryRoot, dirent.name, REGISTRY_FILE)
      try {
        const raw = await fs.readFile(entryFile, 'utf-8')
        const parsed = ProjectRegistryEntrySchema.parse(JSON.parse(raw))
        entries.push(parsed)
      } catch {
        // Skip invalid entries silently
      }
    }

    return entries
  }

  /**
   * Prune stale registry entries.
   * Removes entries where the project path no longer exists
   * or lastActive is older than retentionDays.
   */
  async prune(options: PruneOptions): Promise<PruneResult[]> {
    if (!existsSync(this.registryRoot)) {
      return []
    }

    const pruned: PruneResult[] = []
    const cutoff = Date.now() - options.retentionDays * 24 * 60 * 60 * 1000
    const dirents = await fs.readdir(this.registryRoot, { withFileTypes: true })

    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue

      const entryDir = join(this.registryRoot, dirent.name)
      const entryFile = join(entryDir, REGISTRY_FILE)

      let entry: ProjectRegistryEntry
      try {
        const raw = await fs.readFile(entryFile, 'utf-8')
        entry = ProjectRegistryEntrySchema.parse(JSON.parse(raw))
      } catch {
        // Can't read entry — remove the directory
        await fs.rm(entryDir, { recursive: true })
        continue
      }

      let reason: PruneResult['reason'] | null = null

      if (!existsSync(entry.path)) {
        reason = 'path-missing'
      } else if (new Date(entry.lastActive).getTime() < cutoff) {
        reason = 'age-exceeded'
      }

      if (reason) {
        await fs.rm(entryDir, { recursive: true })
        pruned.push({ path: entry.path, reason })
      }
    }

    return pruned
  }
}
