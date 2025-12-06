/**
 * Reminder Utilities
 *
 * Provides core operations for the reminder system:
 * - Loading and resolving reminder definitions from YAML
 * - Template interpolation for dynamic content
 * - Staging and consumption coordination
 *
 * @see docs/design/FEATURE-REMINDERS.md §3.2
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as yaml from 'js-yaml'
import { z } from 'zod'
import type { StagedReminder, SupervisorContext } from '@sidekick/types'
import type { TemplateContext } from './types'

/**
 * Zod schema for runtime validation of YAML reminder definitions.
 * Ensures parsed YAML matches expected structure.
 */
const ReminderDefinitionSchema = z.object({
  id: z.string(),
  blocking: z.boolean(),
  priority: z.number(),
  persistent: z.boolean(),
  userMessage: z.string().optional(),
  additionalContext: z.string().optional(),
  stopReason: z.string().optional(),
})

// Asset paths for reminder definitions
const REMINDER_ASSET_DIR = 'reminders'

/**
 * Interpolate {{variable}} placeholders in a template string.
 */
export function interpolateTemplate(template: string, context: TemplateContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = context[key as keyof TemplateContext]
    if (value === undefined || value === null) return match
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }
    return match
  })
}

/**
 * Load and resolve a reminder definition from YAML.
 * Uses asset cascade: project → user → bundled defaults.
 *
 * @param reminderId - Reminder ID (matches filename without .yaml)
 * @param context - Template variables for interpolation
 * @param assetsDir - Base assets directory (for testing)
 * @returns Resolved StagedReminder ready for staging, or null if not found
 */
export function resolveReminder(
  reminderId: string,
  context: TemplateContext,
  assetsDir?: string
): StagedReminder | null {
  // Try to load from assets directory
  const baseDir = assetsDir ?? join(process.cwd(), 'assets', 'sidekick')
  const yamlPath = join(baseDir, REMINDER_ASSET_DIR, `${reminderId}.yaml`)

  if (!existsSync(yamlPath)) {
    return null
  }

  try {
    const content = readFileSync(yamlPath, 'utf-8')
    const parsed = yaml.load(content)
    const def = ReminderDefinitionSchema.parse(parsed)

    // Interpolate template variables
    return {
      name: def.id,
      blocking: def.blocking,
      priority: def.priority,
      persistent: def.persistent,
      userMessage: def.userMessage ? interpolateTemplate(def.userMessage, context) : undefined,
      additionalContext: def.additionalContext ? interpolateTemplate(def.additionalContext, context) : undefined,
      stopReason: def.stopReason ? interpolateTemplate(def.stopReason, context) : undefined,
    }
  } catch (err) {
    console.error(`Failed to load reminder ${reminderId}:`, err)
    return null
  }
}

/**
 * Stage a reminder for a specific hook.
 * Delegates to StagingService for atomic file operations.
 */
export async function stageReminder(ctx: SupervisorContext, hookName: string, reminder: StagedReminder): Promise<void> {
  await ctx.staging.stageReminder(hookName, reminder.name, reminder)
  ctx.logger.debug('Staged reminder', { hookName, reminderName: reminder.name, priority: reminder.priority })
}

/**
 * Consume the highest-priority staged reminder for a hook.
 * Checks suppression first, then returns and optionally deletes the reminder.
 */
export async function consumeReminder(ctx: SupervisorContext, hookName: string): Promise<StagedReminder | null> {
  // Check suppression first
  const suppressed = await ctx.staging.isHookSuppressed(hookName)
  if (suppressed) {
    await ctx.staging.clearSuppression(hookName)
    ctx.logger.debug('Suppression cleared, no reminder consumed', { hookName })
    return null
  }

  // Get all reminders for this hook, sorted by priority
  const reminders = await ctx.staging.listReminders(hookName)
  if (reminders.length === 0) {
    return null
  }

  // Take highest priority (already sorted)
  const reminder = reminders[0]

  // Delete if not persistent
  if (!reminder.persistent) {
    await ctx.staging.deleteReminder(hookName, reminder.name)
  }

  ctx.logger.debug('Consumed reminder', {
    hookName,
    reminderName: reminder.name,
    persistent: reminder.persistent,
  })
  return reminder
}

/**
 * Suppress all reminders for a hook.
 * Creates marker file that causes next consumption to return null.
 */
export async function suppressHook(ctx: SupervisorContext, hookName: string): Promise<void> {
  await ctx.staging.suppressHook(hookName)
  ctx.logger.debug('Suppressed hook', { hookName })
}

/**
 * Clear suppression for a hook.
 */
export async function clearSuppression(ctx: SupervisorContext, hookName: string): Promise<void> {
  await ctx.staging.clearSuppression(hookName)
}
