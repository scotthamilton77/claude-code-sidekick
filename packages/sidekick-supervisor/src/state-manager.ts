import { Logger } from '@sidekick/core'
import fs from 'fs/promises'
import path from 'path'

export class StateManager {
  private stateDir: string
  private logger: Logger
  private cache = new Map<string, unknown>()

  constructor(stateDir: string, logger: Logger) {
    this.stateDir = stateDir
    this.logger = logger
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.stateDir, { recursive: true })
    } catch {
      // Directory may already exist
    }
  }

  async update(file: string, data: Record<string, unknown>, merge = false): Promise<void> {
    if (!file.endsWith('.json')) {
      file += '.json'
    }

    const filePath = path.join(this.stateDir, file)

    let content: unknown = data
    if (merge) {
      // If merging, we need to know the current state.
      // We check our cache first, then disk.
      let current = this.cache.get(file) as Record<string, unknown> | undefined
      if (!current) {
        try {
          const raw = await fs.readFile(filePath, 'utf-8')
          current = JSON.parse(raw) as Record<string, unknown>
        } catch {
          current = {}
        }
      }
      content = { ...current, ...data }
    }

    this.cache.set(file, content)

    // Atomic write: write to .tmp then rename
    const tmpPath = `${filePath}.tmp`
    const json = JSON.stringify(content, null, 2)

    try {
      await fs.writeFile(tmpPath, json, 'utf-8')
      await fs.rename(tmpPath, filePath)
      this.logger.debug('State updated', { file })
    } catch (err) {
      this.logger.error('Failed to write state', { file, error: err })
      throw err
    }
  }

  get(file: string): unknown {
    if (!file.endsWith('.json')) {
      file += '.json'
    }
    return this.cache.get(file)
  }
}
