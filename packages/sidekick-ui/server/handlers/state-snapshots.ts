import { parseStateSnapshots } from '../state-snapshots-api.js'
import type { ApiRequest } from '../types.js'
import { validatePathParam, requireProject, requireSession } from '../utils.js'

export async function handleGetStateSnapshots(req: ApiRequest): Promise<{ snapshots: unknown[] }> {
  const projectId = validatePathParam(req.projectId, 'project ID')
  const sessionId = validatePathParam(req.sessionId, 'session ID')
  const project = await requireProject(req.ctx.registryRoot, projectId)
  await requireSession(project.projectDir, sessionId)
  const snapshots = await parseStateSnapshots(project.projectDir, sessionId)
  return { snapshots }
}
