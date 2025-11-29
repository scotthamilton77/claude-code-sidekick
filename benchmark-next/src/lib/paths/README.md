# lib/paths/

**Status**: ⏳ Not Started (Planned for Phase 2.6)

**Shared Candidate**: High - workspace structure shared across systems

## Purpose

Path utilities and workspace management matching bash implementation in `src/sidekick/lib/paths.sh`.

## Planned API

```typescript
import { Paths } from '@/lib/paths'

// Project root detection
const projectRoot = Paths.getProjectRoot()

// Sidekick paths
const sidekickRoot = Paths.getSidekickRoot() // ~/.claude or .claude
const sessionDir = Paths.getSessionDir(sessionId)
const topicFile = Paths.getTopicFile(sessionId)
const resumeFile = Paths.getResumeFile(sessionId)

// Config paths (with cascade resolution)
const configPath = Paths.resolveConfig('benchmark-next.conf', {
  user: true, // check ~/.claude/
  projectDeployed: true, // check .claude/
  projectVersioned: true, // check .benchmark-next/
})

// Safe path operations
const safePath = Paths.sanitize(userInput) // prevent directory traversal
const expanded = Paths.expandTilde('~/.claude/config') // => /home/user/.claude/config
```

## Requirements from Bash Implementation

Extracted from `src/sidekick/lib/paths.sh`:
- **Project root detection**: Find git root or CLAUDE_PROJECT_DIR
- **Sidekick root**: ~/.claude/hooks/sidekick or .claude/hooks/sidekick
- **Session paths**: `.sidekick/sessions/${session_id}/`
  - `topic.json` - Conversation topic
  - `resume-message.json` - Resume data
  - `sidekick.log` - Session log
- **Config resolution**: Find config files in cascade order
- **Tilde expansion**: Support `~/` in paths

## Directory Structure

```
${PROJECT_ROOT}/
├── .sidekick/
│   ├── sidekick.log              # Global log
│   ├── sessions/
│   │   └── ${session_id}/
│   │       ├── topic.json
│   │       ├── resume-message.json
│   │       └── sidekick.log      # Session log
│   └── cache/                    # Optional cache dir
├── .claude/                      # Project deployed config
│   └── benchmark-next.conf
└── .benchmark-next/              # Project versioned config (gitignored)
    └── config.json
```

User-level:
```
~/.claude/
├── benchmark-next.conf           # User global config
└── hooks/
    └── sidekick/
        └── sidekick.conf
```

## Dependencies

Will need:
- Node.js `path` module
- Node.js `fs` for directory detection
- Simple-git or git command for root detection

## Migration Notes

When porting from bash:
- Use `path.resolve()` for absolute paths
- Handle Windows paths (even though bash is Unix-only)
- Preserve exact directory structure for parity
- Cache project root detection (expensive operation)
