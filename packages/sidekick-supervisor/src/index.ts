import { Supervisor } from './supervisor.js'

const projectDir = process.argv[2] || process.cwd()

const supervisor = new Supervisor(projectDir)

void supervisor.start()

// Handle signals - wrap async stop in void to prevent floating promises
process.on('SIGTERM', () => void supervisor.stop())
process.on('SIGINT', () => void supervisor.stop())

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
  // Attempt graceful shutdown?
  process.exit(1)
})
