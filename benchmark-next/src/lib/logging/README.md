# lib/logging/

**Status**: ✅ Complete (Phase 2.5)

**Shared Candidate**: High - logging utilities useful for all systems

## Purpose

Simple Pino logger factory function with directory creation, validation, and multi-stream support.

**Design Philosophy**: Use Pino directly (no wrapper). The factory function handles setup, then consumers use Pino's well-documented API.

## Why No Wrapper?

Original design included a Logger wrapper class (300 lines + 445 lines of tests). After code review, we removed it because:

1. **No abstraction value** - Nobody swaps logger implementations in practice (YAGNI)
2. **Hides good docs** - Pino's documentation is excellent, wrappers require learning custom APIs
3. **Unnecessary complexity** - 745 lines (code + tests) for ~10 lines of real value
4. **Not domain-specific** - Generic logging helpers, not benchmark-specific logic

The factory function provides the only real benefits:
- Directory creation (`mkdir -p`)
- File path validation
- Multi-stream setup (stdout + file)

Then consumers use Pino directly. Simple, documented, maintainable.

## Usage

```typescript
import { createLogger } from '@/lib/logging/createLogger'

const logger = await createLogger({
  level: 'info',
  output: 'file',
  filePath: './logs/app.log'
})

// Use Pino's API directly (object-first)
logger.info({ model: 'gpt-4', tokens: 1234 }, 'LLM request completed')
const child = logger.child({ provider: 'openai' })
```

See `createLogger.ts` JSDoc for options. See [Pino docs](https://getpino.io/) for API.

## Migration from Bash

When porting bash logging calls:

**Bash** (`src/sidekick/lib/logging.sh`):
```bash
log_info "Starting benchmark" "model=gpt-4"
log_error "API failed" "provider=openai"
```

**TypeScript** (use Pino directly):
```typescript
logger.info({ model: 'gpt-4' }, 'Starting benchmark')
logger.error({ provider: 'openai' }, 'API failed')
```

**Key difference**: Pino's first parameter is the structured object, second is the message (reverse of most loggers).
