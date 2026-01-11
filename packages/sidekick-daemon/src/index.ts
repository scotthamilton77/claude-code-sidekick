/**
 * Daemon Process Entrypoint
 *
 * This is the main entry point for the detached daemon process.
 * The daemon handles:
 * - Single-writer state management
 * - Background task execution
 * - IPC communication with CLI
 *
 * Error handling (uncaughtException, unhandledRejection) is set up
 * inside Daemon.start() per design docs.
 */

import { Daemon } from './daemon.js'

const projectDir = process.argv[2] || process.cwd()

const daemon = new Daemon(projectDir)

void daemon.start()

// Handle signals - wrap async stop in void to prevent floating promises
process.on('SIGTERM', () => void daemon.stop())
process.on('SIGINT', () => void daemon.stop())
