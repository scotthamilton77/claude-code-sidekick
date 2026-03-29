/**
 * Pure utility functions extracted from TranscriptLine for testability.
 * These handle text formatting and label derivation without any React dependency.
 */

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\u2026' : s
}

export function formatToolInput(toolName?: string, input?: Record<string, unknown>): string {
  if (!input) return ''
  if (toolName === 'Bash' && typeof input.command === 'string') {
    return truncate(input.command, 200)
  }
  if ((toolName === 'Read' || toolName === 'Edit' || toolName === 'Write') && typeof input.file_path === 'string') {
    return truncate(input.file_path, 200)
  }
  if (toolName === 'Grep' && typeof input.pattern === 'string') {
    return `/${truncate(input.pattern, 100)}/`
  }
  if (toolName === 'Glob' && typeof input.pattern === 'string') {
    return truncate(input.pattern, 200)
  }
  if (toolName === 'Agent' && typeof input.description === 'string') {
    return truncate(input.description, 200)
  }
  if (toolName === 'Skill' && typeof input.skill === 'string') {
    return truncate(input.skill, 200)
  }
  // Fallback: show first string value
  for (const val of Object.values(input)) {
    if (typeof val === 'string') return truncate(val, 150)
  }
  return ''
}

/** Only allow http/https URLs to prevent javascript: injection */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function formatDuration(ms?: number): string {
  if (ms == null) return '?'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** Extract command name from content containing <command-name> tag */
export function extractCommandName(content: string): string | null {
  const match = content.match(/<command-name>\/?([\w-]+)<\/command-name>/)
  return match ? match[1] : null
}

/** Extract skill name from content containing "Base directory for this skill:" path */
export function extractSkillName(content: string): string | null {
  const match = content.match(/Base directory for this skill:.*\/skills\/([\w-]+)/)
  return match ? match[1] : null
}

/** Derive a context-aware label for system-injection subtypes */
export function getSystemInjectionLabel(content: string): string {
  if (content.includes('SessionStart')) return 'Session start hook'
  if (content.includes('UserPromptSubmit')) return 'Prompt hook'
  if (content.includes('<system-reminder>')) return 'System reminder'
  return 'System injection'
}
