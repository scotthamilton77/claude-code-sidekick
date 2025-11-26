/**
 * Supervisor Command Handler
 *
 * Implements CLI commands for supervisor lifecycle management.
 *
 * Commands:
 * - start: Start the project-local supervisor
 * - stop: Gracefully stop the supervisor via IPC
 * - status: Check supervisor status and ping
 * - kill: Forcefully kill project-local supervisor (SIGKILL)
 * - kill-all: Kill all supervisors across all projects
 *
 * @see LLD-CLI.md §7 Supervisor Lifecycle Management
 */
import { killAllSupervisors, Logger, SupervisorClient } from '@sidekick/core'

export async function handleSupervisorCommand(
  subcommand: string,
  projectDir: string,
  logger: Logger,
  stdout: NodeJS.WritableStream
): Promise<void> {
  const client = new SupervisorClient(projectDir, logger)

  switch (subcommand) {
    case 'start':
      await client.start()
      stdout.write('Supervisor started\n')
      break

    case 'stop':
      await client.stop()
      stdout.write('Supervisor stopped\n')
      break

    case 'status': {
      const statusResult = await client.getStatus()
      stdout.write(JSON.stringify(statusResult, null, 2) + '\n')
      break
    }

    case 'kill': {
      const killResult = await client.kill()
      if (killResult.killed) {
        stdout.write(`Killed supervisor (PID ${killResult.pid})\n`)
      } else {
        stdout.write('No supervisor running\n')
      }
      break
    }

    case 'kill-all': {
      const results = await killAllSupervisors(logger)
      if (results.length === 0) {
        stdout.write('No supervisors found\n')
      } else {
        for (const result of results) {
          if (result.killed) {
            stdout.write(`Killed: PID ${result.pid} (${result.projectDir})\n`)
          } else {
            stdout.write(`Failed: PID ${result.pid} (${result.projectDir}): ${result.error}\n`)
          }
        }
        const killedCount = results.filter((r) => r.killed).length
        stdout.write(`\nKilled ${killedCount} of ${results.length} supervisors\n`)
      }
      break
    }

    default:
      stdout.write(`Unknown supervisor subcommand: ${subcommand}\n`)
      stdout.write('Available commands: start, stop, status, kill, kill-all\n')
      process.exit(1)
  }
}
