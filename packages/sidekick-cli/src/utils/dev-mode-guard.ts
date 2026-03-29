/**
 * Dev-mode conflict detection guard for the CLI package.
 *
 * Dev-mode hooks pass --force-dev-mode to identify themselves.
 * Plugin hooks (no --force-dev-mode) bail early if devMode flag is set,
 * letting the dev-mode hooks win. Safety net: if --force-dev-mode is
 * passed but the devMode flag is off, auto-correct it.
 */
import type { Logger } from '@sidekick/core'
import { SetupStatusService } from '@sidekick/core'

/**
 * Result of dev-mode conflict check.
 * - 'proceed': caller should continue with normal execution
 * - 'bail': caller should return an empty/no-op response immediately
 */
export type DevModeGuardResult = 'proceed' | 'bail'

/**
 * Check for dev-mode conflicts and auto-correct the devMode flag if needed.
 *
 * When forceDevMode is true (dev-mode hooks), ensures the devMode flag is on.
 * When forceDevMode is false/undefined (plugin hooks), checks the devMode flag
 * and returns 'bail' if dev-mode is active (plugin should defer to dev-mode hooks).
 *
 * @param projectRoot - Project root directory
 * @param forceDevMode - Whether --force-dev-mode was passed
 * @param logger - Logger for diagnostics
 * @param callerLabel - Label for log messages identifying the caller
 * @returns 'proceed' to continue execution, 'bail' to return empty response
 */
export async function checkDevModeConflict(
  projectRoot: string,
  forceDevMode: boolean | undefined,
  logger: Logger,
  callerLabel: string
): Promise<DevModeGuardResult> {
  if (forceDevMode) {
    try {
      const setupService = new SetupStatusService(projectRoot)
      const devMode = await setupService.getDevMode()
      if (!devMode) {
        logger.warn(`Dev-mode ${callerLabel} running but devMode flag is off — auto-correcting`, {
          caller: callerLabel,
        })
        await setupService.setDevMode(true)
      }
    } catch (err) {
      logger.warn(`Failed to auto-correct devMode flag for ${callerLabel}`, {
        error: err instanceof Error ? err.message : String(err),
        caller: callerLabel,
      })
    }
    return 'proceed'
  }

  try {
    const setupService = new SetupStatusService(projectRoot)
    const devMode = await setupService.getDevMode()
    if (devMode) {
      logger.debug(`Dev-mode active, ${callerLabel} bailing early (let dev-mode hooks win)`, {
        caller: callerLabel,
        devMode,
      })
      return 'bail'
    }
  } catch (err) {
    // Fail open: if we can't check status, proceed normally
    logger.warn(`Failed to check plugin/dev-mode status for ${callerLabel}, proceeding normally`, {
      error: err instanceof Error ? err.message : String(err),
      caller: callerLabel,
    })
  }

  return 'proceed'
}
