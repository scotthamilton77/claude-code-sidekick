import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export type Scope = 'project' | 'user'

export interface ScopeResolutionInput {
  hookScriptPath?: string
  projectDir?: string
  scopeOverride?: Scope
  cwd?: string
  homeDir?: string
}

export interface ScopeResolution {
  scope: Scope
  source: 'override' | 'hook-script-path' | 'cwd-fallback' | 'default'
  hookScriptPath?: string
  projectRoot?: string
  warnings: string[]
  dualInstallDetected: boolean
}

const SIDEKICK_HOOK_SEGMENT = `${path.sep}.claude${path.sep}hooks${path.sep}sidekick${path.sep}`

function normalizeHookPath(hookScriptPath: string): string {
  try {
    return realpathSync(hookScriptPath)
  } catch {
    // Fall back to resolved path if realpath fails (e.g., broken symlink)
    return path.resolve(hookScriptPath)
  }
}

function deriveProjectRootFromHook(hookScriptPath: string): string | undefined {
  const index = hookScriptPath.lastIndexOf(SIDEKICK_HOOK_SEGMENT)
  if (index === -1) {
    return undefined
  }
  return hookScriptPath.slice(0, index)
}

function findNearestSidekickDir(startDir: string): string | undefined {
  let current = path.resolve(startDir)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(current, '.claude', 'hooks', 'sidekick')
    if (existsSync(candidate)) {
      return candidate
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
}

function projectHasSidekickInstall(projectDir: string): boolean {
  const targets = [
    path.join(projectDir, '.claude', 'settings.json'),
    path.join(projectDir, '.claude', 'settings.json.local'),
  ]

  return targets.some((filePath) => {
    if (!existsSync(filePath)) {
      return false
    }
    try {
      const contents = readFileSync(filePath, 'utf8')
      return contents.toLowerCase().includes('sidekick')
    } catch {
      return false
    }
  })
}

export function resolveScope(input: ScopeResolutionInput): ScopeResolution {
  const warnings: string[] = []
  const cwd = input.cwd ? path.resolve(input.cwd) : process.cwd()
  const hookScriptPath = input.hookScriptPath ? normalizeHookPath(input.hookScriptPath) : undefined
  const providedProjectDir = input.projectDir ? path.resolve(input.projectDir) : undefined
  const resolvedHomeDir = input.homeDir ? path.resolve(input.homeDir) : homedir()

  if (input.scopeOverride) {
    return {
      scope: input.scopeOverride,
      source: 'override',
      hookScriptPath,
      projectRoot: input.scopeOverride === 'project' ? providedProjectDir : undefined,
      warnings,
      dualInstallDetected: false,
    }
  }

  if (hookScriptPath) {
    if (hookScriptPath.startsWith(path.join(resolvedHomeDir, '.claude', 'hooks', 'sidekick'))) {
      const dualInstallDetected = Boolean(providedProjectDir && projectHasSidekickInstall(providedProjectDir))
      return {
        scope: 'user',
        source: 'hook-script-path',
        hookScriptPath,
        projectRoot: undefined,
        warnings,
        dualInstallDetected,
      }
    }

    const projectRoot = deriveProjectRootFromHook(hookScriptPath)
    if (projectRoot) {
      if (providedProjectDir && path.resolve(projectRoot) !== providedProjectDir) {
        warnings.push(
          'Project directory hint from --project-dir does not match path derived from --hook-script-path. Using hook-script-path.'
        )
      }
      return {
        scope: 'project',
        source: 'hook-script-path',
        hookScriptPath,
        projectRoot,
        warnings,
        dualInstallDetected: false,
      }
    }
  }

  const sidekickDir = findNearestSidekickDir(cwd)
  if (sidekickDir && !sidekickDir.startsWith(path.join(resolvedHomeDir, '.claude', 'hooks', 'sidekick'))) {
    return {
      scope: 'project',
      source: 'cwd-fallback',
      hookScriptPath,
      projectRoot: path.resolve(sidekickDir, '..', '..', '..'),
      warnings,
      dualInstallDetected: false,
    }
  }

  const dualInstallDetected = Boolean(providedProjectDir && projectHasSidekickInstall(providedProjectDir))
  return {
    scope: 'user',
    source: 'default',
    hookScriptPath,
    projectRoot: undefined,
    warnings,
    dualInstallDetected,
  }
}
