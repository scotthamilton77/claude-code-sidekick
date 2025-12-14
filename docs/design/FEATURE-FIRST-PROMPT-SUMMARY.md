# Feature: First-Prompt Summary

## 1. Overview

The First-Prompt Summary feature provides immediate, contextual feedback during the first turn of a Claude Code session. Instead of showing a static "New session" placeholder, it generates a snarky, personality-driven message based on the user's initial prompt.

**Key Goals:**
- Provide meaningful content during the first turn (before session summary exists)
- Maintain Sidekick's personality through witty, contextual messages
- Signal explicit state via file presence (no inference from token counts)

**Relationship to Session Summary:** First-prompt summary is a *transitional* artifact that gets superseded by the session summary once confidence is sufficient. Both files may coexist; display priority is confidence-aware.

## 2. Trigger & Flow

### 2.1 Trigger Event

The Supervisor triggers first-prompt generation on `UserPromptSubmit` when:
1. No `session-summary.json` exists (or confidence below threshold)
2. No `first-prompt-summary.json` exists

```
UserPromptSubmit → Supervisor:
  └─ if (!session-summary.json || summary.confidence < threshold)
     └─ if (!first-prompt-summary.json)
        └─ async: generate first-prompt-summary.json
```

### 2.2 Async Execution

Generation runs asynchronously — it does NOT block the hook response. The LLM call may complete before or after the agent's first response; either outcome is acceptable.

### 2.3 Race Condition Handling

