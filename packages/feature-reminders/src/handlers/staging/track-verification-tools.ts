/**
 * Track verification tools — stage/unstage per-tool VC reminders
 *
 * Uses two-phase staging to avoid acting on blocked tools:
 * 1. ToolCall phase: Capture tool intent (name + input) in pending map
 * 2. ToolResult phase: Confirm execution, run staging/unstaging logic
 *
 * If PreToolUse blocks the tool between phases, no ToolResult fires and
 * no staging occurs. Pending map is cleaned on UserPromptSubmit/Stop.
 *
 * @see docs/plans/2026-03-05-dynamic-vc-tool-tracking-design.md
 * @see docs/superpowers/specs/2026-04-04-pr-staging-toolresult-fix-design.md
 */

import type { RuntimeContext } from '@sidekick/core'
import { logEvent, toErrorMessage } from '@sidekick/core'
import { ReminderEvents } from '../../events.js'
import type {
  DaemonContext,
  HandlerContext,
  SidekickEvent,
  StagingEnrichment,
  VerificationToolsState,
} from '@sidekick/types'
import { DecisionEvents, isDaemonContext, isHookEvent, isTranscriptEvent } from '@sidekick/types'
import picomatch from 'picomatch'
import { findMatchingPattern } from '../../tool-pattern-matcher.js'
import { resolveReminder, stageReminder } from '../../reminder-utils.js'
import {
  ReminderIds,
  TOOL_REMINDER_MAP,
  VC_TOOL_REMINDER_IDS,
  getRemindersConfig,
  type CommandRunner,
  type VerificationToolsMap,
} from '../../types.js'
import { createRemindersState, type RemindersStateAccessors } from '../../state.js'

const FILE_EDIT_TOOLS = ['Write', 'Edit', 'MultiEdit']

const VC_TOOL_NAME_SET = new Set<string>(VC_TOOL_REMINDER_IDS)

