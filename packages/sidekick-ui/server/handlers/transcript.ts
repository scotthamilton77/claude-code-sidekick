import { StatusError } from 'itty-router'
import { getProjectById } from '../sessions-api.js'
import { parseTranscriptLines, parseSubagentTranscript } from '../transcript-api.js'
import type { SubagentTranscriptResult } from '../transcript-api.js'
import type { ApiRequest } from '../types.js'
import { validatePathParam } from '../utils.js'

/**
 * Transcript handler — does NOT use requireProject.
 * Missing project = undefined projectDir = data layer gracefully degrades
 * (no Sidekick event interleaving).
 */
export async function handleGetTranscript(req: ApiRequest): Promise<{ lines: unknown[] }> {
  const projectId = validatePathParam(req.projectId, 'project ID')
  const sessionId = validatePathParam(req.sessionId, 'session ID')

  // Optional project lookup — no 404 on missing project
  const project = await getProjectById(req.ctx.registryRoot, projectId)
  const lines = await parseTranscriptLines(projectId, sessionId, project?.projectDir)
  return { lines }
}

/**
 * Subagent transcript handler — returns raw {lines, meta} object directly.
 * Returns 404 when the subagent transcript is not found.
 */
export async function handleGetSubagentTranscript(req: ApiRequest): Promise<SubagentTranscriptResult> {
  const projectId = validatePathParam(req.projectId, 'project ID')
  const sessionId = validatePathParam(req.sessionId, 'session ID')
  const agentId = validatePathParam(req.agentId, 'agent ID')

  const result = await parseSubagentTranscript(projectId, sessionId, agentId)
  if (!result) {
    throw new StatusError(404, `Subagent not found: ${agentId}`)
  }
  return result
}
