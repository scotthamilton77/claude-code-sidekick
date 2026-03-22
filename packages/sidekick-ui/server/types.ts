import type { IRequest } from 'itty-router'

export interface ApiContext {
  registryRoot: string
}

export interface ApiRequest extends IRequest {
  ctx: ApiContext
  query: Record<string, string | undefined>
}
