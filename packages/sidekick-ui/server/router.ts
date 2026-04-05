import { Router, withParams } from 'itty-router'
import type { RouterType } from 'itty-router'
import { handleListProjects, handleListSessions } from './handlers/projects.js'
import { handleGetTimeline } from './handlers/timeline.js'
import { handleGetStateSnapshots } from './handlers/state-snapshots.js'
import { handleGetTranscript, handleGetSubagentTranscript } from './handlers/transcript.js'
import type { ApiContext, ApiRequest } from './types.js'
import { handleError, toJsonResponse } from './utils.js'

function injectContext(ctx: ApiContext) {
  return (req: ApiRequest) => {
    req.ctx = ctx
  }
}

export function createRouter(ctx: ApiContext): RouterType<ApiRequest> {
  return Router<ApiRequest>({
    base: '/api',
    before: [withParams, injectContext(ctx)],
    catch: handleError,
    finally: [toJsonResponse],
  })
    .get('/projects', handleListProjects)
    .get('/projects/:projectId/sessions', handleListSessions)
    .get('/projects/:projectId/sessions/:sessionId/timeline', handleGetTimeline)
    .get('/projects/:projectId/sessions/:sessionId/transcript', handleGetTranscript)
    .get('/projects/:projectId/sessions/:sessionId/subagents/:agentId/transcript', handleGetSubagentTranscript)
    .get('/projects/:projectId/sessions/:sessionId/state-snapshots', handleGetStateSnapshots)
}
