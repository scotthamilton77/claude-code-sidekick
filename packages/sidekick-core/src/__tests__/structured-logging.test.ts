import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Writable, PassThrough } from 'node:stream'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'

// We'll import these once implemented
// For now, define the interfaces we expect to implement

// =============================================================================
// Types we expect to implement
// =============================================================================

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

interface LogContext {
  scope?: 'user' | 'project'
  correlationId?: string
  sessionId?: string
  component?: string
  command?: string
}

interface Logger {
  trace(msg: string, meta?: Record<string, unknown>): void
  debug(msg: string, meta?: Record<string, unknown>): void
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
  fatal(msg: string, meta?: Record<string, unknown>): void
  child(bindings: Record<string, unknown>): Logger
  flush(): Promise<void>
}

interface TelemetryMetric {
  name: string
  type: 'counter' | 'gauge' | 'histogram'
  value: number
  unit?: string
  tags?: Record<string, string>
}

interface Telemetry {
  increment(name: string, tags?: Record<string, string>): void
  gauge(name: string, value: number, tags?: Record<string, string>): void
  histogram(name: string, value: number, unit: string, tags?: Record<string, string>): void
}

interface LogManagerOptions {
  name?: string
  level?: LogLevel
  context?: LogContext
  destinations?: {
    file?: {
      path: string
      rotateSize?: number
      maxFiles?: number
    }
    console?: {
      enabled: boolean
      pretty?: boolean
    }
  }
  redactPaths?: string[]
}

// =============================================================================
// Test Helpers
// =============================================================================

function createTestStream(): { stream: Writable; lines: string[] } {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const line = chunk.toString().trim()
      if (line) {
        lines.push(line)
      }
      callback()
    },
  })
  return { stream, lines }
}

function parseLogLine(line: string): Record<string, unknown> {
  return JSON.parse(line)
}

// =============================================================================
// Tests - Log Shape & Content
// =============================================================================

