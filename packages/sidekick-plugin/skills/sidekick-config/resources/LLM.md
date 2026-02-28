# LLM Configuration Reference

**Default file:** `assets/sidekick/defaults/llm.defaults.yaml`
**Override locations:** `~/.sidekick/llm.yaml` or `.sidekick/llm.yaml`

## Structure

```yaml
defaultProfile: <profile-id>    # Which profile to use by default

profiles:                        # Primary profiles (referenced by features)
  <profile-id>:
    provider: <provider>
    model: <model-id>
    temperature: <0-2>
    maxTokens: <number>
    timeout: <1-300>             # Seconds
    timeoutMaxRetries: <0-10>
    providerAllowlist: [...]     # OpenRouter only
    providerBlocklist: [...]     # OpenRouter only

defaultFallbackProfileId: <id>   # Default fallback when none specified

fallbackProfiles:                # Used when primary fails
  <profile-id>:
    # Same structure as profiles

global:
  debugDumpEnabled: <boolean>    # Log LLM requests/responses
  emulatedProvider: <string>     # For testing
```

## Providers

| Provider | Description | API Key Required |
|----------|-------------|------------------|
| `openrouter` | Multi-model gateway | `OPENROUTER_API_KEY` |
| `claude-cli` | Use Claude Code's own models | None (uses current session) |
| `openai` | OpenAI API direct | `OPENAI_API_KEY` |
| `custom` | Custom endpoint | Varies |
| `emulator` | Testing/mocking | None |

**Setting up API keys:** See [CREDENTIALS.md](CREDENTIALS.md) for where to put keys and security best practices.

## Available Models (OpenRouter)

| Model | Input $/M | Output $/M | Context | Notes |
|-------|-----------|------------|---------|-------|
| `google/gemma-3-4b-it` | $0.02 | $0.07 | 32k | Cheapest |
| `google/gemini-2.0-flash-lite-001` | $0.08 | $0.30 | 1000k | Fast, large context |
| `google/gemini-2.5-flash-lite` | $0.10 | $0.40 | 1000k | |
| `mistralai/mistral-small-creative` | $0.10 | $0.30 | 131k | High creativity |
| `deepseek/deepseek-v3.2` | $0.25 | $0.38 | 164k | |
| `qwen/qwen3-235b-a22b-2507` | $0.08 | $0.55 | 250k | Long-form content |

## Default Profiles

| Profile | Purpose | Model |
|---------|---------|-------|
| `fast-lite` | Quick classification, summaries | gemini-2.0-flash-lite |
| `creative` | Snarky messages (short) | mistral-small-creative |
| `creative-long` | Resume messages (longer) | qwen3-235b |
| `cheap-fallback` | Fallback when primary fails | gemini-2.5-flash-lite |

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `defaultProfile` | string | `fast-lite` | Profile used when none specified |
| `temperature` | number | 0 | Randomness (0=deterministic, 2=maximum) |
| `maxTokens` | number | varies | Maximum output tokens |
| `timeout` | number | 15 | Request timeout in seconds |
| `timeoutMaxRetries` | number | 2 | Retry attempts on timeout |
| `global.debugDumpEnabled` | boolean | false | Log all LLM requests/responses |

## Surgical Changes (sidekick.config)

```bash
# Change default profile
llm.defaultProfile=creative

# Adjust timeout for a profile
llm.profiles.fast-lite.timeout=30

# Enable debug logging
llm.global.debugDumpEnabled=true
```

## Full Override (llm.yaml)

Copy `assets/sidekick/defaults/llm.defaults.yaml` to `.sidekick/llm.yaml` and modify.
