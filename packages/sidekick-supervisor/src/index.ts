/**
 * Supervisor Process Entrypoint
 *
 * This is the main entry point for the detached supervisor process.
 * The supervisor handles:
 * - Single-writer state management
 * - Background task execution
 * - IPC communication with CLI
 *
 * Error handling (uncaughtException, unhandledRejection) is set up
 * inside Supervisor.start() per LLD-SUPERVISOR §5.
 *
 * @see LLD-SUPERVISOR.md
 */

import { Supervisor } from './supervisor.js'

const projectDir = process.argv[2] || process.cwd()

const supervisor = new Supervisor(projectDir)

void supervisor.start()

// Handle signals - wrap async stop in void to prevent floating promises
process.on('SIGTERM', () => void supervisor.stop())
process.on('SIGINT', () => void supervisor.stop())
