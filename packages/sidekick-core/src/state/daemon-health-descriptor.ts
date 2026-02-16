/**
 * Daemon Health State Descriptor
 *
 * Descriptor for daemon runtime health state file.
 * Written by CLI (on startup transitions) and daemon (on successful start).
 * Read by feature-statusline for degraded mode display.
 *
 * @see docs/plans/2026-02-16-daemon-health-state-design.md
 */

import { DaemonHealthSchema } from '@sidekick/types'
import type { DaemonHealth } from '@sidekick/types'
import { globalState } from './state-descriptor.js'

const DEFAULT_DAEMON_HEALTH: DaemonHealth = {
  status: 'unknown',
  lastCheckedAt: new Date(0).toISOString(),
}

/**
 * Daemon health state descriptor (global/project-level).
 * Tracks whether the daemon process started successfully.
 */
export const DaemonHealthDescriptor = globalState('daemon-health.json', DaemonHealthSchema, DEFAULT_DAEMON_HEALTH)
