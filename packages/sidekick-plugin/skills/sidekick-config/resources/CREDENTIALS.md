# API Key & Credentials Reference

**Sidekick never stores API keys in YAML config files.** Use environment variables or `.env` files.

## Supported Keys

| Provider | Environment Variable | Required For |
|----------|---------------------|--------------|
| OpenRouter | `OPENROUTER_API_KEY` | Default LLM profiles (statusline, snarky messages) |
| OpenAI | `OPENAI_API_KEY` | OpenAI-native profiles |
| Claude CLI | None | Uses current Claude Code session |

## Resolution Precedence

Keys are resolved in this order (first match wins):

1. **Environment variable** (e.g., `OPENROUTER_API_KEY`)
2. **`.env` files** (loaded into `process.env` at startup)
3. **Config `apiKey`** (not recommended - use `.env` instead)

## `.env` File Locations

Loaded in this order (later files override earlier):

| Location | Scope | Git-tracked |
|----------|-------|-------------|
| `~/.sidekick/.env` | User-wide | N/A |
| `.sidekick/.env` | Project | Should be in `.gitignore` |
| `.sidekick/.env.local` | Project-local | Should be in `.gitignore` |

## Quick Setup

**Recommended approach** (user-wide, works across all projects):

```bash
# Create user sidekick directory
mkdir -p ~/.sidekick

# Add your API key
echo 'OPENROUTER_API_KEY=sk-or-v1-your-key-here' >> ~/.sidekick/.env
```

**Project-specific** (for team shared keys via secrets management):

```bash
# Ensure .env files are ignored
echo '.sidekick/.env' >> .gitignore
echo '.sidekick/.env.local' >> .gitignore

# Add project key
echo 'OPENROUTER_API_KEY=sk-or-v1-project-key' >> .sidekick/.env
```

## Getting an OpenRouter Key

1. Go to [openrouter.ai](https://openrouter.ai)
2. Sign up or log in
3. Navigate to **Keys** in the dashboard
4. Create a new key with appropriate limits
5. Copy the key (starts with `sk-or-v1-`)

## Troubleshooting

### "OpenRouter requires apiKey" Error

Sidekick can't find your API key. Check:

```bash
# Is the env var set?
echo $OPENROUTER_API_KEY

# Does the .env file exist?
cat ~/.sidekick/.env

# Is it in the right format?
grep OPENROUTER ~/.sidekick/.env
```

### Key Not Being Picked Up

1. **Restart Claude Code** after adding keys to `.env` files
2. Verify no typos in variable name (case-sensitive)
3. Check file isn't malformed (no quotes around value needed, no trailing spaces)

### Multiple Keys (Project Override)

Project `.env` files override user `.env`:

```bash
# ~/.sidekick/.env (default)
OPENROUTER_API_KEY=sk-or-v1-personal-key

# .sidekick/.env (project-specific, takes precedence)
OPENROUTER_API_KEY=sk-or-v1-team-key
```

## Security Best Practices

| Do | Don't |
|----|-------|
| Use `~/.sidekick/.env` for personal keys | Put keys in `llm.yaml` |
| Add `.sidekick/.env*` to `.gitignore` | Commit `.env` files |
| Use project `.env` only for team-shared secrets | Share personal keys across projects |
| Rotate keys periodically | Use keys without spending limits |

## Environment Variable Prefix

Sidekick also supports `SIDEKICK_*` environment variables for non-secret config:

```bash
SIDEKICK_LOG_LEVEL=debug
SIDEKICK_DEVELOPMENT_ENABLED=true
```

These map to config paths (e.g., `core.logging.level`). See [CORE.md](CORE.md) for mappings.
