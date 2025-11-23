# lib/config/

**Status**: ⏳ Not Started (Planned for Phase 2.4)

**Shared Candidate**: Very High - identical config cascade needed by sidekick

## Purpose

Configuration management system with cascade behavior matching bash implementation in `src/sidekick/lib/config.sh`.

## Planned API

```typescript
import { ConfigManager } from '@/lib/config'

// Load configuration with cascade
const config = await ConfigManager.load({
  defaults: defaultConfig,
  userConfigPath: '~/.claude/benchmark-next.conf',
  projectDeployedPath: '.claude/benchmark-next.conf',
  projectVersionedPath: '.benchmark-next/config.json',
})

// Get values with type safety
const timeout = config.get('llm.timeout', 30) // number with default
const provider = config.get('llm.provider') // inferred from defaults

// Feature toggles
if (config.isFeatureEnabled('retry-logic')) {
  // ...
}
```

## Configuration Cascade

Priority order (later overrides earlier):
1. **Defaults**: Hardcoded in code
2. **User global**: `~/.claude/benchmark-next.conf` (affects all projects for user)
3. **Project deployed**: `.claude/benchmark-next.conf` (from install script, survives upgrades)
4. **Project versioned**: `.benchmark-next/config.json` (gitignored, highest priority)

## Requirements from Bash Implementation

Extracted from `src/sidekick/lib/config.sh`:
- Shell variable-based config (map to JSON/TypeScript objects)
- Feature flags (`FEATURE_*` → `features.*`)
- Namespace prefixes (e.g., `TOPIC_*`, `SLEEPER_*`)
- Optional files (don't error if missing)
- Validate required fields

## Dependencies

Will need:
- File system access (Node.js `fs`)
- Path resolution (tilde expansion)
- JSON/TOML parsing (decide on format)
- Zod schema validation

## Migration Notes

When porting from bash:
- Map shell variables to nested JSON objects
- Use Zod for runtime validation
- Support both JSON and TOML formats (TOML more human-friendly)
- Preserve exact cascade behavior for parity
