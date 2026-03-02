/**
 * User Profile Setup Step
 *
 * Collects or confirms user profile details (name, role, interests)
 * and writes ~/.sidekick/user.yaml.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { loadUserProfile } from '@sidekick/core'
import { printHeader, printStatus, promptConfirm, promptInput, type PromptContext } from './prompts.js'

export interface UserProfileSetupResult {
  configured: boolean
}

/**
 * Serialize a user profile to YAML format.
 * Simple enough to avoid adding a yaml dependency to sidekick-cli.
 */
export function escapeYamlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function serializeProfileYaml(profile: { name: string; role: string; interests: string[] }): string {
  const lines = [`name: "${escapeYamlString(profile.name)}"`, `role: "${escapeYamlString(profile.role)}"`, 'interests:']
  for (const interest of profile.interests) {
    lines.push(`  - "${escapeYamlString(interest)}"`)
  }
  return lines.join('\n') + '\n'
}

/**
 * Run the user profile setup step.
 * If profile exists, show and confirm. If not, collect details.
 */
export async function runUserProfileStep(ctx: PromptContext, homeDir: string): Promise<UserProfileSetupResult> {
  printHeader(ctx, 'Step 8: User Profile', 'Personas can personalize messages when they know who you are.')

  const existing = loadUserProfile({ homeDir })

  if (existing) {
    ctx.stdout.write(`  Current profile:\n`)
    ctx.stdout.write(`    Name: ${existing.name}\n`)
    ctx.stdout.write(`    Role: ${existing.role}\n`)
    ctx.stdout.write(`    Interests: ${existing.interests.join(', ')}\n\n`)

    const keepIt = await promptConfirm(ctx, 'Keep this profile?', true)
    if (keepIt) {
      printStatus(ctx, 'success', 'User profile unchanged')
      return { configured: true }
    }
  }

  const name = await promptInput(ctx, 'Your name:')
  if (!name.trim()) {
    printStatus(ctx, 'info', 'Skipped user profile (no name provided)')
    return { configured: false }
  }

  const role = await promptInput(ctx, 'Your role (e.g., Software Architect):')
  const interestsRaw = await promptInput(ctx, 'Interests (comma-separated, e.g., Sci-Fi, hiking):')

  const interests = interestsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const profile = { name: name.trim(), role: role.trim(), interests }

  const sidekickDir = path.join(homeDir, '.sidekick')
  await fs.mkdir(sidekickDir, { recursive: true })
  const filePath = path.join(sidekickDir, 'user.yaml')
  await fs.writeFile(filePath, serializeProfileYaml(profile), 'utf-8')

  printStatus(ctx, 'success', `User profile saved to ${filePath}`)
  return { configured: true }
}
