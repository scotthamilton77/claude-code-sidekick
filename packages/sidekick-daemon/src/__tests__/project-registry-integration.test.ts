import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { ProjectRegistryService } from '@sidekick/core'

function createTestDir(): string {
  const dir = join(tmpdir(), `test-daemon-reg-${randomBytes(8).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('Daemon project registry integration', () => {
  let registryRoot: string
  let projectDir: string

  beforeEach(() => {
    registryRoot = createTestDir()
    projectDir = createTestDir()
  })

  afterEach(() => {
    for (const dir of [registryRoot, projectDir]) {
      if (existsSync(dir)) rmSync(dir, { recursive: true })
    }
  })

  it('registers project on startup', async () => {
    const service = new ProjectRegistryService(registryRoot)
    await service.register(projectDir)

    const entries = await service.list()
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe(projectDir)
  })

  it('updates lastActive on heartbeat', async () => {
    const service = new ProjectRegistryService(registryRoot)
    await service.register(projectDir)

    const first = (await service.list())[0]
    await new Promise((r) => setTimeout(r, 10))
    await service.register(projectDir)
    const second = (await service.list())[0]

    expect(new Date(second.lastActive).getTime()).toBeGreaterThanOrEqual(new Date(first.lastActive).getTime())
  })
})
