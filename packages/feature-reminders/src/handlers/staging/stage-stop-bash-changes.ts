/**
 * Stage verify-completion when Bash tool modifies source files
 *
 * Two cooperating handlers sharing closure state:
 * 1. UserPromptSubmit hook handler - captures git status baseline per session
 * 2. ToolResult transcript handler - compares git status after Bash execution
 *
 * @see docs/plans/2026-02-16-bash-vc-detection-design.md
 */
import type { RuntimeContext } from '@sidekick/core'
import { getGitFileStatus } from '@sidekick/core'
import { isDaemonContext, isHookEvent, isTranscriptEvent } from '@sidekick/types'
import type { DaemonContext } from '@sidekick/types'
import picomatch from 'picomatch'
import { createStagingHandler } from './staging-handler-utils.js'
import { ReminderIds, DEFAULT_REMINDERS_SETTINGS, type RemindersSettings } from '../../types.js'

const GIT_STATUS_TIMEOUT_MS = 200
const MAX_BASELINES = 50

export function registerStageBashChanges(context: RuntimeContext): void {
  if (!isDaemonContext(context)) return

  const cwd = context.paths.projectDir
  if (!cwd) return // No project directory — cannot run git status

  // Shared state: per-session git baselines
  const baselines = new Map<string, string[]>()

  // Handler A: Capture git baseline on UserPromptSubmit
  context.handlers.register({
    id: 'reminders:git-baseline-capture',
    priority: 40, // Before unstage-verify-completion (45)
    filter: { kind: 'hook', hooks: ['UserPromptSubmit'] },
    handler: async (event, ctx) => {
      if (!isHookEvent(event)) return
      if (!isDaemonContext(ctx as unknown as RuntimeContext)) return

      const daemonCtx = ctx as unknown as DaemonContext
      const sessionId = event.context?.sessionId
      if (!sessionId) return

      const files = await getGitFileStatus(cwd, GIT_STATUS_TIMEOUT_MS)

      // Cap baselines to prevent unbounded memory growth
      if (baselines.size >= MAX_BASELINES) {
        const oldest = baselines.keys().next().value
        if (oldest) baselines.delete(oldest)
      }
      baselines.set(sessionId, files)

      daemonCtx.logger.debug('Git baseline captured', {
        sessionId,
        fileCount: files.length,
      })
    },
  })

  // Handler B: Detect Bash file changes on ToolResult
  createStagingHandler(context, {
    id: 'reminders:stage-stop-bash-changes',
    priority: 55,
    filter: { kind: 'transcript', eventTypes: ['ToolResult'] },
    execute: async (event, ctx) => {
      if (!isTranscriptEvent(event)) return undefined

      // Only check Bash tool results
      const toolName = event.payload.toolName
      if (toolName !== 'Bash') return undefined

      const sessionId = event.context?.sessionId
      if (!sessionId) return undefined

      // Get baseline — if none exists (daemon restart mid-turn), skip
      const baseline = baselines.get(sessionId)
      if (!baseline) {
        ctx.logger.debug('Bash VC: no baseline for session, skipping', { sessionId })
        return undefined
      }

      // Check once-per-turn reactivation
      const metrics = event.metadata.metrics
      const lastConsumed = await ctx.staging.getLastConsumed('Stop', ReminderIds.VERIFY_COMPLETION)
      if (lastConsumed?.stagedAt) {
        const shouldReactivate = metrics.turnCount > lastConsumed.stagedAt.turnCount
        if (!shouldReactivate) {
          ctx.logger.debug('Bash VC: skipped (already consumed this turn)', {
            currentTurn: metrics.turnCount,
            lastConsumedTurn: lastConsumed.stagedAt.turnCount,
          })
          return undefined
        }
      }

      // Run git status and compare against baseline
      const current = await getGitFileStatus(cwd, GIT_STATUS_TIMEOUT_MS)
      const baselineSet = new Set(baseline)
      const newFiles = current.filter((f) => !baselineSet.has(f))

      if (newFiles.length === 0) return undefined

      // Filter through source code patterns
      const featureConfig = context.config.getFeature<RemindersSettings>('reminders')
      const config = { ...DEFAULT_REMINDERS_SETTINGS, ...featureConfig.settings }
      const sourceMatches = newFiles.filter((f) => picomatch.isMatch(f, config.source_code_patterns))

      if (sourceMatches.length === 0) {
        ctx.logger.debug('Bash VC: new files found but no source code matches', {
          newFiles,
        })
        return undefined
      }

      ctx.logger.info('Bash VC: staging verify-completion', {
        sourceMatches,
        turnCount: metrics.turnCount,
        toolCount: metrics.toolCount,
      })

      // Update baseline to current state to avoid redundant git calls
      baselines.set(sessionId, current)

      return {
        reminderId: ReminderIds.VERIFY_COMPLETION,
        targetHook: 'Stop',
      }
    },
  })
}
