/**
 * Configuration system with 4-level cascade
 *
 * Cascade order (later wins):
 * 1. Defaults (hardcoded)
 * 2. User global (~/.claude/benchmark-next.conf)
 * 3. Project (.benchmark-next/config.json)
 * 4. Project local (.benchmark-next/config.local.json) - gitignored
 *
 * Environment variables override all file-based config.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  ConfigSchema,
  PartialConfigSchema,
  type Config as ConfigType,
  type PartialConfig,
} from './ConfigSchema';

/**
 * Options for loading configuration
 */
export interface ConfigLoadOptions {
  /** Project directory (defaults to process.cwd()) */
  projectDir?: string;
  /** Skip loading user global config */
  skipUserConfig?: boolean;
  /** Skip loading project configs */
  skipProjectConfig?: boolean;
  /** Home directory override (for testing, defaults to os.homedir()) */
  homeDir?: string;
}

/**
 * Configuration manager with cascade support
 */
export class Config implements ConfigType {
  // Implement all ConfigType fields
  logLevel: ConfigType['logLevel'];
  features: ConfigType['features'];
  llm: ConfigType['llm'];
  topic: ConfigType['topic'];
  sleeper: ConfigType['sleeper'];
  resume: ConfigType['resume'];
  statusline: ConfigType['statusline'];
  reminder: ConfigType['reminder'];
  cleanup: ConfigType['cleanup'];
  benchmark: ConfigType['benchmark'];

  private constructor(config: ConfigType) {
    this.logLevel = config.logLevel;
    this.features = config.features;
    this.llm = config.llm;
    this.topic = config.topic;
    this.sleeper = config.sleeper;
    this.resume = config.resume;
    this.statusline = config.statusline;
    this.reminder = config.reminder;
    this.cleanup = config.cleanup;
    this.benchmark = config.benchmark;
  }

  /**
   * Load configuration with full cascade
   */
  static async load(options: ConfigLoadOptions = {}): Promise<Config> {
    const projectDir = options.projectDir || process.cwd();

    // 1. Start with defaults (as a plain object, not parsed by Zod yet)
    let config: any = Config.getDefaults();

    // 2. Load user global config (if not skipped)
    if (!options.skipUserConfig) {
      const userConfig = await Config.loadUserConfig(options.homeDir);
      if (userConfig) {
        config = Config.deepMerge(config, userConfig);
      }
    }

    // 3. Load project config (if not skipped)
    if (!options.skipProjectConfig) {
      const projectConfig = await Config.loadProjectConfig(projectDir);
      if (projectConfig) {
        config = Config.deepMerge(config, projectConfig);
      }

      // 4. Load project local config (highest priority from files)
      const localConfig = await Config.loadProjectLocalConfig(projectDir);
      if (localConfig) {
        config = Config.deepMerge(config, localConfig);
      }
    }

    // 5. Apply environment variable overrides
    config = Config.applyEnvironmentOverrides(config);

    // 6. Validate final config
    const validated = ConfigSchema.parse(config);

    return new Config(validated);
  }

  /**
   * Load configuration with only defaults
   */
  static async loadDefaults(): Promise<Config> {
    const defaults = Config.getDefaults();
    const validated = ConfigSchema.parse(defaults);
    return new Config(validated);
  }

