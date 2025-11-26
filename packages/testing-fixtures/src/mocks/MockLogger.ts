/**
 * Mock Logger for Testing
 *
 * Provides a no-op logger that records all log calls for assertions.
 * Compatible with @sidekick/core Logger interface.
 *
 * @example
 * ```typescript
 * const logger = new MockLogger();
 * logger.info('Test message', { key: 'value' });
 * expect(logger.recordedLogs).toHaveLength(1);
 * expect(logger.recordedLogs[0].level).toBe('info');
 * ```
 */

import type { Logger } from '@sidekick/core'

export interface LogRecord {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  msg: string
  meta?: Record<string, unknown>
}

export class MockLogger implements Logger {
  public recordedLogs: LogRecord[] = []

  trace(msg: string, meta?: Record<string, unknown>): void {
    this.recordedLogs.push({ level: 'trace', msg, meta })
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    this.recordedLogs.push({ level: 'debug', msg, meta })
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    this.recordedLogs.push({ level: 'info', msg, meta })
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    this.recordedLogs.push({ level: 'warn', msg, meta })
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    this.recordedLogs.push({ level: 'error', msg, meta })
  }

  fatal(msg: string, meta?: Record<string, unknown>): void {
    this.recordedLogs.push({ level: 'fatal', msg, meta })
  }

  child(_bindings: Record<string, unknown>): Logger {
    const childLogger = new MockLogger()
    // Bind context - prepend to all future logs
    childLogger.recordedLogs = this.recordedLogs
    return childLogger
  }

  async flush(): Promise<void> {
    // No-op for mock
  }

  /**
   * Reset recorded logs.
   */
  reset(): void {
    this.recordedLogs = []
  }

  /**
   * Get logs of a specific level.
   */
  getLogsByLevel(level: LogRecord['level']): LogRecord[] {
    return this.recordedLogs.filter((log) => log.level === level)
  }

  /**
   * Check if a message was logged at any level.
   */
  wasLogged(msg: string): boolean {
    return this.recordedLogs.some((log) => log.msg === msg)
  }

  /**
   * Check if a message was logged at specific level.
   */
  wasLoggedAtLevel(msg: string, level: LogRecord['level']): boolean {
    return this.recordedLogs.some((log) => log.level === level && log.msg === msg)
  }
}
