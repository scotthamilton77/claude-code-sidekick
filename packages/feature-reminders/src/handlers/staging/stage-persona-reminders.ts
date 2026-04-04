/**
 * Stage persona reminders on SessionStart
 *
 * Stages the throttle-managed "remember-your-persona" reminder for both
 * UserPromptSubmit and SessionStart hooks when the active persona
 * is not "disabled" and the injectPersonaIntoClaude config is true.
 *
 * Also exports a re-staging function for use when persona changes mid-session.
 *
 * @see docs/plans/2026-02-16-persona-injection.md
 */
import type { RuntimeContext } from '@sidekick/core'
import { createPersonaLoader, getDefaultPersonasDir, logEvent, LogEvents, toErrorMessage } from '@sidekick/core'
import { ReminderEvents } from '../../events.js'
import type { DaemonContext, HookName, Logger, PersonaDefinition, SidekickEvent, HandlerContext } from '@sidekick/types'
import {
  isDaemonContext,
  isHookEvent,
  isSessionStartEvent,
  LastStagedPersonaSchema,
  SessionPersonaStateSchema,
} from '@sidekick/types'
import { resolveReminder, stageReminder } from '../../reminder-utils.js'
import { ReminderIds } from '../../types.js'
import { registerThrottledReminder } from './throttle-utils.js'

/**
 * Re-stage persona reminders for all active sessions.
 * Called by daemon when `injectPersonaIntoClaude` config changes mid-session.
 *
 * Uses ctxFactory pattern to avoid passing daemon internals directly.
 */
export async function restagePersonaRemindersForActiveSessions(
  ctxFactory: (sessionId: string) => Promise<DaemonContext>,
  sessionIds: string[],
  logger: Logger
): Promise<void> {
  logger.info('Re-staging persona reminders for active sessions', { count: sessionIds.length })
  for (const sessionId of sessionIds) {
    try {
      const ctx = await ctxFactory(sessionId)
      await stagePersonaRemindersForSession(ctx, sessionId)
    } catch (err) {
      logger.error('Failed to restage persona reminders', {
        sessionId,
        error: toErrorMessage(err),
      })
    }
  }
}

/** Minimal type for reading session-summary config without cross-feature import */
interface PersonaInjectionConfig {
  personas?: {
    injectPersonaIntoClaude?: boolean
  }
}

/** Target hooks for persona reminders */
const PERSONA_REMINDER_HOOKS: HookName[] = ['UserPromptSubmit', 'SessionStart']

/**
 * Remove all persona-related reminders from staging.
 * Used when persona injection is disabled or no active persona exists.
 * Records the cleared state for change detection when a prior staging exists.
 */
async function clearPersonaReminders(ctx: DaemonContext, sessionId: string): Promise<void> {
  const eventContext = { sessionId }
  for (const hook of PERSONA_REMINDER_HOOKS) {
    await ctx.staging.deleteReminder(hook, ReminderIds.REMEMBER_YOUR_PERSONA)
    logEvent(
      ctx.logger,
      ReminderEvents.reminderUnstaged(eventContext, {
        reminderName: ReminderIds.REMEMBER_YOUR_PERSONA,
        hookName: hook,
        reason: 'persona_cleared',
      })
    )
  }
  await ctx.staging.deleteReminder('UserPromptSubmit', ReminderIds.PERSONA_CHANGED)
  logEvent(
    ctx.logger,
    ReminderEvents.reminderUnstaged(eventContext, {
      reminderName: ReminderIds.PERSONA_CHANGED,
      hookName: 'UserPromptSubmit',
      reason: 'persona_cleared',
    })
  )

  // Record that persona was explicitly cleared (distinguishes from never-staged)
  const lastStaged = await readLastStagedPersona(ctx, sessionId)
  if (lastStaged !== null) {
    await writeLastStagedPersona(ctx, sessionId, null)
  }
}

