import type { Logger } from '@sidekick/core';
import { createConsoleLogger, resolveScope, type ScopeResolution, type ScopeResolutionInput } from '@sidekick/core';

export interface BootstrapOptions extends ScopeResolutionInput {
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  stderrSink?: NodeJS.WritableStream;
}

export interface RuntimeShell {
  logger: Logger;
  scope: ScopeResolution;
}

export function bootstrapRuntime(options: BootstrapOptions): RuntimeShell {
  const logger = createConsoleLogger({ minimumLevel: options.logLevel ?? 'info', sink: options.stderrSink });
  const scope = resolveScope(options);

  logger.info('Resolved hook context', {
    scope: scope.scope,
    projectRoot: scope.projectRoot ?? null,
    source: scope.source,
    warnings: scope.warnings,
  });

  if (scope.dualInstallDetected) {
    logger.warn('Detected project-scope installation while running from user hooks. Deferring to project scope.');
  }

  logger.warn('Supervisor endpoint unavailable - skipped handshake for bootstrap skeleton');

  return { logger, scope };
}
