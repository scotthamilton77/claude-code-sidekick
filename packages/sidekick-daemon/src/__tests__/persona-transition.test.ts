import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StateService } from '@sidekick/core'
import { SnarkyMessageStateSchema, ResumeMessageStateSchema } from '@sidekick/types'
import { stagePersonaTransition } from '../persona-transition.js'

let tmpDir: string
let stateService: StateService

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-persona-transition-test-'))
  stateService = new StateService(tmpDir)
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('stagePersonaTransition', () => {
  const sessionId = 'test-session-123'

  it('should overwrite existing snarky message with placeholder', async () => {
    const snarkyPath = stateService.sessionStatePath(sessionId, 'snarky-message.json')
    await fs.mkdir(path.dirname(snarkyPath), { recursive: true })
    await stateService.write(
      snarkyPath,
      { message: 'Old snarky from Dilbert', timestamp: '2026-01-01T00:00:00.000Z' },
      SnarkyMessageStateSchema
    )

    await stagePersonaTransition(stateService, sessionId)

    const result = await stateService.read(snarkyPath, SnarkyMessageStateSchema, { message: '', timestamp: '' })
    expect(result.data.message).toBe('Persona changed.')
    expect(result.data.timestamp).toBeTruthy()
  })

  it('should delete existing resume message', async () => {
    const resumePath = stateService.sessionStatePath(sessionId, 'resume-message.json')
    await fs.mkdir(path.dirname(resumePath), { recursive: true })
    await stateService.write(
      resumePath,
      {
        last_task_id: null,
        session_title: 'Old session',
        snarky_comment: 'Welcome back',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      ResumeMessageStateSchema
    )

    await stagePersonaTransition(stateService, sessionId)

    await expect(fs.access(resumePath)).rejects.toThrow()
  })

  it('should not throw when resume message does not exist', async () => {
    const snarkyPath = stateService.sessionStatePath(sessionId, 'snarky-message.json')
    await fs.mkdir(path.dirname(snarkyPath), { recursive: true })

    await expect(stagePersonaTransition(stateService, sessionId)).resolves.toBeUndefined()

    const result = await stateService.read(snarkyPath, SnarkyMessageStateSchema, { message: '', timestamp: '' })
    expect(result.data.message).toBe('Persona changed.')
  })

  it('should not throw when neither file exists', async () => {
    await expect(stagePersonaTransition(stateService, sessionId)).resolves.toBeUndefined()

    const snarkyPath = stateService.sessionStatePath(sessionId, 'snarky-message.json')
    const result = await stateService.read(snarkyPath, SnarkyMessageStateSchema, { message: '', timestamp: '' })
    expect(result.data.message).toBe('Persona changed.')
  })
})
