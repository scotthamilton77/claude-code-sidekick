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
import type { StagedReminder, DaemonContext } from '@sidekick/types'
import type { AssetResolver } from '@sidekick/core'
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
  throttle: z.boolean().optional(),
  userMessage: z.string().optional(),
  additionalContext: z.string().optional(),
  reason: z.string().optional(),
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
 * Options for resolving reminder definitions
 */
export interface ResolveReminderOptions {
  /** Template variables for interpolation */
  context?: TemplateContext
  /** Asset resolver (uses file system if not provided) */
  assets?: AssetResolver
  /** Base assets directory (fallback for testing) */
  assetsDir?: string
}

/**
 * Load and resolve a reminder definition from YAML.
 * Uses asset cascade: project → user → bundled defaults.
 *
 * @param reminderId - Reminder ID (matches filename without .yaml)
 * @param contextOrOptions - Template variables or full options object
 * @param assetsDir - Base assets directory (for testing, deprecated - use options.assetsDir)
 * @returns Resolved StagedReminder ready for staging, or null if not found
 */
export function resolveReminder(
  reminderId: string,
  contextOrOptions: TemplateContext | ResolveReminderOptions = {},
  assetsDir?: string
): StagedReminder | null {
  // Handle overloaded arguments
  let context: TemplateContext
  let assets: AssetResolver | undefined
  let baseAssetsDir: string | undefined

  if ('assets' in contextOrOptions || 'assetsDir' in contextOrOptions || 'context' in contextOrOptions) {
    const opts = contextOrOptions as ResolveReminderOptions
    context = opts.context ?? {}
    assets = opts.assets
    baseAssetsDir = opts.assetsDir ?? assetsDir
  } else {
    context = contextOrOptions as TemplateContext
    baseAssetsDir = assetsDir
  }

  // Try asset resolver first if available
  const relativePath = `${REMINDER_ASSET_DIR}/${reminderId}.yaml`
  let content: string | null = null

  if (assets) {
    content = assets.resolve(relativePath)
  }

  // Fall back to file system if no content from resolver
  if (!content) {
    const baseDir = baseAssetsDir ?? join(process.cwd(), 'assets', 'sidekick')
    const yamlPath = join(baseDir, REMINDER_ASSET_DIR, `${reminderId}.yaml`)

    if (!existsSync(yamlPath)) {
      return null
    }
    content = readFileSync(yamlPath, 'utf-8')
  }

  try {
    const parsed = yaml.load(content)
    const def = ReminderDefinitionSchema.parse(parsed)

    // Interpolate template variables
    return {
      name: def.id,
      blocking: def.blocking,
      priority: def.priority,
      persistent: def.persistent,
      throttle: def.throttle,
      userMessage: def.userMessage ? interpolateTemplate(def.userMessage, context) : undefined,
      additionalContext: def.additionalContext ? interpolateTemplate(def.additionalContext, context) : undefined,
      reason: def.reason ? interpolateTemplate(def.reason, context) : undefined,
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
export async function stageReminder(ctx: DaemonContext, hookName: string, reminder: StagedReminder): Promise<void> {
  await ctx.staging.stageReminder(hookName, reminder.name, reminder)
  ctx.logger.debug('Staged reminder', { hookName, reminderName: reminder.name, priority: reminder.priority })
}

/**
 * Consume the highest-priority staged reminder for a hook.
 * Returns and optionally deletes the reminder.
 */
export async function consumeReminder(ctx: DaemonContext, hookName: string): Promise<StagedReminder | null> {
  // Get all reminders for this hook
  const reminders = await ctx.staging.listReminders(hookName)
  if (reminders.length === 0) {
    return null
  }

  // Sort by priority descending and take highest
  reminders.sort((a, b) => b.priority - a.priority)
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
