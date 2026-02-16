/**
 * Stage persona reminders on SessionStart
 *
 * Stages a persistent "remember-your-persona" reminder for both
 * UserPromptSubmit and SessionStart hooks when the active persona
 * is not "disabled" and the injectPersonaIntoClaude config is true.
 *
 * Also exports a re-staging function for use when persona changes mid-session.
 *
 * @see docs/plans/2026-02-16-persona-injection.md
 */
import type { RuntimeContext } from '@sidekick/core'
import { createPersonaLoader, getDefaultPersonasDir } from '@sidekick/core'
import type { DaemonContext, HookName, PersonaDefinition, SidekickEvent, HandlerContext } from '@sidekick/types'
import { isDaemonContext, isHookEvent, isSessionStartEvent, SessionPersonaStateSchema } from '@sidekick/types'
import { resolveReminder, stageReminder } from '../../reminder-utils.js'
import { ReminderIds } from '../../types.js'

/** Minimal type for reading session-summary config without cross-feature import */
interface PersonaInjectionConfig {
  personas?: {
    injectPersonaIntoClaude?: boolean
  }
}

/** Target hooks for persona reminders */
const PERSONA_REMINDER_HOOKS: HookName[] = ['UserPromptSubmit', 'SessionStart']

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
 * Check if persona injection is enabled in config.
 * Defaults to true if not explicitly set.
 */
function isPersonaInjectionEnabled(ctx: DaemonContext): boolean {
  const featureConfig = ctx.config.getFeature<PersonaInjectionConfig>('session-summary')
  return featureConfig.settings?.personas?.injectPersonaIntoClaude ?? true
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
    ctx.logger.debug('Persona injection disabled by config', { sessionId })
    return
  }

  const persona = await loadPersonaForSession(ctx, sessionId)

  if (!persona) {
    // No active persona or disabled — remove any existing persona reminders
    for (const hook of PERSONA_REMINDER_HOOKS) {
      await ctx.staging.deleteReminder(hook, ReminderIds.REMEMBER_YOUR_PERSONA)
    }
    await ctx.staging.deleteReminder('UserPromptSubmit', ReminderIds.PERSONA_CHANGED)
    ctx.logger.debug('Persona cleared or disabled, unstaged persona reminders', { sessionId })
    return
  }

  // Build template context from persona definition
  const templateContext = buildPersonaTemplateContext(persona)

  // Stage persistent "remember-your-persona" for both hooks
  const reminder = resolveReminder(ReminderIds.REMEMBER_YOUR_PERSONA, {
    context: templateContext,
    assets: ctx.assets,
  })
  if (reminder) {
    for (const targetHook of PERSONA_REMINDER_HOOKS) {
      await stageReminder(ctx, targetHook, reminder)
    }
  } else {
    ctx.logger.warn('Failed to resolve persona reminder', {
      reminderId: ReminderIds.REMEMBER_YOUR_PERSONA,
      sessionId,
    })
    return
  }

  // Optionally stage one-shot "persona-changed" for UserPromptSubmit
  if (options?.includeChangedReminder) {
    const changedReminder = resolveReminder(ReminderIds.PERSONA_CHANGED, {
      context: templateContext,
      assets: ctx.assets,
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