/**
 * Build persona template context from a PersonaDefinition.
 * Inlined here to avoid cross-feature dependency on @sidekick/feature-session-summary.
 */
function buildPersonaTemplateContext(persona: PersonaDefinition): Record<string, string> {
  return {
    persona_name: persona.display_name,
    persona_theme: persona.theme,
    persona_tone: persona.tone_traits.join(', '),
    persona_personality: persona.personality_traits.join(', '),
    persona_snarky_examples: (persona.snarky_examples ?? []).map((ex) => `- "${ex}"`).join('\n'),
  }
}

/**
 * Load the session's active persona from state.
 * Returns null if no persona is set or persona ID is "disabled".
 */
async function loadPersonaForSession(ctx: DaemonContext, sessionId: string): Promise<PersonaDefinition | null> {
  const personaStatePath = ctx.stateService.sessionStatePath(sessionId, 'session-persona.json')
  const result = await ctx.stateService.read(personaStatePath, SessionPersonaStateSchema, null)

  if (!result.data) return null
  if (result.data.persona_id === 'disabled') return null

  const loader = createPersonaLoader({
    defaultPersonasDir: getDefaultPersonasDir(),
    projectRoot: ctx.paths.projectDir,
    logger: ctx.logger,
  })

  const personas = loader.discover()
  return personas.get(result.data.persona_id) ?? null
}

/**
 * Read the last-staged persona state for change detection.
 * Returns null if no state file exists (never staged).
 */
async function readLastStagedPersona(
  ctx: DaemonContext,
  sessionId: string
): Promise<{ personaId: string | null } | null> {
  const path = ctx.stateService.sessionStatePath(sessionId, 'last-staged-persona.json')
  const result = await ctx.stateService.read(path, LastStagedPersonaSchema, null)
  return result.data
}

/**
 * Write last-staged persona state after staging.
 */
async function writeLastStagedPersona(ctx: DaemonContext, sessionId: string, personaId: string | null): Promise<void> {
  const path = ctx.stateService.sessionStatePath(sessionId, 'last-staged-persona.json')
  await ctx.stateService.write(path, { personaId }, LastStagedPersonaSchema)
}

/**
 * Check if persona injection is enabled in config.
 * Defaults to true if not explicitly set.
 */
function isPersonaInjectionEnabled(ctx: DaemonContext): boolean {
  const featureConfig = ctx.config.getFeature<PersonaInjectionConfig>('session-summary')
  return featureConfig.settings?.personas?.injectPersonaIntoClaude ?? true
}

/**
 * Detect persona change and stage a one-shot "persona-changed" reminder if needed.
 * Compares the current persona against the last-staged state to determine
 * whether a genuine mid-session change occurred (vs. initial staging).
 */
async function stagePersonaChangedIfNeeded(
  ctx: DaemonContext,
  sessionId: string,
  persona: PersonaDefinition,
  templateContext: Record<string, string>
): Promise<void> {
  const lastStaged = await readLastStagedPersona(ctx, sessionId)
  const isGenuineChange =
    lastStaged !== null && // null = never staged (initialization) → skip
    lastStaged.personaId !== persona.id // different persona (including null→X for cleared→persona)

  if (!isGenuineChange) {
    ctx.logger.debug('Skipping persona-changed one-shot', {
      sessionId,
      reason: lastStaged === null ? 'first staging (initialization)' : 'same persona',
      personaId: persona.id,
    })
    return
  }

  logEvent(
    ctx.logger,
    LogEvents.personaChanged(
      { sessionId },
      {
        personaFrom: lastStaged.personaId ?? 'none',
        personaTo: persona.id,
        reason: 'mid_session_change',
      }
    )
  )

  const changedReminder = resolveReminder(ReminderIds.PERSONA_CHANGED, {
    context: templateContext,
    assets: ctx.assets,
    logger: ctx.logger,
  })
  if (changedReminder) {
    await stageReminder(ctx, 'UserPromptSubmit', changedReminder)
  } else {
    ctx.logger.warn('Failed to resolve persona-changed reminder', {
      reminderId: ReminderIds.PERSONA_CHANGED,
      sessionId,
    })
  }
}