  /**
   * Get hardcoded default configuration
   */
  private static getDefaults(): PartialConfig {
    return {
      logLevel: 'info',
      features: {
        topicExtraction: true,
        resume: true,
        statusline: true,
        tracking: true,
        reminder: true,
        cleanup: true,
      },
      llm: {
        provider: 'openrouter',
        timeoutSeconds: 10,
        benchmarkTimeoutSeconds: 15,
        timeoutMaxRetries: 3,
        debugDumpEnabled: false,
        claude: {
          model: 'haiku',
        },
        openai: {
          endpoint: 'https://api.openai.com/v1/chat/completions',
          model: 'gpt-5-nano',
        },
        openrouter: {
          endpoint: 'https://openrouter.ai/api/v1/chat/completions',
          model: 'google/gemma-3-12b-it',
        },
        custom: {
          model: 'default',
        },
        circuitBreaker: {
          enabled: true,
          failureThreshold: 3,
          backoffInitial: 60,
          backoffMax: 3600,
          backoffMultiplier: 2,
        },
      },
      topic: {
        excerptLines: 80,
        filterToolMessages: true,
        cadenceHigh: 10,
        cadenceLow: 1,
        clarityThreshold: 7,
      },
      sleeper: {
        enabled: true,
        maxDuration: 600,
        minSizeChange: 500,
        minInterval: 10,
        minSleep: 2,
        maxSleep: 20,
      },
      resume: {
        minClarity: 5,
      },
      statusline: {
        tokenThreshold: 160000,
      },
      reminder: {
        staticCadence: 4,
      },
      cleanup: {
        enabled: true,
        minCount: 5,
        ageDays: 2,
        dryRun: false,
      },
      benchmark: {
        referenceVersion: 'v1.0',
        judgeModel: 'openrouter:deepseek/deepseek-r1-distill-qwen-14b',
        scoreWeightSchema: 0.3,
        scoreWeightAccuracy: 0.5,
        scoreWeightContent: 0.2,
        earlyTermJsonFailures: 3,
        earlyTermTimeoutCount: 3,
        maxRetries: 2,
      },
    };
  }