describe('Structured Logging', () => {
  describe('Log Shape & Standard Fields', () => {
    it('should include all standard Pino fields', async () => {
      const { createLogManager } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'info',
        destinations: {
          console: { enabled: false },
        },
        testStream: stream, // For testing - writes to this stream
      })

      const logger = logManager.getLogger()
      logger.info('Test message')
      await logger.flush()

      expect(lines.length).toBe(1)
      const log = parseLogLine(lines[0])

      expect(log).toHaveProperty('level')
      expect(log).toHaveProperty('time')
      expect(log).toHaveProperty('pid')
      expect(log).toHaveProperty('hostname')
      expect(log).toHaveProperty('name', 'sidekick:test')
      expect(log).toHaveProperty('msg', 'Test message')
      expect(typeof log.level).toBe('number')
      expect(typeof log.time).toBe('number')
      expect(typeof log.pid).toBe('number')
    })

    it('should include context object when provided', async () => {
      const { createLogManager } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'info',
        context: {
          scope: 'project',
          correlationId: 'test-corr-123',
          command: 'session-start',
        },
        testStream: stream,
      })

      const logger = logManager.getLogger()
      logger.info('With context')
      await logger.flush()

      const log = parseLogLine(lines[0])
      expect(log).toHaveProperty('context')
      const context = log.context as LogContext
      expect(context.scope).toBe('project')
      expect(context.correlationId).toBe('test-corr-123')
      expect(context.command).toBe('session-start')
    })

    it('should merge additional meta with log entry', async () => {
      const { createLogManager } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'info',
        testStream: stream,
      })

      const logger = logManager.getLogger()
      logger.info('With meta', { foo: 'bar', count: 42 })
      await logger.flush()

      const log = parseLogLine(lines[0])
      expect(log).toHaveProperty('foo', 'bar')
      expect(log).toHaveProperty('count', 42)
    })

    it('should support child loggers with inherited context', async () => {
      const { createLogManager } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'info',
        context: {
          scope: 'project',
          correlationId: 'parent-123',
        },
        testStream: stream,
      })

      const parentLogger = logManager.getLogger()
      const childLogger = parentLogger.child({ component: 'feature-statusline' })
      childLogger.info('From child')
      await childLogger.flush()

      const log = parseLogLine(lines[0])
      expect(log).toHaveProperty('component', 'feature-statusline')
      // Context should still be present
      expect(log).toHaveProperty('context')
      const context = log.context as LogContext
      expect(context.correlationId).toBe('parent-123')
    })
  })

  // ===========================================================================
  // Tests - Log Levels
  // ===========================================================================

  describe('Log Levels', () => {
    it('should respect minimum log level', async () => {
      const { createLogManager } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'warn',
        testStream: stream,
      })

      const logger = logManager.getLogger()
      logger.debug('Debug msg') // Should be filtered
      logger.info('Info msg') // Should be filtered
      logger.warn('Warn msg') // Should appear
      logger.error('Error msg') // Should appear
      await logger.flush()

      expect(lines.length).toBe(2)
      expect(parseLogLine(lines[0]).msg).toBe('Warn msg')
      expect(parseLogLine(lines[1]).msg).toBe('Error msg')
    })

    it('should map log levels to correct Pino numeric values', async () => {
      const { createLogManager, LOG_LEVELS } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'trace',
        testStream: stream,
      })

      const logger = logManager.getLogger()
      logger.trace('trace')
      logger.debug('debug')
      logger.info('info')
      logger.warn('warn')
      logger.error('error')
      logger.fatal('fatal')
      await logger.flush()

      expect(lines.length).toBe(6)
      expect(parseLogLine(lines[0]).level).toBe(LOG_LEVELS.trace)
      expect(parseLogLine(lines[1]).level).toBe(LOG_LEVELS.debug)
      expect(parseLogLine(lines[2]).level).toBe(LOG_LEVELS.info)
      expect(parseLogLine(lines[3]).level).toBe(LOG_LEVELS.warn)
      expect(parseLogLine(lines[4]).level).toBe(LOG_LEVELS.error)
      expect(parseLogLine(lines[5]).level).toBe(LOG_LEVELS.fatal)
    })

    it('should support runtime log level changes via setLevel', async () => {
      const { createLogManager } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'warn', // Start with warn level
        testStream: stream,
      })

      const logger = logManager.getLogger()

      // Debug should be filtered at warn level
      logger.debug('Debug before setLevel')
      logger.warn('Warn before setLevel')
      await logger.flush()

      expect(lines.length).toBe(1)
      expect(parseLogLine(lines[0]).msg).toBe('Warn before setLevel')

      // Change to debug level at runtime
      logManager.setLevel('debug')

      // Now debug should appear
      logger.debug('Debug after setLevel')
      logger.warn('Warn after setLevel')
      await logger.flush()

      expect(lines.length).toBe(3)
      expect(parseLogLine(lines[1]).msg).toBe('Debug after setLevel')
      expect(parseLogLine(lines[2]).msg).toBe('Warn after setLevel')
    })
  })

  // ===========================================================================
  // Tests - Redaction
  // ===========================================================================

  describe('Redaction & Privacy', () => {
    it('should redact sensitive keys by default', async () => {
      const { createLogManager } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'info',
        testStream: stream,
      })

      const logger = logManager.getLogger()
      logger.info('Sensitive data', {
        apiKey: 'sk-secret-123',
        token: 'bearer-token-xyz',
        secret: 'super-secret',
        authorization: 'Bearer xyz',
        password: 'hunter2',
        key: 'another-key',
        safeField: 'this-is-fine',
      })
      await logger.flush()

      const log = parseLogLine(lines[0])
      expect(log.apiKey).toBe('[Redacted]')
      expect(log.token).toBe('[Redacted]')
      expect(log.secret).toBe('[Redacted]')
      expect(log.authorization).toBe('[Redacted]')
      expect(log.password).toBe('[Redacted]')
      expect(log.key).toBe('[Redacted]')
      expect(log.safeField).toBe('this-is-fine')
    })

    it('should redact nested sensitive keys', async () => {
      const { createLogManager } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'info',
        testStream: stream,
      })

      const logger = logManager.getLogger()
      logger.info('Nested secrets', {
        config: {
          apiKey: 'nested-secret',
          settings: {
            token: 'deep-nested-token',
          },
        },
      })
      await logger.flush()

      const log = parseLogLine(lines[0])
      const config = log.config as Record<string, unknown>
      expect(config.apiKey).toBe('[Redacted]')
      const settings = config.settings as Record<string, unknown>
      expect(settings.token).toBe('[Redacted]')
    })

    it('should allow custom redaction paths', async () => {
      const { createLogManager } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'info',
        redactPaths: ['customSecret', 'nested.sensitiveField'],
        testStream: stream,
      })

      const logger = logManager.getLogger()
      logger.info('Custom redaction', {
        customSecret: 'my-custom-secret',
        nested: { sensitiveField: 'hidden' },
      })
      await logger.flush()

      const log = parseLogLine(lines[0])
      expect(log.customSecret).toBe('[Redacted]')
      const nested = log.nested as Record<string, unknown>
      expect(nested.sensitiveField).toBe('[Redacted]')
    })
  })

  // ===========================================================================
  // Tests - Telemetry
  // ===========================================================================

  describe('Telemetry', () => {
    it('should emit counter metrics with event_type="telemetry"', async () => {
      const { createLogManager } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'info',
        testStream: stream,
      })

      const telemetry = logManager.getTelemetry()
      telemetry.increment('hook_executions', { hook: 'session-start' })
      await logManager.getLogger().flush()

      expect(lines.length).toBe(1)
      const log = parseLogLine(lines[0])
      expect(log.event_type).toBe('telemetry')
      expect(log).toHaveProperty('metric')
      const metric = log.metric as TelemetryMetric
      expect(metric.name).toBe('hook_executions')
      expect(metric.type).toBe('counter')
      expect(metric.value).toBe(1)
      expect(metric.tags).toEqual({ hook: 'session-start' })
    })

    it('should emit gauge metrics', async () => {
      const { createLogManager } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'info',
        testStream: stream,
      })

      const telemetry = logManager.getTelemetry()
      telemetry.gauge('active_sessions', 5, { scope: 'project' })
      await logManager.getLogger().flush()

      const log = parseLogLine(lines[0])
      expect(log.event_type).toBe('telemetry')
      const metric = log.metric as TelemetryMetric
      expect(metric.name).toBe('active_sessions')
      expect(metric.type).toBe('gauge')
      expect(metric.value).toBe(5)
    })

    it('should emit histogram metrics with unit', async () => {
      const { createLogManager } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'info',
        testStream: stream,
      })

      const telemetry = logManager.getTelemetry()
      telemetry.histogram('llm_request_duration', 450, 'ms', { provider: 'anthropic' })
      await logManager.getLogger().flush()

      const log = parseLogLine(lines[0])
      expect(log.event_type).toBe('telemetry')
      const metric = log.metric as TelemetryMetric
      expect(metric.name).toBe('llm_request_duration')
      expect(metric.type).toBe('histogram')
      expect(metric.value).toBe(450)
      expect(metric.unit).toBe('ms')
      expect(metric.tags).toEqual({ provider: 'anthropic' })
    })
  })

  // ===========================================================================
  // Tests - Two-Phase Logger Facade
  // ===========================================================================

  describe('Two-Phase Logger Facade', () => {
    it('should start with bootstrap logger and transition to Pino', async () => {
      const { createLoggerFacade } = await import('../structured-logging')
      const { stream: bootstrapStream, lines: bootstrapLines } = createTestStream()
      const { stream: pinoStream, lines: pinoLines } = createTestStream()

      // Create facade with bootstrap logger
      const facade = createLoggerFacade({
        bootstrapSink: bootstrapStream,
      })

      // Initial logging goes to bootstrap
      facade.info('Bootstrap message')

      // Upgrade to Pino
      facade.upgrade({
        name: 'sidekick:test',
        level: 'info',
        testStream: pinoStream,
      })

      // Subsequent logging goes to Pino
      facade.info('Pino message')
      await facade.flush()

      expect(bootstrapLines.length).toBe(1)
      expect(bootstrapLines[0]).toContain('Bootstrap message')

      expect(pinoLines.length).toBe(1)
      const pinoLog = parseLogLine(pinoLines[0])
      expect(pinoLog.msg).toBe('Pino message')
    })

    it('should buffer logs during transition if configured', async () => {
      const { createLoggerFacade } = await import('../structured-logging')
      const { stream: pinoStream, lines: pinoLines } = createTestStream()

      const facade = createLoggerFacade({
        bufferPreUpgrade: true,
      })

      // Log before upgrade (should be buffered)
      facade.warn('Pre-upgrade warning')
      facade.error('Pre-upgrade error')

      // Upgrade to Pino
      facade.upgrade({
        name: 'sidekick:test',
        level: 'info',
        testStream: pinoStream,
      })

      // Flush should emit buffered logs
      await facade.flush()

      expect(pinoLines.length).toBe(2)
      expect(parseLogLine(pinoLines[0]).msg).toBe('Pre-upgrade warning')
      expect(parseLogLine(pinoLines[1]).msg).toBe('Pre-upgrade error')
    })
  })

  // ===========================================================================
  // Tests - Fallback Behavior
  // ===========================================================================

  describe('Fallback Behavior', () => {
    it('should fallback to console logger if Pino init fails', async () => {
      const { createLoggerFacade } = await import('../structured-logging')
      const { stream: fallbackStream, lines: fallbackLines } = createTestStream()

      const facade = createLoggerFacade({
        bootstrapSink: fallbackStream,
      })

      // Simulate Pino failure by passing invalid config
      facade.upgrade({
        name: 'sidekick:test',
        level: 'info',
        destinations: {
          file: {
            path: '/nonexistent/path/that/should/fail/deeply/nested/sidekick.log',
          },
        },
        onUpgradeError: (err) => {
          facade.warn('Pino init failed, using fallback', { error: err.message })
        },
      })

      // Should still be able to log using fallback
      facade.info('Fallback message')
      await facade.flush()

      // Should have warning about Pino failure and the fallback message
      expect(fallbackLines.some((l) => l.includes('Fallback message'))).toBe(true)
    })
  })

  // ===========================================================================
  // Tests - File Transport
  // ===========================================================================

  describe('File Transport', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-log-test-'))
    })

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('should write logs to file in NDJSON format', async () => {
      const { createLogManager } = await import('../structured-logging')
      const logPath = path.join(tempDir, 'sidekick.log')

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'info',
        destinations: {
          file: {
            path: logPath,
          },
          console: { enabled: false },
        },
      })

      const logger = logManager.getLogger()
      logger.info('File log 1')
      logger.info('File log 2')
      await logger.flush()

      // Give file system a moment
      await new Promise((r) => setTimeout(r, 100))

      const content = fs.readFileSync(logPath, 'utf8')
      const lines = content.trim().split('\n')
      expect(lines.length).toBe(2)

      const log1 = JSON.parse(lines[0])
      const log2 = JSON.parse(lines[1])
      expect(log1.msg).toBe('File log 1')
      expect(log2.msg).toBe('File log 2')
    })

    it('should create log directory if it does not exist', async () => {
      const { createLogManager } = await import('../structured-logging')
      const nestedDir = path.join(tempDir, 'nested', 'logs')
      const logPath = path.join(nestedDir, 'sidekick.log')

      expect(fs.existsSync(nestedDir)).toBe(false)

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'info',
        destinations: {
          file: { path: logPath },
          console: { enabled: false },
        },
      })

      const logger = logManager.getLogger()
      logger.info('Creating directory')
      await logger.flush()

      await new Promise((r) => setTimeout(r, 100))

      expect(fs.existsSync(nestedDir)).toBe(true)
      expect(fs.existsSync(logPath)).toBe(true)
    })
  })

  // ===========================================================================
  // Tests - ContextLogger Deep Merge
  // ===========================================================================

  describe('ContextLogger Deep Merge', () => {
    it('should deep-merge context when creating child loggers', async () => {
      const { createContextLogger } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      // Create root logger with initial context
      const rootLogger = createContextLogger({
        name: 'sidekick:test',
        level: 'info',
        source: 'cli',
        context: {
          sessionId: 'sess-123',
          scope: 'project',
        },
        testStream: stream,
      })

      // Create child with additional context - should merge, not replace
      const childLogger = rootLogger.child({
        context: {
          correlationId: 'corr-456',
          hook: 'UserPromptSubmit',
        },
      })

      childLogger.info('Child message')
      await childLogger.flush()

      expect(lines.length).toBe(1)
      const log = parseLogLine(lines[0])

      // Should have ALL context fields - both parent and child
      expect(log).toHaveProperty('context')
      const context = log.context as Record<string, unknown>
      expect(context.sessionId).toBe('sess-123') // From parent
      expect(context.scope).toBe('project') // From parent
      expect(context.correlationId).toBe('corr-456') // From child
      expect(context.hook).toBe('UserPromptSubmit') // From child
    })

    it('should allow child context to override parent context fields', async () => {
      const { createContextLogger } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const rootLogger = createContextLogger({
        name: 'sidekick:test',
        level: 'info',
        source: 'cli',
        context: {
          sessionId: 'sess-123',
          traceId: 'parent-trace',
        },
        testStream: stream,
      })

      // Child overrides traceId but inherits sessionId
      const childLogger = rootLogger.child({
        context: { traceId: 'child-trace' },
      })

      childLogger.info('Override test')
      await childLogger.flush()

      const log = parseLogLine(lines[0])
      const context = log.context as Record<string, unknown>
      expect(context.sessionId).toBe('sess-123') // Inherited
      expect(context.traceId).toBe('child-trace') // Overridden
    })

    it('should include source field in all log records', async () => {
      const { createContextLogger } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logger = createContextLogger({
        name: 'sidekick:cli',
        level: 'info',
        source: 'cli',
        testStream: stream,
      })

      logger.info('Source test')
      await logger.flush()

      const log = parseLogLine(lines[0])
      expect(log).toHaveProperty('source', 'cli')
    })

    it('should support multi-level child hierarchy with cumulative context', async () => {
      const { createContextLogger } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const rootLogger = createContextLogger({
        name: 'sidekick:test',
        level: 'info',
        source: 'supervisor',
        context: { sessionId: 'sess-root' },
        testStream: stream,
      })

      const level1 = rootLogger.child({ context: { traceId: 'trace-1' } })
      const level2 = level1.child({ context: { taskId: 'task-2' } })
      const level3 = level2.child({ context: { hook: 'PostToolUse' } })

      level3.info('Deep hierarchy')
      await level3.flush()

      const log = parseLogLine(lines[0])
      const context = log.context as Record<string, unknown>
      expect(context.sessionId).toBe('sess-root')
      expect(context.traceId).toBe('trace-1')
      expect(context.taskId).toBe('task-2')
      expect(context.hook).toBe('PostToolUse')
      expect(log.source).toBe('supervisor')
    })

    it('should not mutate parent logger context when creating children', async () => {
      const { createContextLogger } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const parentLogger = createContextLogger({
        name: 'sidekick:test',
        level: 'info',
        source: 'cli',
        context: { sessionId: 'sess-parent' },
        testStream: stream,
      })

      // Create child with extra context
      parentLogger.child({ context: { traceId: 'child-only' } })

      // Parent should not have child's context
      parentLogger.info('Parent log')
      await parentLogger.flush()

      const log = parseLogLine(lines[0])
      const context = log.context as Record<string, unknown>
      expect(context.sessionId).toBe('sess-parent')
      expect(context.traceId).toBeUndefined()
    })
  })

  // ===========================================================================
  // Tests - Source-Based Log Files
  // ===========================================================================

  describe('Source-Based Log Files', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-source-log-test-'))
    })

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('should write CLI logs to cli.log file', async () => {
      const { createContextLogger } = await import('../structured-logging')
      const logsDir = path.join(tempDir, 'logs')

      const logger = createContextLogger({
        name: 'sidekick:cli',
        level: 'info',
        source: 'cli',
        logsDir,
      })

      logger.info('CLI log entry')
      await logger.flush()

      await new Promise((r) => setTimeout(r, 100))

      const cliLogPath = path.join(logsDir, 'cli.log')
      expect(fs.existsSync(cliLogPath)).toBe(true)

      const content = fs.readFileSync(cliLogPath, 'utf8')
      const log = JSON.parse(content.trim())
      expect(log.source).toBe('cli')
      expect(log.msg).toBe('CLI log entry')
    })

    it('should write Supervisor logs to supervisor.log file', async () => {
      const { createContextLogger } = await import('../structured-logging')
      const logsDir = path.join(tempDir, 'logs')

      const logger = createContextLogger({
        name: 'sidekick:supervisor',
        level: 'info',
        source: 'supervisor',
        logsDir,
      })

      logger.info('Supervisor log entry')
      await logger.flush()

      await new Promise((r) => setTimeout(r, 100))

      const supervisorLogPath = path.join(logsDir, 'supervisor.log')
      expect(fs.existsSync(supervisorLogPath)).toBe(true)

      const content = fs.readFileSync(supervisorLogPath, 'utf8')
      const log = JSON.parse(content.trim())
      expect(log.source).toBe('supervisor')
      expect(log.msg).toBe('Supervisor log entry')
    })
  })

  // ===========================================================================
  // Tests - Error Handling Integration
  // ===========================================================================

  // ===========================================================================
  // Tests - Event Logging Helpers
  // ===========================================================================

  describe('Event Logging Helpers', () => {
    it('should create HookReceived events with correct structure', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.hookReceived(
        {
          sessionId: 'sess-123',
          scope: 'project',
          correlationId: 'corr-456',
          hook: 'UserPromptSubmit',
        },
        { cwd: '/workspaces/project', mode: 'hook' }
      )

      expect(event.type).toBe('HookReceived')
      expect(event.source).toBe('cli')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.context.scope).toBe('project')
      expect(event.context.correlationId).toBe('corr-456')
      expect(event.context.hook).toBe('UserPromptSubmit')
      expect(event.payload.metadata.cwd).toBe('/workspaces/project')
      expect(event.payload.metadata.mode).toBe('hook')
    })

    it('should create HookCompleted events with duration and state', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.hookCompleted(
        {
          sessionId: 'sess-123',
          hook: 'UserPromptSubmit',
        },
        { durationMs: 45 },
        { reminderReturned: true }
      )

      expect(event.type).toBe('HookCompleted')
      expect(event.source).toBe('cli')
      expect(event.payload.metadata.durationMs).toBe(45)
      expect(event.payload.state?.reminderReturned).toBe(true)
    })

    it('should create ReminderConsumed events', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.reminderConsumed(
        { sessionId: 'sess-123', hook: 'PreToolUse' },
        {
          reminderName: 'AreYouStuckReminder',
          reminderReturned: true,
          blocking: true,
          priority: 80,
        }
      )

      expect(event.type).toBe('ReminderConsumed')
      expect(event.source).toBe('cli')
      expect(event.payload.state.reminderName).toBe('AreYouStuckReminder')
      expect(event.payload.state.blocking).toBe(true)
    })

    it('should create EventReceived events for supervisor', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.eventReceived(
        { sessionId: 'sess-123', taskId: 'task-789' },
        { eventKind: 'hook', hook: 'PostToolUse' }
      )

      expect(event.type).toBe('EventReceived')
      expect(event.source).toBe('supervisor')
      expect(event.context.taskId).toBe('task-789')
      expect(event.payload.metadata.eventKind).toBe('hook')
      expect(event.payload.metadata.hook).toBe('PostToolUse')
    })

    it('should create HandlerExecuted events with success/failure', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.handlerExecuted(
        { sessionId: 'sess-123' },
        { handlerId: 'reminders:stage-stuck', success: true },
        { durationMs: 12 }
      )

      expect(event.type).toBe('HandlerExecuted')
      expect(event.source).toBe('supervisor')
      expect(event.payload.state.handlerId).toBe('reminders:stage-stuck')
      expect(event.payload.state.success).toBe(true)
      expect(event.payload.metadata.durationMs).toBe(12)
    })

    it('should create ReminderStaged events', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.reminderStaged(
        { sessionId: 'sess-123' },
        {
          reminderName: 'AreYouStuckReminder',
          hookName: 'PreToolUse',
          blocking: true,
          priority: 80,
          persistent: false,
        }
      )

      expect(event.type).toBe('ReminderStaged')
      expect(event.source).toBe('supervisor')
      expect(event.payload.state.reminderName).toBe('AreYouStuckReminder')
      expect(event.payload.state.hookName).toBe('PreToolUse')
    })

    it('should create SummaryUpdated events with reason', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.summaryUpdated(
        { sessionId: 'sess-123' },
        {
          session_title: 'Working on OAuth',
          session_title_confidence: 0.95,
          latest_intent: 'Fixing token expiration',
          latest_intent_confidence: 0.88,
        },
        {
          countdown_reset_to: 20,
          tokens_used: 150,
          processing_time_ms: 200,
          pivot_detected: false,
          old_title: 'Setting up OAuth',
          old_intent: 'Configuring provider',
        },
        'user_prompt_forced'
      )

      expect(event.type).toBe('SummaryUpdated')
      expect(event.source).toBe('supervisor')
      expect(event.payload.reason).toBe('user_prompt_forced')
      expect(event.payload.state.session_title).toBe('Working on OAuth')
      expect(event.payload.metadata.pivot_detected).toBe(false)
    })

    it('should create SummarySkipped events', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.summarySkipped({ sessionId: 'sess-123' }, { countdown: 5, countdown_threshold: 0 })

      expect(event.type).toBe('SummarySkipped')
      expect(event.source).toBe('supervisor')
      expect(event.payload.metadata.countdown).toBe(5)
      expect(event.payload.reason).toBe('countdown_active')
    })

    it('should create RemindersCleared events', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.remindersCleared(
        { sessionId: 'sess-123' },
        { clearedCount: 3, hookNames: ['PreToolUse', 'Stop'] },
        'session_start'
      )

      expect(event.type).toBe('RemindersCleared')
      expect(event.source).toBe('supervisor')
      expect(event.payload.state.clearedCount).toBe(3)
      expect(event.payload.reason).toBe('session_start')
    })

    it('should support logEvent helper to emit events via logger', async () => {
      const { createContextLogger, LogEvents, logEvent } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logger = createContextLogger({
        source: 'cli',
        context: { sessionId: 'sess-123' },
        testStream: stream,
      })

      const event = LogEvents.hookReceived({ sessionId: 'sess-123', hook: 'SessionStart' }, { mode: 'hook' })

      logEvent(logger, event)
      await logger.flush()

      expect(lines.length).toBe(1)
      const log = parseLogLine(lines[0])
      expect(log.type).toBe('HookReceived')
      expect(log.source).toBe('cli')
    })
  })

  describe('Error Handling', () => {
    it('should log errors with stack traces', async () => {
      const { createLogManager } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'info',
        testStream: stream,
      })

      const logger = logManager.getLogger()
      const testError = new Error('Test error message')
      logger.error('Operation failed', { err: testError })
      await logger.flush()

      const log = parseLogLine(lines[0])
      expect(log.msg).toBe('Operation failed')
      expect(log).toHaveProperty('err')
      const err = log.err as Record<string, unknown>
      expect(err.message).toBe('Test error message')
      expect(err.stack).toBeDefined()
    })

    it('should provide setupGlobalErrorHandlers utility', async () => {
      const { createLogManager, setupGlobalErrorHandlers } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'info',
        testStream: stream,
      })

      const cleanup = setupGlobalErrorHandlers(logManager.getLogger())

      // Emit an uncaughtException (but catch it for the test)
      const originalListeners = process.listeners('uncaughtException')
      process.removeAllListeners('uncaughtException')

      // Add our handler
      process.once('uncaughtException', () => {
        // Caught, test passes
      })

      // Simulate the error (will be caught by our handler)
      // Note: In real tests, we'd use a more sophisticated approach
      // For now, just verify the setup function exists and returns cleanup

      expect(typeof cleanup).toBe('function')

      // Restore original listeners
      cleanup()
      for (const listener of originalListeners) {
        process.on('uncaughtException', listener)
      }
    })
  })
})
