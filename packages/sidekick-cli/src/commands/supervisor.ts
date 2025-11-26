import { Logger, SupervisorClient } from '@sidekick/core'

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
    default:
      stdout.write(`Unknown supervisor subcommand: ${subcommand}\n`)
      process.exit(1)
  }
}