export function registerTrackVerificationTools(context: RuntimeContext): void {
  if (!isDaemonContext(context)) return

  // Closure-scoped pending map: tracks ToolCall intents awaiting ToolResult confirmation.
  // Key: `${sessionId}:${toolUseId}`, value: captured tool name + input.
  const pendingToolCalls = new Map<string, { toolName: string; input: Record<string, unknown> }>()

  // Handler A: Two-phase staging — ToolCall captures intent, ToolResult executes staging
  context.handlers.register({
    id: 'reminders:track-verification-tools',
    priority: 60,
    filter: { kind: 'transcript', eventTypes: ['ToolCall', 'ToolResult'] },
    handler: async (event: SidekickEvent, ctx: HandlerContext) => {
      if (!isTranscriptEvent(event)) return
      if (event.metadata.isBulkProcessing) return
      if (!isDaemonContext(ctx as unknown as RuntimeContext)) return

      const daemonCtx = ctx as unknown as DaemonContext
      const sessionId = event.context?.sessionId
      if (!sessionId) return

      // Phase 1: ToolCall — capture intent, no staging
      if (event.eventType === 'ToolCall') {
        const toolUseId = (event.payload.entry as { id?: string }).id
        const toolName = event.payload.toolName
        if (!toolUseId || !toolName) return

        const entry = event.payload.entry as Record<string, unknown>
        const input = (entry?.input as Record<string, unknown>) ?? {}
        pendingToolCalls.set(`${sessionId}:${toolUseId}`, { toolName, input })
        return
      }

      // Phase 2: ToolResult — confirm execution, run staging/unstaging
      if (event.eventType === 'ToolResult') {
        const toolUseId = (event.payload.entry as { tool_use_id?: string }).tool_use_id
        if (!toolUseId) return

        const key = `${sessionId}:${toolUseId}`
        const pending = pendingToolCalls.get(key)
        if (!pending) return
        pendingToolCalls.delete(key)

        const { toolName, input } = pending

        const config = getRemindersConfig(context.config)
        const verificationTools = config.verification_tools ?? {}
        const runners = config.command_runners ?? []

        const remindersState = createRemindersState(daemonCtx.stateService)
        const stateResult = await remindersState.verificationTools.read(sessionId)
        const toolsState: VerificationToolsState = { ...stateResult.data }

        if (FILE_EDIT_TOOLS.includes(toolName)) {
          await handleFileEdit(input, daemonCtx, sessionId, verificationTools, toolsState, remindersState)
        } else if (toolName === 'Bash') {
          await handleBashCommand(input, daemonCtx, sessionId, verificationTools, toolsState, remindersState, runners)
        }
      }
    },
  })

  // Handler B: Cleanup pending map on UserPromptSubmit/Stop (stale entries from blocked tools)
  context.handlers.register({
    id: 'reminders:track-verification-tools-cleanup',
    priority: 60,
    filter: { kind: 'hook', hooks: ['UserPromptSubmit', 'Stop'] },
    handler: (event: SidekickEvent, _ctx: HandlerContext): Promise<void> => {
      if (!isHookEvent(event)) return Promise.resolve()
      const sessionId = event.context?.sessionId
      if (!sessionId) return Promise.resolve()

      // Clear all pending entries for this session
      for (const key of pendingToolCalls.keys()) {
        if (key.startsWith(`${sessionId}:`)) {
          pendingToolCalls.delete(key)
        }
      }
      return Promise.resolve()
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
  remindersState: RemindersStateAccessors,
  triggeredBy: string = 'file_edit'
): Promise<boolean> {
  const existingReminders = await daemonCtx.staging.listReminders('Stop')
  const stagedNames = new Set(existingReminders.map((r) => r.name))
  let anyStaged = false
  const emittedNotStaged = new Set<string>()

  for (const filePath of filePaths) {
    for (const [toolName, toolConfig] of Object.entries(verificationTools)) {
      const reminderId = TOOL_REMINDER_MAP[toolName]
      if (!reminderId) continue

      if (!toolConfig.enabled) {
        const emitKey = `${reminderId}:feature_disabled`
        if (!emittedNotStaged.has(emitKey)) {
          emittedNotStaged.add(emitKey)
          logEvent(
            daemonCtx.logger,
            ReminderEvents.reminderNotStaged(
              { sessionId },
              {
                reminderName: reminderId,
                hookName: 'Stop',
                reason: 'feature_disabled',
                triggeredBy,
              }
            )
          )
        }
        continue
      }

      if (!picomatch.isMatch(filePath, toolConfig.clearing_patterns)) {
        const emitKey = `${reminderId}:pattern_mismatch`
        if (!emittedNotStaged.has(emitKey)) {
          emittedNotStaged.add(emitKey)
          logEvent(
            daemonCtx.logger,
            ReminderEvents.reminderNotStaged(
              { sessionId },
              {
                reminderName: reminderId,
                hookName: 'Stop',
                reason: 'pattern_mismatch',
                triggeredBy,
              }
            )
          )
        }
        continue
      }

      try {
        const current = toolsState[toolName]

        if (!current || current.status === 'staged') {
          const staged = await ensureToolReminderStaged(daemonCtx, reminderId, stagedNames, {
            reason: current ? 're-staged' : 'initial',
            triggeredBy,
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
            const wasAlreadyStaged = stagedNames.has(reminderId)
            const staged = await ensureToolReminderStaged(daemonCtx, reminderId, stagedNames, {
              reason: 'threshold_reached',
              triggeredBy,
              thresholdState: { current: newEdits, threshold: toolConfig.clearing_threshold },
            })
            if (staged) {
              if (!wasAlreadyStaged) {
                logEvent(
                  daemonCtx.logger,
                  DecisionEvents.decisionRecorded(
                    { sessionId },
                    {
                      decision: 'staged',
                      reason: `edits reached clearing threshold (${newEdits}/${toolConfig.clearing_threshold})`,
                      subsystem: 'vc-reminders',
                      title: 'Re-stage VC reminder (threshold reached)',
                    }
                  )
                )
              }
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
            logEvent(
              daemonCtx.logger,
              ReminderEvents.reminderNotStaged(
                { sessionId },
                {
                  reminderName: reminderId,
                  hookName: 'Stop',
                  reason: 'below_threshold',
                  threshold: toolConfig.clearing_threshold,
                  currentValue: newEdits,
                  triggeredBy,
                }
              )
            )
          }
        }
      } catch (error) {
        daemonCtx.logger.warn('Failed to stage tool reminder, skipping', {
          toolName,
          reminderId,
          sessionId,
          error: toErrorMessage(error),
        })
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
  input: Record<string, unknown>,
  daemonCtx: DaemonContext,
  sessionId: string,
  verificationTools: VerificationToolsMap,
  toolsState: VerificationToolsState,
  remindersState: RemindersStateAccessors
): Promise<void> {
  const filePath = input.file_path as string | undefined
  if (!filePath) return

  // Guard: only track edits within the project directory
  const projectDir = daemonCtx.paths?.projectDir
  if (projectDir && !filePath.startsWith(projectDir)) return

  await stageToolsForFiles([filePath], daemonCtx, sessionId, verificationTools, toolsState, remindersState)
}

async function handleBashCommand(
  input: Record<string, unknown>,
  daemonCtx: DaemonContext,
  sessionId: string,
  verificationTools: VerificationToolsMap,
  toolsState: VerificationToolsState,
  remindersState: RemindersStateAccessors,
  runners: CommandRunner[] = []
): Promise<void> {
  const command = input.command as string | undefined
  if (!command) return

  let anyUnstaged = false

  for (const [toolName, toolConfig] of Object.entries(verificationTools)) {
    if (!toolConfig.enabled) continue

    const reminderId = TOOL_REMINDER_MAP[toolName]
    if (!reminderId) continue
    const match = findMatchingPattern(command, toolConfig.patterns, runners)
    if (!match) continue

    toolsState[toolName] = {
      status: 'verified',
      editsSinceVerified: 0,
      lastVerifiedAt: Date.now(),
      lastStagedAt: toolsState[toolName]?.lastStagedAt ?? null,
      lastMatchedToolId: match.tool_id,
      lastMatchedScope: match.scope,
    }

    const deleted = await daemonCtx.staging.deleteReminder('Stop', reminderId)
    if (deleted) {
      logEvent(
        daemonCtx.logger,
        DecisionEvents.decisionRecorded(
          { sessionId },
          {
            decision: 'unstaged',
            reason: `verification passed for ${toolName} (matched ${match.tool_id})`,
            subsystem: 'vc-reminders',
            title: 'Unstage VC reminder (verified)',
          }
        )
      )
    }
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
