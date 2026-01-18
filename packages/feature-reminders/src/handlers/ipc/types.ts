/**
 * Types for IPC Handlers
 */

import type { MinimalStateService } from '@sidekick/types'

export interface IPCLogger {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

export interface IPCHandlerContext {
  stateService: MinimalStateService
  logger: IPCLogger
}

export interface ReminderConsumedParams {
  sessionId: string
  reminderName: string
  metrics: {
    turnCount: number
    toolsThisTurn: number
  }
}

export interface VCUnverifiedSetParams {
  sessionId: string
  classification: {
    category: string
    confidence: number
  }
  metrics: {
    turnCount: number
    toolsThisTurn: number
    toolCount: number
  }
}

export interface VCUnverifiedClearParams {
  sessionId: string
}
