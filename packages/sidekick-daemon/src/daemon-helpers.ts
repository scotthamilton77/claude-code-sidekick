import { reconstructTranscriptPath, type ConfigService, type SidekickConfig, type Logger } from '@sidekick/core'

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
export const VERSION: string = require('../../../package.json').version

export const IDLE_CHECK_INTERVAL_MS = 30 * 1000
export const HEARTBEAT_INTERVAL_MS = 5 * 1000
export const EVICTION_INTERVAL_MS = 5 * 60 * 1000
export const REGISTRY_HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000

/** Compare two config objects and return a list of changed values. */
export function diffConfigs(
  oldConfig: SidekickConfig,
  newConfig: SidekickConfig,
  path: string[] = []
): Array<{ path: string; old: unknown; new: unknown }> {
  const changes: Array<{ path: string; old: unknown; new: unknown }> = []

  const compareObjects = (
    oldObj: Record<string, unknown>,
    newObj: Record<string, unknown>,
    currentPath: string[]
  ): void => {
    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)])

    for (const key of allKeys) {
      const oldVal = oldObj[key]
      const newVal = newObj[key]
      const keyPath = [...currentPath, key]

      if (oldVal === newVal) continue

      if (
        oldVal !== null &&
        newVal !== null &&
        typeof oldVal === 'object' &&
        typeof newVal === 'object' &&
        !Array.isArray(oldVal) &&
        !Array.isArray(newVal)
      ) {
        compareObjects(oldVal as Record<string, unknown>, newVal as Record<string, unknown>, keyPath)
      } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes.push({ path: keyPath.join('.'), old: oldVal, new: newVal })
      }
    }
  }

  compareObjects(oldConfig as unknown as Record<string, unknown>, newConfig as unknown as Record<string, unknown>, path)
  return changes
}

/** Resolve transcript path for a session, falling back to reconstructed path. */
export function resolveTranscriptPath(
  projectDir: string,
  sessionId: string,
  providedTranscriptPath: string | undefined,
  logger: Logger
): string {
  const transcriptPath = providedTranscriptPath ?? reconstructTranscriptPath(projectDir, sessionId)
  if (!providedTranscriptPath) {
    logger.debug('Reconstructed transcript path', { sessionId, transcriptPath })
  }
  return transcriptPath
}

/** Read persona injection enabled flag from config (defaults to true). */
export function getPersonaInjectionEnabled(config: ConfigService): boolean {
  type PersonaSettings = { personas?: { injectPersonaIntoClaude?: boolean } }
  return config.getFeature<PersonaSettings>('session-summary').settings?.personas?.injectPersonaIntoClaude ?? true
}
