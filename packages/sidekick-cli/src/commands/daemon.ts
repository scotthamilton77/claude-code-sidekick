/**
 * Daemon Command Handler
 *
 * Implements CLI commands for daemon lifecycle management.
 *
 * Commands:
 * - start: Start the project-local daemon
 * - stop: Gracefully stop the daemon via IPC (fire-and-forget)
 * - stop --wait: Stop and poll until daemon terminates or timeout
 * - status: Check daemon status and ping
 * - kill: Forcefully kill project-local daemon (SIGKILL)
 * - kill-all: Kill all daemons across all projects
 *
 * @see docs/design/CLI.md §7 Daemon Lifecycle Management
 */
import { killAllDaemons, killZombieDaemons, Logger, DaemonClient } from '@sidekick/core'
import type { KillResult } from '@sidekick/core'

export interface DaemonCommandOptions {
  wait?: boolean
  help?: boolean
}

export interface DaemonCommandResult {
  exitCode: number
}

const USAGE_TEXT = `Usage: sidekick daemon <command> [options]

Commands:
  start          Start the project-local daemon
  stop           Gracefully stop the daemon via IPC
  status         Check daemon status and ping
  kill           Forcefully terminate the daemon (SIGKILL)
  kill-all       Kill all daemons across all projects
  kill-zombies   Find and kill unregistered daemon processes

Options:
  --wait     Wait for daemon to fully stop (with 'stop' command)
  --help     Show this help message

Examples:
  sidekick daemon start
  sidekick daemon stop --wait
  sidekick daemon status
  sidekick daemon kill-all
  sidekick daemon kill-zombies
`

export async function handleDaemonCommand(
  subcommand: string,
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream,
  options: DaemonCommandOptions = {}
): Promise<DaemonCommandResult> {
  const client = new DaemonClient(projectDir, logger)

  switch (subcommand) {
    case 'start':
      await client.start()
      stdout.write('Daemon started\n')
      break

    case 'stop':
      if (options.wait) {
        const stopped = await client.stopAndWait()
        if (stopped) {
          stdout.write('Daemon stopped\n')
        } else {
          stdout.write('Warning: Daemon did not stop within timeout\n')
          stdout.write('Use "sidekick daemon kill" to forcefully terminate\n')
          return { exitCode: 1 }
        }
      } else {
        await client.stop()
        stdout.write('Daemon stopping\n')
      }
      break

    case 'status': {
      const statusResult = await client.getStatus()
      stdout.write(JSON.stringify(statusResult, null, 2) + '\n')
      break
    }

    case 'kill': {
      const killResult = await client.kill()
      if (killResult.killed) {
        stdout.write(`Killed daemon (PID ${killResult.pid})\n`)
      } else {
        stdout.write('No daemon running\n')
      }
      break
    }

    case 'kill-all': {
      const results = await killAllDaemons(logger)
      if (results.length === 0) {
        stdout.write('No daemons found\n')
      } else {
        for (const result of results) {
          if (result.killed) {
            stdout.write(`Killed: PID ${result.pid} (${result.projectDir})\n`)
          } else {
            stdout.write(`Failed: PID ${result.pid} (${result.projectDir}): ${result.error}\n`)
          }
        }
        const killedCount = results.filter((r: KillResult) => r.killed).length
        stdout.write(`\nKilled ${killedCount} of ${results.length} daemons\n`)
      }
      break
    }

    case 'kill-zombies': {
      const results = await killZombieDaemons(logger)
      if (results.length === 0) {
        stdout.write('No zombie daemons found\n')
      } else {
        for (const result of results) {
          if (result.killed) {
            stdout.write(`Killed zombie: PID ${result.pid}\n`)
          } else {
            stdout.write(`Failed: PID ${result.pid}: ${result.error}\n`)
          }
        }
        const killedCount = results.filter((r: KillResult) => r.killed).length
        stdout.write(`\nKilled ${killedCount} of ${results.length} zombie daemons\n`)
      }
      break
    }

    case 'help':
    case '--help':
    case '-h':
      stdout.write(USAGE_TEXT)
      return { exitCode: 0 }

    default:
      stdout.write(`Unknown daemon subcommand: ${subcommand}\n\n`)
      stdout.write(USAGE_TEXT)
      return { exitCode: 1 }
  }

  return { exitCode: 0 }
}
