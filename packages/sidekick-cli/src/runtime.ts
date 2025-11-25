import type { Logger, ConfigService, AssetResolver } from '@sidekick/core';
import {
  createConsoleLogger,
  resolveScope,
  createConfigService,
  createAssetResolver,
  getDefaultAssetsDir,
  type ScopeResolution,
  type ScopeResolutionInput,
} from '@sidekick/core';

export interface BootstrapOptions extends ScopeResolutionInput {
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  stderrSink?: NodeJS.WritableStream;
  defaultAssetsDir?: string;
}

export interface RuntimeShell {
  logger: Logger;
  scope: ScopeResolution;
  config: ConfigService;
  assets: AssetResolver;
}

export function bootstrapRuntime(options: BootstrapOptions): RuntimeShell {
  // Phase 1: Minimal console logger for early errors
  const bootstrapLogger = createConsoleLogger({
    minimumLevel: options.logLevel ?? 'info',
    sink: options.stderrSink,
  });

  // Resolve scope first
  const scope = resolveScope(options);

  // Load configuration with cascade
  let config: ConfigService;
  try {
    config = createConfigService({
      projectRoot: scope.projectRoot,
      homeDir: options.homeDir,
    });
  } catch (err) {
    bootstrapLogger.error('Failed to load configuration', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  // Use config's log level if not overridden by CLI
  const effectiveLogLevel = options.logLevel ?? config.get('logLevel');
  const logger = createConsoleLogger({
    minimumLevel: effectiveLogLevel,
    sink: options.stderrSink,
  });

  // Initialize asset resolver
  const defaultAssetsDir = options.defaultAssetsDir ?? getDefaultAssetsDir();
  const assets = createAssetResolver({
    defaultAssetsDir,
    projectRoot: scope.projectRoot,
    homeDir: options.homeDir,
  });

  logger.info('Resolved hook context', {
    scope: scope.scope,
    projectRoot: scope.projectRoot ?? null,
    source: scope.source,
    warnings: scope.warnings,
  });

  if (config.sources.length > 0) {
    logger.debug('Configuration sources loaded', { sources: config.sources });
  }

  logger.debug('Asset resolver initialized', { cascadeLayers: assets.cascadeLayers });

  if (scope.dualInstallDetected) {
    logger.warn('Detected project-scope installation while running from user hooks. Deferring to project scope.');
  }

  logger.warn('Supervisor endpoint unavailable - skipped handshake for bootstrap skeleton');

  return { logger, scope, config, assets };
}
