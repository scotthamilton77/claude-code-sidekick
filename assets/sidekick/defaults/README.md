# Sidekick Configuration Defaults

External YAML defaults loaded as the base layer of the configuration cascade.

## Directory Structure

```
defaults/
├── core.defaults.yaml                 # Logging, paths, daemon, IPC
├── llm.defaults.yaml                  # LLM provider settings
├── transcript.defaults.yaml           # Transcript processing
└── features/
    ├── reminders.defaults.yaml        # Update/stuck thresholds
    ├── session-summary.defaults.yaml  # Summary generation
    └── statusline.defaults.yaml       # Format and themes
```

## Configuration Cascade

Priority (lowest to highest):

1. External YAML defaults (`assets/sidekick/defaults/*.yaml`)
2. Internal Zod defaults (hardcoded fallbacks)
3. Environment variables (`SIDEKICK_*`, `.env`)
4. User domain YAML (`~/.sidekick/{domain}.yaml`)
5. Project domain YAML (`.sidekick/{domain}.yaml`)
6. Project-local overrides (`.sidekick/{domain}.local.yaml`)

## Overriding Defaults

### Domain YAML (copy and modify)

```bash
# Copy a defaults file as starting point
cp assets/sidekick/defaults/llm.defaults.yaml ~/.sidekick/llm.yaml
cp assets/sidekick/defaults/features/statusline.defaults.yaml ~/.sidekick/features.yaml

# Or for project-level
cp assets/sidekick/defaults/llm.defaults.yaml .sidekick/llm.yaml
```

Edit the copied file—each has inline comments explaining options.

### Environment Variables

```bash
SIDEKICK_LLM__PROVIDER=openai
SIDEKICK_CORE__LOGGING__LEVEL=debug
```

## Merge Behavior

- **Objects**: Deep-merged (nested keys combined)
- **Arrays**: Replaced entirely
- **Scalars**: Later values override
