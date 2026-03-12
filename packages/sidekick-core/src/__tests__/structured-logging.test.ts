import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Writable, PassThrough } from 'node:stream'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'

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
      maxSizeBytes?: number
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

    it('should redact environment variable name keys for defense-in-depth', async () => {
      const { createLogManager } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'info',
        testStream: stream,
      })

      const logger = logManager.getLogger()
      logger.info('Env var leak', {
        OPENROUTER_API_KEY: 'or-leaked-key',
        OPENAI_API_KEY: 'sk-leaked-key',
        GITHUB_API_KEY: 'ghp-leaked-key',
        SAFE_VALUE: 'not-redacted',
      })
      await logger.flush()

      const log = parseLogLine(lines[0])
      expect(log.OPENROUTER_API_KEY).toBe('[Redacted]')
      expect(log.OPENAI_API_KEY).toBe('[Redacted]')
      expect(log.GITHUB_API_KEY).toBe('[Redacted]')
      expect(log.SAFE_VALUE).toBe('not-redacted')
    })

    it('should redact env var keys at nested levels', async () => {
      const { createLogManager } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'info',
        testStream: stream,
      })

      const logger = logManager.getLogger()
      logger.info('Nested env var leak', {
        config: {
          OPENAI_API_KEY: 'sk-nested-leak',
        },
      })
      await logger.flush()

      const log = parseLogLine(lines[0])
      const config = log.config as Record<string, unknown>
      expect(config.OPENAI_API_KEY).toBe('[Redacted]')
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
  // Tests - Child Logger and Upgrade State
  // ===========================================================================

  describe('Child Logger and Upgrade State', () => {
    it('should return isUpgraded false before upgrade', async () => {
      const { createLoggerFacade } = await import('../structured-logging')

      const facade = createLoggerFacade({})

      expect(facade.isUpgraded()).toBe(false)
    })

    it('should return isUpgraded true after upgrade', async () => {
      const { createLoggerFacade } = await import('../structured-logging')
      const { stream } = createTestStream()

      const facade = createLoggerFacade({})

      facade.upgrade({
        name: 'sidekick:test',
        level: 'info',
        testStream: stream,
      })

      expect(facade.isUpgraded()).toBe(true)
    })

    it('should create child logger before upgrade', async () => {
      const { createLoggerFacade } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const facade = createLoggerFacade({
        bootstrapSink: stream,
      })

      // Create child before upgrade
      const child = facade.child({ component: 'test-component' })

      // Child should be functional
      child.info('Child message before upgrade')

      expect(lines.length).toBe(1)
      expect(lines[0]).toContain('Child message before upgrade')
    })

    it('should create child logger after upgrade using Pino', async () => {
      const { createLoggerFacade } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const facade = createLoggerFacade({})

      // Upgrade first
      facade.upgrade({
        name: 'sidekick:test',
        level: 'info',
        testStream: stream,
      })

      // Create child after upgrade
      const child = facade.child({ component: 'test-component' })

      // Child should use Pino logger
      child.info('Child message after upgrade')
      await facade.flush()

      expect(lines.length).toBe(1)
      const logEntry = parseLogLine(lines[0])
      expect(logEntry.msg).toBe('Child message after upgrade')
      expect(logEntry.component).toBe('test-component')
    })

    it('should log error without buffering to bootstrap logger', async () => {
      const { createLoggerFacade } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      // No bufferPreUpgrade, so logs go directly to bootstrap
      const facade = createLoggerFacade({
        bootstrapSink: stream,
        bufferPreUpgrade: false,
      })

      facade.error('Direct error message')

      expect(lines.length).toBe(1)
      expect(lines[0]).toContain('Direct error message')
    })

    it('should log fatal without buffering to bootstrap logger', async () => {
      const { createLoggerFacade } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      // No bufferPreUpgrade, so logs go directly to bootstrap
      const facade = createLoggerFacade({
        bootstrapSink: stream,
        bufferPreUpgrade: false,
      })

      facade.fatal('Direct fatal message')

      expect(lines.length).toBe(1)
      expect(lines[0]).toContain('Direct fatal message')
    })

    it('should buffer fatal messages when bufferPreUpgrade is true', async () => {
      const { createLoggerFacade } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const facade = createLoggerFacade({
        bufferPreUpgrade: true,
      })

      // Log fatal before upgrade (should be buffered)
      facade.fatal('Buffered fatal message')

      // Upgrade to Pino
      facade.upgrade({
        name: 'sidekick:test',
        level: 'fatal',
        testStream: stream,
      })

      // Flush should emit buffered logs
      await facade.flush()

      expect(lines.length).toBe(1)
      const logEntry = parseLogLine(lines[0])
      expect(logEntry.msg).toBe('Buffered fatal message')
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
        source: 'daemon',
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
      expect(log.source).toBe('daemon')
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
        logFile: 'cli.log',
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

    it('should write Daemon logs to sidekickd.log file', async () => {
      const { createContextLogger } = await import('../structured-logging')
      const logsDir = path.join(tempDir, 'logs')

      const logger = createContextLogger({
        name: 'sidekick:daemon',
        level: 'info',
        source: 'daemon',
        logsDir,
        logFile: 'sidekickd.log',
      })

      logger.info('Daemon log entry')
      await logger.flush()

      await new Promise((r) => setTimeout(r, 100))

      const daemonLogPath = path.join(logsDir, 'sidekickd.log')
      expect(fs.existsSync(daemonLogPath)).toBe(true)

      const content = fs.readFileSync(daemonLogPath, 'utf8')
      const log = JSON.parse(content.trim())
      expect(log.source).toBe('daemon')
      expect(log.msg).toBe('Daemon log entry')
    })

    it('should throw when logsDir is provided without logFile', async () => {
      const { createContextLogger } = await import('../structured-logging')
      const logsDir = path.join(tempDir, 'logs')

      expect(() =>
        createContextLogger({
          name: 'sidekick:cli',
          level: 'info',
          source: 'cli',
          logsDir,
          // logFile intentionally omitted
        })
      ).toThrow('logFile is required when logsDir is set')
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
          correlationId: 'corr-456',
          hook: 'UserPromptSubmit',
        },
        { cwd: '/workspaces/project', mode: 'hook' }
      )

      expect(event.type).toBe('hook:received')
      expect(event.source).toBe('cli')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.context.correlationId).toBe('corr-456')
      expect(event.context.hook).toBe('UserPromptSubmit')
      expect(event.payload.cwd).toBe('/workspaces/project')
      expect(event.payload.mode).toBe('hook')
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

      expect(event.type).toBe('hook:completed')
      expect(event.source).toBe('cli')
      expect(event.payload.durationMs).toBe(45)
      expect(event.payload.reminderReturned).toBe(true)
    })

    // Note: ReminderConsumed events moved to @sidekick/feature-reminders (9.5.2)

    it('should create EventReceived events for daemon', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.eventReceived(
        { sessionId: 'sess-123', taskId: 'task-789' },
        { eventKind: 'hook', hook: 'PostToolUse' }
      )

      expect(event.type).toBe('event:received')
      expect(event.source).toBe('daemon')
      expect(event.context.taskId).toBe('task-789')
      expect(event.payload.eventKind).toBe('hook')
      expect(event.payload.hook).toBe('PostToolUse')
    })

    it('should create EventProcessed events with success/failure', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.eventProcessed(
        { sessionId: 'sess-123' },
        { handlerId: 'reminders:stage-stuck', success: true },
        { durationMs: 12 }
      )

      expect(event.type).toBe('event:processed')
      expect(event.source).toBe('daemon')
      expect(event.payload.handlerId).toBe('reminders:stage-stuck')
      expect(event.payload.success).toBe(true)
      expect(event.payload.durationMs).toBe(12)
    })

    it('should create ReminderStaged events with state and metadata', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.reminderStaged(
        { sessionId: 'sess-123', correlationId: 'corr-456', hook: 'PostToolUse' },
        {
          reminderName: 'stuck-loop',
          hookName: 'UserPromptSubmit',
          blocking: true,
          priority: 10,
          persistent: false,
        },
        { stagingPath: '/tmp/staging/stuck-loop.md' }
      )

      expect(event.type).toBe('reminder:staged')
      expect(event.source).toBe('daemon')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.context.correlationId).toBe('corr-456')
      expect(event.context.hook).toBe('PostToolUse')
      expect(event.payload.reminderName).toBe('stuck-loop')
      expect(event.payload.hookName).toBe('UserPromptSubmit')
      expect(event.payload.blocking).toBe(true)
      expect(event.payload.priority).toBe(10)
      expect(event.payload.persistent).toBe(false)
    })

    it('should create ReminderStaged events without optional metadata', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.reminderStaged(
        { sessionId: 'sess-123' },
        {
          reminderName: 'test-reminder',
          hookName: 'SessionStart',
          blocking: false,
          priority: 0,
          persistent: true,
        }
      )

      expect(event.type).toBe('reminder:staged')
      expect(event.payload.reminderName).toBe('test-reminder')
    })

    it('should create DaemonStarting events with project dir and pid', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.daemonStarting({ projectDir: '/workspaces/project', pid: 12345 })

      expect(event.type).toBe('daemon:starting')
      expect(event.source).toBe('daemon')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('')
      expect(event.payload.projectDir).toBe('/workspaces/project')
      expect(event.payload.pid).toBe(12345)
    })

    it('should create DaemonStarted events with startup duration', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.daemonStarted({ startupDurationMs: 250 })

      expect(event.type).toBe('daemon:started')
      expect(event.source).toBe('daemon')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('')
      expect(event.payload.startupDurationMs).toBe(250)
    })

    it('should create IpcServerStarted events with socket path', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.ipcServerStarted({ socketPath: '/tmp/sidekick.sock' })

      expect(event.type).toBe('ipc:started')
      expect(event.source).toBe('daemon')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('')
      expect(event.payload.socketPath).toBe('/tmp/sidekick.sock')
    })

    it('should create ConfigWatcherStarted events with watched files', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.configWatcherStarted({
        projectDir: '/workspaces/project',
        watchedFiles: ['sidekick.yaml', '.sidekick/config.yaml'],
      })

      expect(event.type).toBe('config:watcher-started')
      expect(event.source).toBe('daemon')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('')
      expect(event.payload.projectDir).toBe('/workspaces/project')
      expect(event.payload.watchedFiles).toEqual(['sidekick.yaml', '.sidekick/config.yaml'])
    })

    it('should create SessionEvictionStarted events with interval', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.sessionEvictionStarted({ intervalMs: 300000 })

      expect(event.type).toBe('session:eviction-started')
      expect(event.source).toBe('daemon')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('')
      expect(event.payload.intervalMs).toBe(300000)
    })

    it('should create StatuslineRendered events with display mode and metrics', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.statuslineRendered(
        { sessionId: 'sess-123', hook: 'Stop' },
        { displayMode: 'session_summary', staleData: false },
        { model: 'claude-sonnet-4-20250514', tokens: 1500, durationMs: 35 }
      )

      expect(event.type).toBe('statusline:rendered')
      expect(event.source).toBe('cli')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.context.hook).toBe('Stop')
      expect(event.payload.displayMode).toBe('session_summary')
      expect(event.payload.staleData).toBe(false)
      expect(event.payload.model).toBe('claude-sonnet-4-20250514')
      expect(event.payload.tokens).toBe(1500)
      expect(event.payload.durationMs).toBe(35)
    })

    it('should create StatuslineError events with reason and fallback info', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.statuslineError({ sessionId: 'sess-123' }, 'state_file_missing', {
        file: '/tmp/state.json',
        fallbackUsed: true,
        error: 'ENOENT',
      })

      expect(event.type).toBe('statusline:error')
      expect(event.source).toBe('cli')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.payload.reason).toBe('state_file_missing')
      expect(event.payload.file).toBe('/tmp/state.json')
      expect(event.payload.fallbackUsed).toBe(true)
      expect(event.payload.error).toBe('ENOENT')
    })

    it('should create ResumeGenerating events with confidence scores', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.resumeGenerating(
        { sessionId: 'sess-123', traceId: 'trace-789' },
        { title_confidence: 0.85, intent_confidence: 0.92 }
      )

      expect(event.type).toBe('resume-message:start')
      expect(event.source).toBe('daemon')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.context.traceId).toBe('trace-789')
      expect(event.payload.title_confidence).toBe(0.85)
      expect(event.payload.intent_confidence).toBe(0.92)
    })

    it('should create ResumeUpdated events with snarky comment and timestamp', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.resumeUpdated(
        { sessionId: 'sess-123' },
        { snarky_comment: 'Nice try, but I remember everything.', timestamp: '2026-03-11T10:00:00Z' }
      )

      expect(event.type).toBe('resume-message:finish')
      expect(event.source).toBe('daemon')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.payload.snarky_comment).toBe('Nice try, but I remember everything.')
      expect(event.payload.timestamp).toBe('2026-03-11T10:00:00Z')
    })

    it('should create ResumeSkipped events with confidence thresholds', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.resumeSkipped(
        { sessionId: 'sess-123' },
        { title_confidence: 0.3, intent_confidence: 0.4, min_confidence: 0.7 },
        'confidence_below_threshold'
      )

      expect(event.type).toBe('resume-message:skipped')
      expect(event.source).toBe('daemon')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.payload.title_confidence).toBe(0.3)
      expect(event.payload.intent_confidence).toBe(0.4)
      expect(event.payload.min_confidence).toBe(0.7)
      expect(event.payload.reason).toBe('confidence_below_threshold')
    })

    it('should create TranscriptEventEmitted events with uuid', async () => {
      const { LogEvents } = await import('../structured-logging')
      const { createDefaultMetrics } = await import('../transcript-service')

      const metrics = {
        ...createDefaultMetrics(),
        turnCount: 5,
        toolsThisTurn: 2,
        toolCount: 10,
        messageCount: 15,
        lastProcessedLine: 42,
      }

      const event = LogEvents.transcriptEventEmitted(
        { sessionId: 'sess-123' },
        {
          eventType: 'ToolCall',
          lineNumber: 42,
          uuid: 'abc-123-def-456',
          toolName: 'Bash',
        },
        {
          transcriptPath: '/tmp/transcript.jsonl',
          contentPreview: 'echo hello...',
          metrics,
        }
      )

      expect(event.type).toBe('transcript:emitted')
      expect(event.source).toBe('transcript')
      expect(event.payload.eventType).toBe('ToolCall')
      expect(event.payload.lineNumber).toBe(42)
      expect(event.payload.uuid).toBe('abc-123-def-456')
      expect(event.payload.toolName).toBe('Bash')
    })

    it('should create PreCompactCaptured events', async () => {
      const { LogEvents } = await import('../structured-logging')
      const { createDefaultMetrics } = await import('../transcript-service')

      const metrics = {
        ...createDefaultMetrics(),
        turnCount: 10,
        toolsThisTurn: 0,
        toolCount: 25,
        messageCount: 50,
        lastProcessedLine: 100,
      }

      const event = LogEvents.preCompactCaptured(
        { sessionId: 'sess-123' },
        { snapshotPath: '/tmp/snapshot.jsonl', lineCount: 100 },
        { transcriptPath: '/tmp/transcript.jsonl', metrics }
      )

      expect(event.type).toBe('transcript:pre-compact')
      expect(event.source).toBe('transcript')
      expect(event.payload.snapshotPath).toBe('/tmp/snapshot.jsonl')
      expect(event.payload.lineCount).toBe(100)
    })

    // --- Type Guard Tests ---

    it('isLoggingEvent should return true for valid logging events', async () => {
      const { isLoggingEvent } = await import('@sidekick/types')
      const { LogEvents } = await import('../structured-logging')

      const hookReceived = LogEvents.hookReceived({ sessionId: 'sess-1', hook: 'SessionStart' }, { mode: 'hook' })
      expect(isLoggingEvent(hookReceived)).toBe(true)

      const daemonStarted = LogEvents.daemonStarted({ startupDurationMs: 100 })
      expect(isLoggingEvent(daemonStarted)).toBe(true)

      const statuslineRendered = LogEvents.statuslineRendered(
        { sessionId: 'sess-1' },
        { displayMode: 'session_summary', staleData: false },
        { durationMs: 10 }
      )
      expect(isLoggingEvent(statuslineRendered)).toBe(true)
    })

    it('isLoggingEvent should return false for non-logging objects', async () => {
      const { isLoggingEvent } = await import('@sidekick/types')

      expect(isLoggingEvent(null)).toBe(false)
      expect(isLoggingEvent(undefined)).toBe(false)
      expect(isLoggingEvent('string')).toBe(false)
      expect(isLoggingEvent(42)).toBe(false)
      expect(isLoggingEvent({})).toBe(false)
      expect(isLoggingEvent({ type: 'Foo' })).toBe(false) // missing time, source, context, payload
      expect(isLoggingEvent({ type: 'Foo', time: 1, source: 'cli' })).toBe(false) // missing context, payload
    })

    it('isCLILoggingEvent should identify CLI-sourced events', async () => {
      const { isCLILoggingEvent } = await import('@sidekick/types')
      const { LogEvents } = await import('../structured-logging')

      const hookReceived = LogEvents.hookReceived({ sessionId: 'sess-1', hook: 'SessionStart' }, { mode: 'hook' })
      expect(isCLILoggingEvent(hookReceived)).toBe(true)

      const statuslineRendered = LogEvents.statuslineRendered(
        { sessionId: 'sess-1' },
        { displayMode: 'session_summary', staleData: false },
        { durationMs: 10 }
      )
      expect(isCLILoggingEvent(statuslineRendered)).toBe(true)

      // Daemon event should return false
      const daemonStarted = LogEvents.daemonStarted({ startupDurationMs: 100 })
      expect(isCLILoggingEvent(daemonStarted)).toBe(false)
    })

    it('isDaemonLoggingEvent should identify daemon-sourced events', async () => {
      const { isDaemonLoggingEvent } = await import('@sidekick/types')
      const { LogEvents } = await import('../structured-logging')

      const daemonStarting = LogEvents.daemonStarting({ projectDir: '/tmp', pid: 1 })
      expect(isDaemonLoggingEvent(daemonStarting)).toBe(true)

      const eventProcessed = LogEvents.eventProcessed(
        { sessionId: 'sess-1' },
        { handlerId: 'test', success: true },
        { durationMs: 5 }
      )
      expect(isDaemonLoggingEvent(eventProcessed)).toBe(true)

      // CLI event should return false
      const hookReceived = LogEvents.hookReceived({ sessionId: 'sess-1', hook: 'SessionStart' }, { mode: 'hook' })
      expect(isDaemonLoggingEvent(hookReceived)).toBe(false)
    })

    it('isTranscriptLoggingEvent should identify transcript-sourced events', async () => {
      const { isTranscriptLoggingEvent } = await import('@sidekick/types')
      const { LogEvents } = await import('../structured-logging')
      const { createDefaultMetrics } = await import('../transcript-service')

      const metrics = createDefaultMetrics()

      const transcriptEvent = LogEvents.transcriptEventEmitted(
        { sessionId: 'sess-1' },
        { eventType: 'UserPrompt', lineNumber: 1 },
        { transcriptPath: '/tmp/t.jsonl', metrics }
      )
      expect(isTranscriptLoggingEvent(transcriptEvent)).toBe(true)

      const preCompact = LogEvents.preCompactCaptured(
        { sessionId: 'sess-1' },
        { snapshotPath: '/tmp/snap.jsonl', lineCount: 10 },
        { transcriptPath: '/tmp/t.jsonl', metrics }
      )
      expect(isTranscriptLoggingEvent(preCompact)).toBe(true)

      // Daemon event should return false
      const daemonStarted = LogEvents.daemonStarted({ startupDurationMs: 100 })
      expect(isTranscriptLoggingEvent(daemonStarted)).toBe(false)
    })

    // --- logEvent Integration Tests ---

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
      expect(log.type).toBe('hook:received')
      expect(log.source).toBe('cli')
    })

    it('logEvent should flatten payload fields into log output', async () => {
      const { createContextLogger, LogEvents, logEvent } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logger = createContextLogger({
        source: 'daemon',
        context: { sessionId: 'sess-456' },
        testStream: stream,
      })

      const event = LogEvents.eventProcessed(
        { sessionId: 'sess-456' },
        { handlerId: 'reminders:stage', success: true },
        { durationMs: 42 }
      )

      logEvent(logger, event)
      await logger.flush()

      expect(lines.length).toBe(1)
      const log = parseLogLine(lines[0])

      // Payload fields should be flattened at the top level
      expect(log.type).toBe('event:processed')
      expect(log.source).toBe('daemon')
      expect(log.handlerId).toBe('reminders:stage')
      expect(log.success).toBe(true)
      expect(log.durationMs).toBe(42)
    })

    it('logEvent should use payload.reason as message when present', async () => {
      const { createContextLogger, LogEvents, logEvent } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logger = createContextLogger({
        source: 'daemon',
        context: { sessionId: 'sess-789' },
        testStream: stream,
      })

      // ResumeSkipped has reason in its flat payload
      const eventWithReason = LogEvents.resumeSkipped(
        { sessionId: 'sess-789' },
        { title_confidence: 0.3, intent_confidence: 0.4, min_confidence: 0.7 },
        'confidence_below_threshold'
      )

      logEvent(logger, eventWithReason)
      await logger.flush()

      const logWithReason = parseLogLine(lines[0])
      expect(logWithReason.msg).toBe('confidence_below_threshold')
      expect(logWithReason.reason).toBe('confidence_below_threshold')
    })

    it('logEvent should fall back to event.type as message when no reason', async () => {
      const { createContextLogger, LogEvents, logEvent } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logger = createContextLogger({
        source: 'cli',
        context: { sessionId: 'sess-abc' },
        testStream: stream,
      })

      // HookReceived has no reason field in payload
      const eventNoReason = LogEvents.hookReceived({ sessionId: 'sess-abc', hook: 'SessionStart' }, { mode: 'hook' })

      logEvent(logger, eventNoReason)
      await logger.flush()

      const logNoReason = parseLogLine(lines[0])
      expect(logNoReason.msg).toBe('hook:received')
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
      const { stream } = createTestStream()

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

    it('should log uncaught exceptions through the handler', async () => {
      const { createLogManager, setupGlobalErrorHandlers } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'fatal',
        testStream: stream,
      })

      // Save and remove existing listeners
      const originalUncaughtListeners = process.listeners('uncaughtException')
      process.removeAllListeners('uncaughtException')

      const cleanup = setupGlobalErrorHandlers(logManager.getLogger())

      // Add a listener to prevent the test from crashing
      const preventCrash = (): void => {}
      process.on('uncaughtException', preventCrash)

      // Emit an uncaught exception event
      const testError = new Error('Test uncaught exception')
      process.emit('uncaughtException', testError)

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Cleanup and restore
      cleanup()
      process.removeListener('uncaughtException', preventCrash)
      for (const listener of originalUncaughtListeners) {
        process.on('uncaughtException', listener)
      }

      // Verify the error was logged
      expect(lines.length).toBeGreaterThan(0)
      const logEntry = parseLogLine(lines[0])
      expect(logEntry.msg).toBe('Uncaught exception')
    })

    it('should log unhandled promise rejections through the handler', async () => {
      const { createLogManager, setupGlobalErrorHandlers } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'fatal',
        testStream: stream,
      })

      // Save and remove existing listeners
      const originalRejectionListeners = process.listeners('unhandledRejection')
      process.removeAllListeners('unhandledRejection')

      const cleanup = setupGlobalErrorHandlers(logManager.getLogger())

      // Emit an unhandled rejection event with an Error
      const testError = new Error('Test unhandled rejection')
      process.emit('unhandledRejection', testError, Promise.resolve())

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Cleanup and restore
      cleanup()
      for (const listener of originalRejectionListeners) {
        process.on('unhandledRejection', listener)
      }

      // Verify the rejection was logged
      expect(lines.length).toBeGreaterThan(0)
      const logEntry = parseLogLine(lines[0])
      expect(logEntry.msg).toBe('Unhandled promise rejection')
      expect(logEntry.reason).toBe('Test unhandled rejection')
    })

    it('should handle non-Error rejection reasons', async () => {
      const { createLogManager, setupGlobalErrorHandlers } = await import('../structured-logging')
      const { stream, lines } = createTestStream()

      const logManager = createLogManager({
        name: 'sidekick:test',
        level: 'fatal',
        testStream: stream,
      })

      // Save and remove existing listeners
      const originalRejectionListeners = process.listeners('unhandledRejection')
      process.removeAllListeners('unhandledRejection')

      const cleanup = setupGlobalErrorHandlers(logManager.getLogger())

      // Emit an unhandled rejection event with a string (non-Error)
      process.emit('unhandledRejection', 'string rejection reason', Promise.resolve())

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Cleanup and restore
      cleanup()
      for (const listener of originalRejectionListeners) {
        process.on('unhandledRejection', listener)
      }

      // Verify the rejection was logged with string reason
      expect(lines.length).toBeGreaterThan(0)
      const logEntry = parseLogLine(lines[0])
      expect(logEntry.msg).toBe('Unhandled promise rejection')
      expect(logEntry.reason).toBe('string rejection reason')
    })
  })

  describe('createLogManager with rotation', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'sidekick-log-rotation-'))
    })

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('writes log entries to a numbered file when maxSizeBytes/maxFiles are specified', async () => {
      const logPath = path.join(tmpDir, 'test.log')
      const { createLogManager } = await import('../structured-logging')
      const logManager = createLogManager({
        name: 'test',
        level: 'info',
        destinations: {
          file: {
            path: logPath,
            maxSizeBytes: 512, // tiny threshold to trigger rotation quickly
            maxFiles: 3,
          },
        },
      })

      const logger = logManager.getLogger()

      // Write enough data to trigger rotation
      for (let i = 0; i < 15; i++) {
        logger.info(`Log entry number ${i} with padding`.padEnd(80, 'x'))
      }

      await logger.flush()
      // Give rotation a moment to complete (pino-roll rotates on drain event)
      await new Promise((resolve) => setTimeout(resolve, 300))

      // At least one numbered file should exist (pino-roll Extension Last Format: test.1.log, test.2.log)
      const files = readdirSync(tmpDir)
      expect(files.some((f) => /^test\.\d+\.log$/.test(f))).toBe(true)
    })

    it('writes ALL sequential log entries through BufferedRotatingStream (not just the first)', async () => {
      const logPath = path.join(tmpDir, 'multi.log')
      const { createLogManager } = await import('../structured-logging')
      const logManager = createLogManager({
        name: 'test',
        level: 'info',
        destinations: {
          file: {
            path: logPath,
            maxSizeBytes: 10 * 1024 * 1024, // 10MB - large enough to avoid rotation
            maxFiles: 3,
          },
        },
      })

      const logger = logManager.getLogger()

      // Write first entry (this one works — gets buffered and drained)
      logger.info('Entry one')

      // Wait for pino-roll async init to complete and drain pending buffer
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Write more entries AFTER pino-roll has initialized
      logger.info('Entry two')
      logger.info('Entry three')

      // Also test child logger writes
      const child = logger.child({ component: 'test-child' })
      child.info('Entry from child')

      await logger.flush()
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Read ALL log files produced by pino-roll (numbered: multi.1.log, etc.)
      const files = readdirSync(tmpDir).filter((f) => f.startsWith('multi'))
      expect(files.length).toBeGreaterThan(0)

      let totalLines = 0
      for (const file of files) {
        const content = fs.readFileSync(path.join(tmpDir, file), 'utf-8').trim()
        if (content) {
          totalLines += content.split('\n').length
        }
      }

      // ALL four entries must appear, not just the first
      expect(totalLines).toBeGreaterThanOrEqual(4)
    })

    it('does not throw when maxSizeBytes/maxFiles are not provided (legacy path)', async () => {
      const logPath = path.join(tmpDir, 'legacy.log')
      const { createLogManager } = await import('../structured-logging')
      expect(() => {
        createLogManager({
          name: 'test',
          level: 'info',
          destinations: { file: { path: logPath } },
        })
      }).not.toThrow()
    })
  })

  describe('getComponentLogLevel', () => {
    it('should return override level when component has an override', async () => {
      const { getComponentLogLevel } = await import('../structured-logging')

      const componentLevels = {
        reminders: 'debug',
        statusline: 'trace',
      }

      expect(getComponentLogLevel(componentLevels, 'reminders', 'info')).toBe('debug')
      expect(getComponentLogLevel(componentLevels, 'statusline', 'info')).toBe('trace')
    })

    it('should return default level when component has no override', async () => {
      const { getComponentLogLevel } = await import('../structured-logging')

      const componentLevels = {
        reminders: 'debug',
      }

      expect(getComponentLogLevel(componentLevels, 'unknown-component', 'info')).toBe('info')
      expect(getComponentLogLevel(componentLevels, 'statusline', 'warn')).toBe('warn')
    })

    it('should return default level when componentLevels is undefined', async () => {
      const { getComponentLogLevel } = await import('../structured-logging')

      expect(getComponentLogLevel(undefined, 'reminders', 'info')).toBe('info')
      expect(getComponentLogLevel(undefined, 'anything', 'error')).toBe('error')
    })

    it('should return default level when componentLevels is empty', async () => {
      const { getComponentLogLevel } = await import('../structured-logging')

      expect(getComponentLogLevel({}, 'reminders', 'info')).toBe('info')
    })

    it('should ignore invalid log levels in overrides', async () => {
      const { getComponentLogLevel } = await import('../structured-logging')

      const componentLevels = {
        reminders: 'invalid-level', // Not a valid LogLevel
      }

      // Should fall back to default since 'invalid-level' is not in LOG_LEVELS
      expect(getComponentLogLevel(componentLevels, 'reminders', 'info')).toBe('info')
    })
  })
})
