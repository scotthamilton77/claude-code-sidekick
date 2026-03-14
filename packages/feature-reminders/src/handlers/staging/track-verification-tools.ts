/**
 * Track verification tools — stage/unstage per-tool VC reminders
 *
 * Watches ToolCall transcript events to:
 * 1. Stage per-tool VC reminders when source files are edited (Write/Edit/MultiEdit)
 * 2. Unstage per-tool VC reminders when verification commands are observed (Bash)
 * 3. Manage per-tool state machine: STAGED → VERIFIED → COOLDOWN → re-STAGED
 *
 * @see docs/plans/2026-03-05-dynamic-vc-tool-tracking-design.md
 */

import type { RuntimeContext } from '@sidekick/core'
import { logEvent } from '@sidekick/core'
import { ReminderEvents } from '../../events.js'
import type {
  DaemonContext,
  HandlerContext,
  SidekickEvent,
  StagingEnrichment,
  TranscriptEvent,
  VerificationToolsState,
} from '@sidekick/types'
import { isDaemonContext, isTranscriptEvent } from '@sidekick/types'
import picomatch from 'picomatch'
import { findMatchingPattern } from '../../tool-pattern-matcher.js'
import { resolveReminder, stageReminder } from '../../reminder-utils.js'
import {
  ReminderIds,
  DEFAULT_REMINDERS_SETTINGS,
  VC_TOOL_REMINDER_IDS,
  type RemindersSettings,
  type VerificationToolsMap,
} from '../../types.js'
import { createRemindersState, type RemindersStateAccessors } from '../../state.js'

const FILE_EDIT_TOOLS = ['Write', 'Edit', 'MultiEdit']

const TOOL_REMINDER_MAP: Record<string, string> = {
  build: ReminderIds.VC_BUILD,
  typecheck: ReminderIds.VC_TYPECHECK,
  test: ReminderIds.VC_TEST,
  lint: ReminderIds.VC_LINT,
}

const VC_TOOL_NAME_SET = new Set<string>(VC_TOOL_REMINDER_IDS)

function extractToolInput(event: TranscriptEvent): Record<string, unknown> | undefined {
  const entry = event.payload.entry as Record<string, unknown>
  return entry?.input as Record<string, unknown> | undefined
}

export function registerTrackVerificationTools(context: RuntimeContext): void {
  if (!isDaemonContext(context)) return

  context.handlers.register({
    id: 'reminders:track-verification-tools',
    priority: 60,
    filter: { kind: 'transcript', eventTypes: ['ToolCall'] },
    handler: async (event: SidekickEvent, ctx: HandlerContext) => {
      if (!isTranscriptEvent(event)) return
      if (event.metadata.isBulkProcessing) return
      if (!isDaemonContext(ctx as unknown as RuntimeContext)) return

      const daemonCtx = ctx as unknown as DaemonContext
      const sessionId = event.context?.sessionId
      if (!sessionId) return

      const toolName = event.payload.toolName
      if (!toolName) return

      const featureConfig = context.config.getFeature<RemindersSettings>('reminders')
      const config = { ...DEFAULT_REMINDERS_SETTINGS, ...featureConfig.settings }
      const verificationTools = config.verification_tools ?? {}

      const remindersState = createRemindersState(daemonCtx.stateService)
      const stateResult = await remindersState.verificationTools.read(sessionId)
      const toolsState: VerificationToolsState = { ...stateResult.data }

      if (FILE_EDIT_TOOLS.includes(toolName)) {
        await handleFileEdit(event, daemonCtx, sessionId, verificationTools, toolsState, remindersState)
      } else if (toolName === 'Bash') {
        await handleBashCommand(event, daemonCtx, sessionId, verificationTools, toolsState, remindersState)
      }
    },
  })
}

/**
 * Stage per-tool VC reminders for the given file paths.
 * Respects the per-tool state machine (staged/verified/cooldown).
 * Stages the wrapper reminder if any per-tool reminder was staged.
 *
 * @returns true if any per-tool reminder was staged
 */
