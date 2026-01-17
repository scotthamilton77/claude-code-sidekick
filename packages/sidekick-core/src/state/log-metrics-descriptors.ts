/**
 * Log Metrics State Descriptors
 *
 * Descriptors for log metrics state files written by daemon and CLI.
 * These are read by feature-statusline for the {logs} template placeholder.
 *
 * @see docs/design/FEATURE-STATUSLINE.md §6.2
 */

import { LogMetricsStateSchema, EMPTY_LOG_METRICS } from '@sidekick/types'
import { sessionState, globalState } from './state-descriptor.js'

/**
 * Daemon log metrics state descriptor (per-session).
 * Written by sidekick-daemon, read by feature-statusline.
 */
export const DaemonLogMetricsDescriptor = sessionState(
  'daemon-log-metrics.json',
  LogMetricsStateSchema,
  EMPTY_LOG_METRICS
)

/**
 * CLI log metrics state descriptor (per-session).
 * Written by sidekick-cli, read by feature-statusline.
 */
export const CliLogMetricsDescriptor = sessionState('cli-log-metrics.json', LogMetricsStateSchema, EMPTY_LOG_METRICS)

/**
 * Daemon global log metrics state descriptor (project-level).
 * Written by sidekick-daemon for logs without session context.
 */
export const DaemonGlobalLogMetricsDescriptor = globalState(
  'daemon-global-log-metrics.json',
  LogMetricsStateSchema,
  EMPTY_LOG_METRICS
)