/**
 * Stage persona reminders for a session.
 * Exported for use by daemon when persona changes mid-session.
 *
 * @param ctx - Daemon context
 * @param sessionId - Session to stage reminders for
 * @param options.includeChangedReminder - Whether to stage the one-shot "persona-changed" reminder
 */
export async function stagePersonaRemindersForSession(
  ctx: DaemonContext,
  sessionId: string,
  options?: { includeChangedReminder?: boolean }
): Promise<void> {
  if (!isPersonaInjectionEnabled(ctx)) {
    logEvent(
      ctx.logger,
      ReminderEvents.reminderNotStaged(
        { sessionId },
        {
          reminderName: 'remember-your-persona',
          hookName: 'PreToolUse',
          reason: 'feature_disabled',
        }
      )
    )
    await clearPersonaReminders(ctx, sessionId)
    ctx.logger.debug('Persona injection disabled by config, cleaned up reminders', { sessionId })
    return
  }

  const persona = await loadPersonaForSession(ctx, sessionId)

  if (!persona) {
    logEvent(
      ctx.logger,
      ReminderEvents.reminderNotStaged(
        { sessionId },
        {
          reminderName: 'remember-your-persona',
          hookName: 'PreToolUse',
          reason: 'no_persona',
        }
      )
    )
    await clearPersonaReminders(ctx, sessionId)
    ctx.logger.debug('Persona cleared or disabled, unstaged persona reminders', { sessionId })
    return
  }

  // Build template context from persona definition
  const templateContext = buildPersonaTemplateContext(persona)

  // Stage persistent "remember-your-persona" for both hooks
  const reminder = resolveReminder(ReminderIds.REMEMBER_YOUR_PERSONA, {
    context: templateContext,
    assets: ctx.assets,
    logger: ctx.logger,
  })
  if (reminder) {
    for (const targetHook of PERSONA_REMINDER_HOOKS) {
      await stageReminder(ctx, targetHook, reminder)
      // Register for throttle re-staging (UserPromptSubmit only)
      if (targetHook === 'UserPromptSubmit') {
        await registerThrottledReminder(ctx, sessionId, ReminderIds.REMEMBER_YOUR_PERSONA, 'UserPromptSubmit', reminder)
      }
    }
  } else {
    ctx.logger.warn('Failed to resolve persona reminder', {
      reminderId: ReminderIds.REMEMBER_YOUR_PERSONA,
      sessionId,
    })
    return
  }

  // Stage one-shot persona-changed reminder if persona actually changed
  if (options?.includeChangedReminder) {
    await stagePersonaChangedIfNeeded(ctx, sessionId, persona, templateContext)
  }

  // Record what we just staged for future change detection
  await writeLastStagedPersona(ctx, sessionId, persona.id)

  ctx.logger.info('Staged persona reminders', {
    sessionId,
    personaId: persona.id,
    includeChanged: options?.includeChangedReminder ?? false,
  })
}

/**
 * Register the persona reminder staging handler.
 * Triggers on SessionStart to stage persona reminders for the session.
 */
export function registerStagePersonaReminders(context: RuntimeContext): void {
  if (!isDaemonContext(context)) return

  context.handlers.register({
    id: 'reminders:stage-persona-reminders',
    priority: 40, // Run after persona selection (priority 80) has completed
    filter: { kind: 'hook', hooks: ['SessionStart'] },
    handler: async (event: SidekickEvent, ctx: HandlerContext) => {
      if (!isDaemonContext(ctx as unknown as RuntimeContext)) return
      if (!isHookEvent(event) || !isSessionStartEvent(event)) return

      const daemonCtx = ctx as unknown as DaemonContext
      const sessionId = event.context.sessionId

      await stagePersonaRemindersForSession(daemonCtx, sessionId)
    },
  })
}