export async function stageToolsForFiles(
  filePaths: string[],
  daemonCtx: DaemonContext,
  sessionId: string,
  verificationTools: VerificationToolsMap,
  toolsState: VerificationToolsState,
  remindersState: RemindersStateAccessors
): Promise<boolean> {
  const existingReminders = await daemonCtx.staging.listReminders('Stop')
  const stagedNames = new Set(existingReminders.map((r) => r.name))
  let anyStaged = false

  for (const filePath of filePaths) {
    for (const [toolName, toolConfig] of Object.entries(verificationTools)) {
      if (!toolConfig.enabled) continue

      const reminderId = TOOL_REMINDER_MAP[toolName]
      if (!reminderId) continue
      if (!picomatch.isMatch(filePath, toolConfig.clearing_patterns)) continue

      const current = toolsState[toolName]

      if (!current || current.status === 'staged') {
        const staged = await ensureToolReminderStaged(daemonCtx, reminderId, stagedNames, {
          reason: current ? 're-staged' : 'initial',
          triggeredBy: 'file_edit',
        })
        if (staged) {
          if (!current) {
            toolsState[toolName] = {
              status: 'staged',
              editsSinceVerified: 0,
              lastVerifiedAt: null,
              lastStagedAt: Date.now(),
            }
          }
          stagedNames.add(reminderId)
          anyStaged = true
        }
      } else {
        // verified or cooldown — count edits toward re-staging threshold
        const newEdits = current.editsSinceVerified + 1
        if (newEdits >= toolConfig.clearing_threshold) {
          const staged = await ensureToolReminderStaged(daemonCtx, reminderId, stagedNames, {
            reason: 'threshold_reached',
            triggeredBy: 'file_edit',
            thresholdState: { current: newEdits, threshold: toolConfig.clearing_threshold },
          })
          if (staged) {
            toolsState[toolName] = {
              ...current,
              status: 'staged',
              editsSinceVerified: 0,
              lastStagedAt: Date.now(),
            }
            stagedNames.add(reminderId)
            anyStaged = true
          }
        } else {
          toolsState[toolName] = {
            ...current,
            status: 'cooldown',
            editsSinceVerified: newEdits,
          }
        }
      }
    }
  }

  if (anyStaged) {
    const wrapperStaged = await ensureToolReminderStaged(daemonCtx, ReminderIds.VERIFY_COMPLETION, stagedNames)
    if (!wrapperStaged) {
      daemonCtx.logger.warn('Failed to stage verify-completion wrapper reminder', { sessionId })
    }
  }

  await remindersState.verificationTools.write(sessionId, toolsState)
  return anyStaged
}

async function handleFileEdit(
  event: TranscriptEvent,
  daemonCtx: DaemonContext,
  sessionId: string,
  verificationTools: VerificationToolsMap,
  toolsState: VerificationToolsState,
  remindersState: RemindersStateAccessors
): Promise<void> {
  const filePath = extractToolInput(event)?.file_path as string | undefined
  if (!filePath) return

  // Guard: only track edits within the project directory
  const projectDir = daemonCtx.paths?.projectDir
  if (projectDir && !filePath.startsWith(projectDir)) return

  await stageToolsForFiles([filePath], daemonCtx, sessionId, verificationTools, toolsState, remindersState)
}

async function handleBashCommand(
  event: TranscriptEvent,
  daemonCtx: DaemonContext,
  sessionId: string,
  verificationTools: VerificationToolsMap,
  toolsState: VerificationToolsState,
  remindersState: RemindersStateAccessors
): Promise<void> {
  const command = extractToolInput(event)?.command as string | undefined
  if (!command) return

  let anyUnstaged = false

  for (const [toolName, toolConfig] of Object.entries(verificationTools)) {
    if (!toolConfig.enabled) continue

    const reminderId = TOOL_REMINDER_MAP[toolName]
    if (!reminderId) continue
    const match = findMatchingPattern(command, toolConfig.patterns)
    if (!match) continue

    toolsState[toolName] = {
      status: 'verified',
      editsSinceVerified: 0,
      lastVerifiedAt: Date.now(),
      lastStagedAt: toolsState[toolName]?.lastStagedAt ?? null,
      lastMatchedToolId: match.tool_id,
      lastMatchedScope: match.scope,
    }

    await daemonCtx.staging.deleteReminder('Stop', reminderId)
    logEvent(
      daemonCtx.logger,
      ReminderEvents.reminderUnstaged(
        { sessionId },
        {
          reminderName: reminderId,
          hookName: 'Stop',
          reason: 'tool_verified',
          triggeredBy: 'verification_passed',
          toolState: {
            status: toolsState[toolName].status,
            editsSinceVerified: toolsState[toolName].editsSinceVerified,
          },
        }
      )
    )
    anyUnstaged = true

    daemonCtx.logger.debug('VC tool verified', {
      toolName,
      reminderId,
      matchedToolId: match.tool_id,
      matchedScope: match.scope,
      command: command.slice(0, 100),
    })
  }

  if (anyUnstaged) {
    const remaining = await daemonCtx.staging.listReminders('Stop')
    const hasPerToolReminders = remaining.some((r) => VC_TOOL_NAME_SET.has(r.name))

    if (!hasPerToolReminders) {
      await daemonCtx.staging.deleteReminder('Stop', ReminderIds.VERIFY_COMPLETION)
      logEvent(
        daemonCtx.logger,
        ReminderEvents.reminderUnstaged(
          { sessionId },
          {
            reminderName: ReminderIds.VERIFY_COMPLETION,
            hookName: 'Stop',
            reason: 'all_tools_verified',
            triggeredBy: 'verification_passed',
          }
        )
      )
      daemonCtx.logger.info('All VC tools verified, unstaged wrapper', { sessionId })
    }

    await remindersState.verificationTools.write(sessionId, toolsState)
  }
}

async function ensureToolReminderStaged(
  daemonCtx: DaemonContext,
  reminderId: string,
  stagedNames: Set<string>,
  enrichment?: StagingEnrichment
): Promise<boolean> {
  if (stagedNames.has(reminderId)) return true

  const reminder = resolveReminder(reminderId, {
    context: {},
    assets: daemonCtx.assets,
  })
  if (!reminder) {
    daemonCtx.logger.warn('Failed to resolve VC tool reminder', { reminderId })
    return false
  }

  await stageReminder(
    daemonCtx,
    'Stop',
    {
      ...reminder,
      stagedAt: { timestamp: Date.now(), turnCount: 0, toolsThisTurn: 0, toolCount: 0 },
    },
    enrichment
  )
  return true
}
