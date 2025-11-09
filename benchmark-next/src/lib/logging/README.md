# lib/logging/

**Status**: ⏳ Not Started (Planned for Phase 2.5)

**Shared Candidate**: Very High - centralized logging critical for all systems

## Purpose

Structured logging system matching bash implementation in `src/sidekick/lib/logging.sh`.

## Planned API

```typescript
import { Logger } from '@/lib/logging'

// Initialize logger for session
const logger = Logger.init({
  sessionId: 'abc123',
  globalLogPath: '.sidekick/sidekick.log',
  sessionLogPath: '.sidekick/sessions/abc123/sidekick.log',
  level: 'debug',
})

// Log with levels
logger.debug('Checking cache', { key: 'foo' })
logger.info('Starting benchmark', { model: 'claude-sonnet-4' })
logger.warn('Retry attempt', { attempt: 2, maxRetries: 3 })
logger.error('API call failed', { error: err })

// Structured fields
logger.info('Request completed', {
  duration: 1234,
  tokens: { input: 100, output: 50 },
})
```

## Requirements from Bash Implementation

Extracted from `src/sidekick/lib/logging.sh`:
- **Dual logging**: Both global and session-specific logs
- **Color output**: ANSI colors for terminal (red errors, green info, etc.)
- **Timestamps**: ISO 8601 format for consistency
- **Log levels**: DEBUG, INFO, WARN, ERROR
- **Context**: Session ID, hook name, feature name
- **Atomic writes**: Append-only for concurrent safety

## Log Format

Match bash output format:
```
[2025-11-09T19:48:23Z] [INFO] [session:abc123] Message here
[2025-11-09T19:48:24Z] [ERROR] [session:abc123] Error message
```

Structured logs (for machine parsing):
```json
{"timestamp":"2025-11-09T19:48:23Z","level":"INFO","session":"abc123","message":"Message here","context":{...}}
```

## Dependencies

Will use:
- `winston` or `pino` (already in package.json: winston)
- Custom formatters for bash-compatible output
- File transports for dual logging

## Migration Notes

When porting from bash:
- Preserve exact timestamp format (ISO 8601)
- Match ANSI color codes
- Ensure atomic writes (Winston handles this)
- Support log rotation (prevent unbounded growth)
