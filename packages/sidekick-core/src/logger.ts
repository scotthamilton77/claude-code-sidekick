export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  minimumLevel?: LogLevel;
  sink?: NodeJS.WritableStream;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

function shouldLog(level: LogLevel, minimumLevel: LogLevel): boolean {
  return levelOrder[level] >= levelOrder[minimumLevel];
}

function formatLine(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${suffix}`;
}

export function createConsoleLogger(options: LoggerOptions = {}): Logger {
  const minimumLevel = options.minimumLevel ?? 'info';
  const sink = options.sink ?? process.stderr;

  const write = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    if (!shouldLog(level, minimumLevel)) {
      return;
    }
    sink.write(formatLine(level, message, meta) + '\n');
  };

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  };
}
