import { listProjects, listSessions } from '../sessions-api.js'
import type { ApiRequest } from '../types.js'
import { validatePathParam, requireProject } from '../utils.js'

export async function handleListProjects(req: ApiRequest): Promise<{ projects: unknown[] }> {
  const projects = await listProjects(req.ctx.registryRoot)
  return { projects }
}

export async function handleListSessions(req: ApiRequest): Promise<{ sessions: unknown[] }> {
  const projectId = validatePathParam(req.projectId, 'project ID')
  const project = await requireProject(req.ctx.registryRoot, projectId)
  const sessions = await listSessions(project.projectDir, project.active)
  return { sessions }
}