  /**
   * Load user global config from ~/.claude/benchmark-next.conf
   */
  private static async loadUserConfig(homeDir?: string): Promise<PartialConfig | null> {
    try {
      const home = homeDir || os.homedir();
      const configPath = path.join(home, '.claude', 'benchmark-next.conf');
      const content = await fs.readFile(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      return parsed as PartialConfig;
    } catch (err: any) {
      // Only ignore ENOENT (file not found), propagate other errors
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Load project config from .benchmark-next/config.json
   */
  private static async loadProjectConfig(
    projectDir: string
  ): Promise<PartialConfig | null> {
    try {
      const configPath = path.join(projectDir, '.benchmark-next', 'config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      // Don't validate with schema here - just return raw object
      // Validation happens later in the cascade
      return parsed as PartialConfig;
    } catch (err: any) {
      // Only ignore ENOENT (file not found), propagate other errors
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Load project local config from .benchmark-next/config.local.json
   */
  private static async loadProjectLocalConfig(
    projectDir: string
  ): Promise<PartialConfig | null> {
    try {
      const configPath = path.join(
        projectDir,
        '.benchmark-next',
        'config.local.json'
      );
      const content = await fs.readFile(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      // Don't validate with schema here - just return raw object
      // Validation happens later in the cascade
      return parsed as PartialConfig;
    } catch (err: any) {
      // Only ignore ENOENT (file not found), propagate other errors
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Apply environment variable overrides
   *
   * Supports:
   * - BENCHMARK_LOG_LEVEL
   * - BENCHMARK_LLM_TIMEOUT_SECONDS
   * - BENCHMARK_LLM_BENCHMARK_TIMEOUT_SECONDS
   * - BENCHMARK_TOPIC_CADENCE_HIGH
   * - BENCHMARK_TOPIC_CADENCE_LOW
   * - OPENAI_API_KEY (standard OpenAI env var)
   * - OPENROUTER_API_KEY (standard OpenRouter env var)
   * - etc.
   */
  private static applyEnvironmentOverrides(config: any): any {
    const env = process.env;

    // Helper to get env var and parse as number
    const getEnvNumber = (key: string): number | undefined => {
      const val = env[key];
      if (!val) return undefined;
      const num = parseInt(val, 10);
      return isNaN(num) ? undefined : num;
    };

    // Build overrides object
    const envOverrides: any = {};

    // Log level
    if (env.BENCHMARK_LOG_LEVEL) {
      envOverrides.logLevel = env.BENCHMARK_LOG_LEVEL;
    }

    // LLM settings
    const llmOverrides: any = {};
    const timeoutSeconds = getEnvNumber('BENCHMARK_LLM_TIMEOUT_SECONDS');
    if (timeoutSeconds !== undefined) {
      llmOverrides.timeoutSeconds = timeoutSeconds;
    }

    const benchmarkTimeoutSeconds = getEnvNumber('BENCHMARK_LLM_BENCHMARK_TIMEOUT_SECONDS');
    if (benchmarkTimeoutSeconds !== undefined) {
      llmOverrides.benchmarkTimeoutSeconds = benchmarkTimeoutSeconds;
    }

    // API keys
    if (env.OPENAI_API_KEY) {
      llmOverrides.openai = {
        ...(config.llm?.openai || {}),
        apiKey: env.OPENAI_API_KEY,
      };
    }

    if (env.OPENROUTER_API_KEY) {
      llmOverrides.openrouter = {
        ...(config.llm?.openrouter || {}),
        apiKey: env.OPENROUTER_API_KEY,
      };
    }

    if (Object.keys(llmOverrides).length > 0) {
      envOverrides.llm = llmOverrides;
    }

    // Topic settings
    const topicOverrides: any = {};
    const cadenceHigh = getEnvNumber('BENCHMARK_TOPIC_CADENCE_HIGH');
    if (cadenceHigh !== undefined) {
      topicOverrides.cadenceHigh = cadenceHigh;
    }

    const cadenceLow = getEnvNumber('BENCHMARK_TOPIC_CADENCE_LOW');
    if (cadenceLow !== undefined) {
      topicOverrides.cadenceLow = cadenceLow;
    }

    if (Object.keys(topicOverrides).length > 0) {
      envOverrides.topic = topicOverrides;
    }

    // Deep merge env overrides into config
    return Config.deepMerge(config, envOverrides);
  }

  /**
   * Deep merge two partial configs
   * Later config takes precedence
   */
  private static deepMerge(
    base: PartialConfig,
    override: PartialConfig
  ): PartialConfig {
    const result: any = { ...base };

    for (const key in override) {
      if (override.hasOwnProperty(key)) {
        const overrideVal = (override as any)[key];
        const baseVal = result[key];

        if (
          overrideVal !== undefined &&
          overrideVal !== null &&
          typeof overrideVal === 'object' &&
          !Array.isArray(overrideVal) &&
          typeof baseVal === 'object' &&
          !Array.isArray(baseVal)
        ) {
          // Recursively merge objects
          result[key] = Config.deepMerge(baseVal, overrideVal);
        } else if (overrideVal !== undefined) {
          // Override primitive or array
          result[key] = overrideVal;
        }
      }
    }

    return result;
  }

  /**
   * Resolve timeout with cascade logic
   *
   * For benchmark context: benchmarkTimeoutSeconds → timeoutSeconds → 30
   * For default context: timeoutSeconds → 30
   */
  resolveTimeout(context: 'benchmark' | 'default' = 'default'): number {
    if (context === 'benchmark') {
      // Check if benchmarkTimeoutSeconds is explicitly undefined/null
      if (this.llm.benchmarkTimeoutSeconds !== undefined && this.llm.benchmarkTimeoutSeconds !== null) {
        return this.llm.benchmarkTimeoutSeconds;
      }
    }
    return this.llm.timeoutSeconds || 30;
  }

  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(
    feature: keyof ConfigType['features']
  ): boolean {
    return this.features[feature] === true;
  }

  /**
   * Export config as plain object
   */
  toObject(): ConfigType {
    return {
      logLevel: this.logLevel,
      features: this.features,
      llm: this.llm,
      topic: this.topic,
      sleeper: this.sleeper,
      resume: this.resume,
      statusline: this.statusline,
      reminder: this.reminder,
      cleanup: this.cleanup,
      benchmark: this.benchmark,
    };
  }
}
