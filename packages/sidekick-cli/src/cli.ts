import { PassThrough } from 'node:stream';
import yargsParser from 'yargs-parser';

import { bootstrapRuntime } from './runtime';

interface ParsedArgs {
  command: string;
  hookMode: boolean;
  hookScriptPath?: string;
  projectDir?: string;
  scopeOverride?: 'user' | 'project';
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

interface RunCliOptions {
  argv: string[];
  stdinData?: string;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

/**
 * Parse CLI arguments using a well-tested open-source parser to reduce bespoke flag handling.
 */
function parseArgs(argv: string[]): ParsedArgs {
  const parsed = yargsParser(argv, {
    boolean: ['hook'],
    string: ['hook-script-path', 'project-dir', 'scope', 'log-level'],
    configuration: {
      'camel-case-expansion': false,
    },
  });

  const command = (parsed._[0] as string | undefined) ?? 'session-start';

  return {
    command,
    hookMode: Boolean(parsed.hook),
    hookScriptPath: parsed['hook-script-path'] as string | undefined,
    projectDir: parsed['project-dir'] as string | undefined,
    scopeOverride: parsed.scope as 'user' | 'project' | undefined,
    logLevel: (parsed['log-level'] as ParsedArgs['logLevel']) ?? 'info',
  };
}

/**
 * Execute the Sidekick Node CLI entrypoint.
 *
 * This function is intentionally side-effect free aside from writes to the provided output streams,
 * making it easy to exercise via unit tests without spawning a separate process.
 */
export async function runCli(options: RunCliOptions): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout = options.stdout ?? new PassThrough();
  const stderr = options.stderr ?? new PassThrough();
  const parsed = parseArgs(options.argv);
  const homeDir = options.homeDir ?? options.env?.HOME;

  const runtime = bootstrapRuntime({
    hookScriptPath: parsed.hookScriptPath,
    projectDir: parsed.projectDir,
    scopeOverride: parsed.scopeOverride,
    logLevel: parsed.logLevel,
    stderrSink: stderr,
    cwd: options.cwd,
    homeDir,
  });

  if (runtime.scope.dualInstallDetected && parsed.scopeOverride !== 'project') {
    runtime.logger.warn('User-scope hook detected project installation. Exiting to prevent duplicate execution.');
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const payload = {
    command: parsed.command,
    status: 'ok' as const,
    message: 'Node runtime skeleton ready',
    scope: runtime.scope.scope,
    projectRoot: runtime.scope.projectRoot ?? null,
    hookScriptPath: runtime.scope.hookScriptPath ?? null,
  };

  if (parsed.hookMode) {
    stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    stdout.write(`Sidekick CLI stub executed ${parsed.command} in ${runtime.scope.scope} scope\n`);
  }

  return { exitCode: 0, stdout: '', stderr: '' };
}
