# Core Configuration Reference

**Default file:** `assets/sidekick/defaults/core.defaults.yaml`
**Override locations:** `~/.sidekick/core.yaml` or `.sidekick/core.yaml`

## Structure

```yaml
logging:
  level: <debug|info|warn|error>
  format: <pretty|json>
  consoleEnabled: <boolean>

paths:
  state: <string>               # State directory (default: .sidekick)
  assets: <string>              # Custom assets path (optional)

daemon:
  idleTimeoutMs: <number>       # Auto-shutdown after idle
  shutdownTimeoutMs: <number>   # Graceful shutdown timeout

ipc:
  connectTimeoutMs: <number>
  requestTimeoutMs: <number>
  maxRetries: <number>
  retryDelayMs: <number>

development:
  enabled: <boolean>            # Dev mode (changes behavior)
```

## Settings

### Logging

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `logging.level` | string | `info` | Log verbosity: debug, info, warn, error |
| `logging.format` | string | `pretty` | Output format: pretty (human), json (structured) |
| `logging.consoleEnabled` | boolean | `false` | Also log to console (not just file) |

### Paths

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `paths.state` | string | `.sidekick` | Directory for session data, logs, etc. |
| `paths.assets` | string | (auto) | Override bundled assets location |

### Daemon

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `daemon.idleTimeoutMs` | number | 300000 | Shutdown after 5 min idle |
| `daemon.shutdownTimeoutMs` | number | 30000 | Graceful shutdown wait (30s) |

### IPC (Inter-Process Communication)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ipc.connectTimeoutMs` | number | 5000 | Connection timeout |
| `ipc.requestTimeoutMs` | number | 30000 | Request timeout |
| `ipc.maxRetries` | number | 3 | Retry attempts |
| `ipc.retryDelayMs` | number | 100 | Delay between retries |

### Development

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `development.enabled` | boolean | `false` | Enable dev mode behaviors |

## Local Overrides (core.local.yaml)

For local-only changes that are not tracked in git, create `.sidekick/core.local.yaml`:

```yaml
# .sidekick/core.local.yaml
logging:
  level: debug
  consoleEnabled: true

daemon:
  idleTimeoutMs: 1800000   # Extend to 30 min

development:
  enabled: true
```

## Environment Variables

| Variable | Maps To |
|----------|---------|
| `SIDEKICK_LOG_LEVEL` | `core.logging.level` |
| `SIDEKICK_LOG_FORMAT` | `core.logging.format` |
| `SIDEKICK_STATE_PATH` | `core.paths.state` |
| `SIDEKICK_ASSETS_PATH` | `core.paths.assets` |
| `SIDEKICK_DEVELOPMENT_ENABLED` | `core.development.enabled` |

## Notes

- Changes to daemon/IPC settings may require a daemon restart (`sidekick daemon kill && sidekick daemon start`)
- Logging changes apply immediately (hot-reload)