If the session summary is generated before first-prompt completes:
- Let first-prompt write anyway (harmless — won't be displayed if summary confidence is sufficient)
- File serves historical/debugging purposes

## 3. Slash Command Classification

### 3.1 Skip LLM (Static or Nothing)

These commands are meta-operations that don't warrant creative commentary:

```typescript
const SKIP_LLM_COMMANDS = new Set([
  'add-dir', 'agents', 'bashes', 'bug', 'clear', 'compact',
  'config', 'context', 'cost', 'doctor', 'exit', 'export',
  'help', 'hooks', 'ide', 'install-github-app', 'login',
  'logout', 'mcp', 'memory', 'output-style', 'permissions',
  'plugin', 'pr-comments', 'privacy-settings', 'release-notes',
  'resume', 'rewind', 'sandbox', 'security-review', 'stats',
  'status', 'statusline', 'terminal-setup', 'todos', 'usage', 'vim'
])
```

**Behavior:** Output static message (e.g., "Configuring...") or skip generation entirely.

### 3.2 Send to LLM (Snarkify)

These commands have meaningful intent worth commenting on:

| Command | Example Snark |
|---------|---------------|
| `/init` | "Setting up ground rules... which you'll promptly ignore" |
| `/model` | "Switching models... apparently I wasn't good enough" |
| `/review` | "Code review requested... let's see what horrors await" |
| Custom commands | Sent to LLM for classification |

**Rule:** Any slash command NOT in `SKIP_LLM_COMMANDS` is sent to the LLM.

## 4. Prompt Strategy

### 4.1 Pre-Classification (Code Layer)

```typescript
function shouldGenerateFirstPrompt(userPrompt: string): 'skip' | 'static' | 'llm' {
  const slashMatch = userPrompt.match(/^\/(\S+)/)
  if (!slashMatch) return 'llm'  // Not a slash command

  const command = slashMatch[1]
  if (SKIP_LLM_COMMANDS.has(command)) return 'static'

  return 'llm'  // Known snarkifiable or custom command
}
```

### 4.2 LLM Prompt Template

```markdown
You are generating a brief, snarky status message for a coding assistant's status line.

## Context
{{#if resumeMessage}}
Previous session goal: {{resumeMessage}}
{{else}}
This is a brand new session (no prior context).
{{/if}}

## User's First Input
{{userPrompt}}

## Instructions
1. Classify the input:
   - COMMAND: Slash command or configuration action
   - CONVERSATIONAL: Greeting, small talk, or social interaction
   - INTERROGATIVE: Question about codebase, capabilities, or exploration
   - AMBIGUOUS: Context-setting but unclear specific goal
   - ACTIONABLE: Clear task with specific intent

2. Generate a single snarky line (max 60 characters) appropriate to the classification.

## Tone Guidelines
- Witty and slightly sardonic, never mean
- Self-aware about AI limitations
- References to sci-fi welcome (Hitchhiker's, Star Trek, etc.)
- Match energy: serious tasks get wry acknowledgment, casual inputs get playful response

## Output Format
Return ONLY the snarky message, no explanation or classification label.
```

### 4.3 Classification-Specific Flavor

| Classification | Flavor |
|----------------|--------|
| COMMAND | Acknowledge the meta-action with mild resignation |
| CONVERSATIONAL | Playful deflection toward actual work |
| INTERROGATIVE | Note the exploration/discovery mode |
| AMBIGUOUS | Express witty uncertainty about intent |
| ACTIONABLE | Confident acknowledgment of the mission |

## 5. Model Configuration

### 5.1 Model Selection

| Role | Provider | Model | Rationale |
|------|----------|-------|-----------|
| **Primary** | claude-cli | `claude-3-5-haiku` | Best personality for creative snark |
| **Fallback** | openrouter | `google/gemini-2.0-flash-lite-001` | Fast, cheap, adequate quality |
| **Final** | static | — | "Deciphering intent..." |

**Latency Note:** Since generation is async, Haiku's ~5s latency is acceptable. The message appears on next statusline render (typically after agent response).

### 5.2 Configuration Schema

```typescript
interface FirstPromptConfig {
  /** Enable/disable the feature */
  enabled: boolean

  /** Model configuration with fallback chain */
  model: {
    primary: {
      provider: 'claude-cli' | 'openrouter' | 'openai'
      model: string
    }
    fallback: {
      provider: 'claude-cli' | 'openrouter' | 'openai'
      model: string
    } | null
  }

  /** Message shown when LLM call fails */
  staticFallbackMessage: string

  /** Commands that skip LLM generation entirely */
  skipCommands: string[]

  /** Message shown for skipped commands (null = no file written) */
  staticSkipMessage: string | null

  /** Confidence threshold for preferring first-prompt over low-confidence summary */
  confidenceThreshold: number
}
```

### 5.3 Default Configuration

```typescript
const DEFAULT_FIRST_PROMPT_CONFIG: FirstPromptConfig = {
  enabled: true,
  model: {
    primary: { provider: 'claude-cli', model: 'haiku' },
    fallback: { provider: 'openrouter', model: 'google/gemini-2.0-flash-lite-001' }
  },
  staticFallbackMessage: 'Deciphering intent...',
  skipCommands: [
    'add-dir', 'agents', 'bashes', 'bug', 'clear', 'compact',
    'config', 'context', 'cost', 'doctor', 'exit', 'export',
    'help', 'hooks', 'ide', 'install-github-app', 'login',
    'logout', 'mcp', 'memory', 'output-style', 'permissions',
    'plugin', 'pr-comments', 'privacy-settings', 'release-notes',
    'resume', 'rewind', 'sandbox', 'security-review', 'stats',
    'status', 'statusline', 'terminal-setup', 'todos', 'usage', 'vim'
  ],
  staticSkipMessage: null,  // Don't write file for skipped commands
  confidenceThreshold: 0.6
}
```

## 6. State File Schema

### 6.1 File Location

```
.sidekick/sessions/{session_id}/state/first-prompt-summary.json
```

### 6.2 Schema Definition

```typescript
const FirstPromptSummarySchema = z.object({
  /** Session identifier */
  session_id: z.string(),

  /** Generation timestamp (ISO 8601) */
  timestamp: z.string().datetime(),

  /** The generated snarky message */
  message: z.string(),

  /** Classification determined by LLM */
  classification: z.enum([
    'command', 'conversational', 'interrogative', 'ambiguous', 'actionable'
  ]).optional(),

  /** Source of the message */
  source: z.enum(['llm', 'static', 'fallback']),

  /** Model used (if LLM-generated) */
  model: z.string().optional(),

  /** Generation latency in ms */
  latencyMs: z.number().optional(),

  /** Original user prompt (for debugging) */
  userPrompt: z.string(),

  /** Whether resume context was available */
  hadResumeContext: z.boolean()
})

type FirstPromptSummary = z.infer<typeof FirstPromptSummarySchema>
```

### 6.3 Example File

```json
{
  "session_id": "sess-abc123",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "message": "Refactoring auth... what could go wrong?",
  "classification": "actionable",
  "source": "llm",
  "model": "claude-3-5-haiku",
  "latencyMs": 4823,
  "userPrompt": "refactor the authentication module to use JWT",
  "hadResumeContext": false
}
```

### 6.4 File Lifecycle

- **Created:** On first `UserPromptSubmit` when conditions met (§2.1)
- **Never updated:** Once written, file is immutable for the session
- **Never deleted:** Retained for historical/debugging purposes
- **Superseded by:** `session-summary.json` when confidence exceeds threshold

## 7. Statusline Integration

### 7.1 Display Mode Selection

The statusline determines display mode based on file presence and confidence:

```typescript
function determineDisplayMode(
  sessionSummary: SessionSummaryState | null,
  firstPromptSummary: FirstPromptSummary | null,
  resumeMessage: ResumeMessageState | null,
  config: { confidenceThreshold: number }
): DisplayMode {
  // Priority 1: Resume message (explicit session continuation)
  if (resumeMessage && this.isResumedSession) {
    return 'resume_message'
  }

  // Priority 2: Confident session summary
  const hasSummary = sessionSummary?.session_title && sessionSummary.session_title !== ''
  const summaryConfident = (sessionSummary?.session_title_confidence ?? 0) >= config.confidenceThreshold

  if (hasSummary && summaryConfident) {
    return 'session_summary'
  }

  // Priority 3: First-prompt summary (when summary missing or low confidence)
  if (firstPromptSummary) {
    return 'first_prompt'
  }

  // Priority 4: Low-confidence session summary (better than nothing)
  if (hasSummary) {
    return 'session_summary'
  }

  // Priority 5: Empty (brand new, nothing submitted)
  return 'empty_summary'
}
```

### 7.2 Summary Content Selection

```typescript
function getSummaryContent(displayMode: DisplayMode, ...): { summaryText: string; title: string } {
  switch (displayMode) {
    case 'resume_message':
      return {
        summaryText: resumeMessage?.resume_last_goal_message || DEFAULT_PLACEHOLDERS.newSession,
        title: sessionSummary?.session_title || ''
      }

    case 'first_prompt':
      return {
        summaryText: firstPromptSummary?.message || DEFAULT_PLACEHOLDERS.awaitingFirstTurn,
        title: ''
      }

    case 'empty_summary':
      return {
        summaryText: DEFAULT_PLACEHOLDERS.newSession,
        title: ''
      }

    case 'session_summary':
    default:
      // Existing logic: snarky > latest_intent > title
      // ...
  }
}
```

### 7.3 StateReader Extension

Add method to read first-prompt summary:

```typescript
interface StateReader {
  // Existing methods...
  getSessionState(): Promise<StateReadResult<SessionMetricsState>>
  getSessionSummary(): Promise<StateReadResult<SessionSummaryState>>
  getResumeMessage(): Promise<StateReadResult<ResumeMessageState | null>>
  getSnarkyMessage(): Promise<StateReadResult<string>>

  // New method
  getFirstPromptSummary(): Promise<StateReadResult<FirstPromptSummary | null>>
}
```

## 8. Low-Confidence Session Summary Handling

### 8.1 Strategy: Option D (Confidence-Gated Display)

- **Always write** `session-summary.json` (for telemetry/debugging)
- **Display priority** is confidence-aware (§7.1)
- First-prompt stays visible until summary confidence exceeds threshold

### 8.2 Confidence Threshold

Default: `0.6` (configurable)

Below this threshold, the session summary exists but is not considered reliable enough to replace the first-prompt message.

### 8.3 Rationale

- Full data trail preserved (both files written)
- Users see contextually-relevant first-prompt message during uncertain early turns
- Graceful transition to confident summary without jarring changes
- Debugging: can compare first-prompt vs low-confidence summary

## 9. Implementation Plan

### Phase 1: Schema & Types ✅
1. Add `FirstPromptSummarySchema` to `@sidekick/types`
2. Add `FirstPromptConfig` schema
3. Export types from package

### Phase 2: Supervisor Integration ✅
1. Add `UserPromptSubmit` handler in Supervisor
2. Implement slash command classification
3. Implement LLM prompt generation (placeholder pending Phase 5)
4. Implement model fallback chain (placeholder pending Phase 5)
5. Write `first-prompt-summary.json`

### Phase 3: Statusline Integration ✅
1. Add `getFirstPromptSummary()` to StateReader
2. Update `determineDisplayMode()` with confidence-aware logic
3. Update `getSummaryContent()` for `first_prompt` case
4. Update `StatuslineServiceConfig` for confidence threshold

### Phase 4: Configuration ✅
1. Add `first-prompt` section to config schema
2. Wire defaults
3. Document configuration options

### Phase 5: LLM Integration
1. Wire `generateWithLLM()` to `@sidekick/shared-providers` LLMService
2. Implement primary/fallback model chain per `FirstPromptConfig.model`
3. Add timeout handling using `config.llmTimeoutMs`
4. Wire `confidenceThreshold` from config in supervisor trigger (currently hardcoded)
5. Add integration tests with LLM provider mocks

## 10. Open Questions

None — all design decisions resolved in discussion.

## 11. References

- `docs/design/FEATURE-STATUSLINE.md` — Statusline architecture
- `docs/design/FEATURE-RESUME.md` — Resume message handling
- `docs/design/flow.md` — Hook event flow
- `src/sidekick/llm-providers.defaults` — Model configuration
- `docs/model-analysis-report.md` — Benchmark data
