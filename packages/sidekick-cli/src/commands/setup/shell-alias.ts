// packages/sidekick-cli/src/commands/setup/shell-alias.ts
import * as fs from 'node:fs'

const MARKER_START = '# >>> sidekick alias >>>'
const MARKER_END = '# <<< sidekick alias <<<'
const ALIAS_LINE = "alias sidekick='npx @scotthamilton77/sidekick'"

export interface ShellInfo {
  shell: 'zsh' | 'bash'
  rcFile: '.zshrc' | '.bashrc'
}

export function detectShell(shellEnv: string | undefined): ShellInfo | null {
  if (!shellEnv) return null
  if (shellEnv.endsWith('/zsh')) return { shell: 'zsh', rcFile: '.zshrc' }
  if (shellEnv.endsWith('/bash')) return { shell: 'bash', rcFile: '.bashrc' }
  return null
}

export function getAliasBlock(): string {
  return `${MARKER_START}\n${ALIAS_LINE}\n${MARKER_END}\n`
}

function readFileOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

export function isAliasInRcFile(rcFilePath: string): boolean {
  const content = readFileOrNull(rcFilePath)
  if (content === null) return false
  return content.includes(MARKER_START)
}

export function installAlias(rcFilePath: string): 'installed' | 'already-installed' {
  const content = readFileOrNull(rcFilePath) ?? ''
  if (content.includes(MARKER_START)) return 'already-installed'

  const suffix = content.length > 0 && !content.endsWith('\n') ? '\n' : ''
  fs.writeFileSync(rcFilePath, content + suffix + getAliasBlock())
  return 'installed'
}

export function uninstallAlias(rcFilePath: string): 'removed' | 'not-found' {
  const content = readFileOrNull(rcFilePath)
  if (content === null || !content.includes(MARKER_START) || !content.includes(MARKER_END)) return 'not-found'

  const startIdx = content.indexOf(MARKER_START)
  const endIdx = content.indexOf(MARKER_END)
  if (endIdx < startIdx) return 'not-found'

  const before = content.substring(0, startIdx)
  let afterStart = endIdx + MARKER_END.length
  if (content[afterStart] === '\n') afterStart += 1
  const after = content.substring(afterStart)
  fs.writeFileSync(rcFilePath, before + after)
  return 'removed'
}
