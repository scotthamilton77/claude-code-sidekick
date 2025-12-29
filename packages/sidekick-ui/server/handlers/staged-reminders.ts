/**
 * GET /api/sessions/:sessionId/stage/:hookName - Returns staged reminders for a hook.
 *
 * Returns all JSON files in the stage directory, plus suppression status.
 */

import { readdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { ApiRequest } from '../types'
import { jsonResponse, errorResponse, isValidSessionId, isValidHookName } from '../utils'

interface StagedReminder {
  name: string
  blocking: boolean
  priority: number
  persistent: boolean
  userMessage?: string
  additionalContext?: string
  reason?: string
}

interface StagedRemindersResponse {
  reminders: StagedReminder[]
  suppressed: boolean
  error?: string
}

export async function handleStagedReminders(request: ApiRequest): Promise<Response> {
  const { sessionsPath } = request.ctx
  const { sessionId, hookName } = request.params

  // Validate session ID and hook name
  if (!isValidSessionId(sessionId)) {
    return errorResponse('Invalid session ID format', 400)
  }

  if (!isValidHookName(hookName)) {
    return errorResponse('Invalid hook name format', 400)
  }

  if (!sessionsPath) {
    const response: StagedRemindersResponse = {
      reminders: [],
      suppressed: false,
      error: 'Sessions directory not found',
    }
    return jsonResponse(response)
  }

  const stageDir = join(sessionsPath, sessionId, 'stage', hookName)
  if (!existsSync(stageDir)) {
    // No stage directory - return empty
    const response: StagedRemindersResponse = {
      reminders: [],
      suppressed: false,
    }
    return jsonResponse(response)
  }

  try {
    // Check for suppression marker
    const suppressionMarker = join(stageDir, '.suppressed')
    const suppressed = existsSync(suppressionMarker)

    // Read all JSON files in stage directory
    const files = await readdir(stageDir)
    const reminders: StagedReminder[] = []

    for (const file of files) {
      // Skip non-JSON files and suppression marker
      if (!file.endsWith('.json') || file.startsWith('.')) {
        continue
      }

      const filePath = join(stageDir, file)
      try {
        const content = await readFile(filePath, 'utf-8')
        const reminder = JSON.parse(content) as StagedReminder
        reminders.push(reminder)
      } catch {
        // Skip malformed files
        continue
      }
    }

    // Sort by priority (descending) to match CLI consumption order
    reminders.sort((a, b) => b.priority - a.priority)

    const response: StagedRemindersResponse = {
      reminders,
      suppressed,
    }
    return jsonResponse(response)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return errorResponse(`Failed to read staged reminders: ${msg}`)
  }
}
