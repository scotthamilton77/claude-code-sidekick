import { parseTimelineEvents } from '../timeline-api.js'
import type { ApiRequest } from '../types.js'
import { validatePathParam, requireProject, requireSession } from '../utils.js'

export async function handleGetTimeline(req: ApiRequest): Promise<{ events: unknown[] }> {
  const projectId = validatePathParam(req.projectId, 'project ID')
  const sessionId = validatePathParam(req.sessionId, 'session ID')
  const project = await requireProject(req.ctx.registryRoot, projectId)
  await requireSession(project.projectDir, sessionId)
  const events = await parseTimelineEvents(project.projectDir, sessionId)
  return { events }
}
