# Feature: Session Summary

NOTE: NOT YET REVIEWED

## 1. Overview

The **Session Summary** feature maintains a continuous, evolving understanding of the user's current session. It analyzes the transcript to extract a high-level **Session Title** (what is the user working on?) and the **Latest Intent** (what was the specific last request?).

This context is critical for:
1.  **User Context**: Displaying the current task in the Statusline.
2.  **System Context**: Providing "memory" for the Resume feature when a user returns to a session.
3.  **Personality**: Enabling "snarky" or personality-driven commentary based on the session state (optional/future).

## 2. Architecture

This feature operates primarily as a background task managed by the **Supervisor** to avoid blocking the user's interactive flow.

### 2.1 Components

*   **CLI Hook (`user-prompt-submit`)**:
    *   **Trigger**: Fires when the user sends a message.
    *   **Behavior**: **Forces** an immediate analysis (bypassing countdowns) to capture the new intent.
    *   **Mode**: Asynchronous (fire-and-forget to Supervisor).
*   **CLI Hook (`post-tool-use`)**:
    *   **Trigger**: Fires after a tool execution completes.
    *   **Behavior**: **Conditional**. Checks the confidence countdown. Only triggers analysis if the countdown has reached zero (i.e., we haven't analyzed in N turns and need to re-verify).
    *   **Mode**: Asynchronous.
*   **Supervisor Worker**:
    *   Receives the analysis request.
    *   Manages concurrency (debouncing rapid inputs).
    *   Executes the core logic: Transcript Extraction -> LLM Analysis -> State Update.
*   **State File (`state/session-summary.json`)**:
    *   The single source of truth for the session's summary.
    *   Read by the Statusline (synchronously) and Resume feature.

### 2.2 Data Flow

1.  **Trigger**: User submits a prompt OR a tool finishes.
2.  **Dispatch**: CLI Hook sends `AnalyzeSession(sessionId, transcriptPath, force=boolean)` to Supervisor.
3.  **Extraction**: Supervisor reads the transcript and extracts a relevant excerpt (using tiered "bookmark" logic to optimize tokens).
4.  **Analysis**: Supervisor constructs a prompt and calls the LLM (via `shared-providers`).
5.  **Update**:
    *   LLM returns JSON (Title, Intent, Confidence scores).
    *   Supervisor updates internal state (confidence counters).
    *   Supervisor writes to `state/session-summary.json`.
6.  **Consumption**: Statusline watches/polls `state/session-summary.json` to update the display.

## 3. Detailed Design

### 3.1 Trigger Logic & Throttling

To minimize costs and latency, we employ a hybrid trigger strategy:

1.  **User Prompts (`force=true`)**:
    *   We assume every user message potentially changes the intent.
    *   Therefore, `user-prompt-submit` always triggers a re-analysis.
2.  **Tool Outputs (`force=false`)**:
    *   Tool outputs are voluminous and often don't change the high-level intent.
    *   We use a **Confidence-Based Countdown** to throttle these updates.

**Countdown Logic**:
*   **State Variables**: `title_confidence`, `intent_confidence`, `countdown`.
*   **Reset**: After a successful analysis, `countdown` is reset based on confidence:
    *   **High Confidence (>0.8)**: Reset to **20** (check again after 20 tool uses).
    *   **Medium Confidence (0.6-0.8)**: Reset to **5**.
    *   **Low Confidence (<0.6)**: Reset to **1** (check almost immediately).
*   **Decrement**: Every `post-tool-use` event decrements the counter.
*   **Fire**: When `countdown <= 0`, a new analysis is triggered.

### 3.2 Transcript Extraction (The "Bookmark" System)

To handle long sessions without hitting token limits, we use a **Tiered Extraction Strategy**:

1.  **Bookmark Line**: We track a `bookmark_line` which represents the point where we last had High Confidence in the session title.
2.  **Historical Context**:
    *   Range: Line 1 to `bookmark_line`.
    *   Filtering: Aggressive. Remove tool outputs, verbose logs. Keep only high-level user/assistant exchanges.
3.  **Recent Context**:
    *   Range: `bookmark_line` to End.
    *   Filtering: Light. Keep more detail to capture the immediate context of the latest request.
4.  **Fallback**: If the bookmark strategy yields insufficient context (too few lines), fall back to a standard "tail" of the last N lines.

### 3.3 LLM Interaction

*   **Provider**: Uses the configured `LLM_PROVIDER` (default: `claude-cli` or `anthropic`).
*   **Prompt Templates**:
    *   `assets/sidekick/prompts/session-summary.prompt.txt`: Standard full analysis.
    *   `assets/sidekick/prompts/session-summary-bookmark.prompt.txt`: Tiered analysis (Historical + Recent).
*   **Schema**: Enforced via `assets/sidekick/schemas/session-summary.schema.json`.

### 3.4 State Schema (`state/session-summary.json`)

```json
{
  "session_id": "uuid",
  "timestamp": "ISO8601",
  "session_title": "Refactoring the Login Flow",
  "session_title_confidence": 0.95,
  "session_title_key_phrases": ["login.ts", "auth provider", "oauth"],
  "latest_intent": "Fixing the token expiration bug",
  "latest_intent_confidence": 0.88,
  "latest_intent_key_phrases": ["token", "expire", "401 error"],
  "stats": {
    "total_tokens": 1234,
    "processing_time_ms": 450
  }
}
```

## 4. Configuration

| Key | Default | Description |
| :--- | :--- | :--- |
| `feature.session_summary.enabled` | `true` | Master toggle. |
| `feature.session_summary.provider` | `claude-cli` | LLM provider to use. |
| `feature.session_summary.max_title_words` | `10` | Max words for session title. |
| `feature.session_summary.max_intent_words` | `15` | Max words for latest intent. |
| `feature.session_summary.bookmark_enabled` | `true` | Enable tiered context extraction. |

## 5. Implementation Plan

### 5.1 Phase 1: Core Logic (Node.js)
- [ ] Port `_session_summary_extract_excerpt` logic to TypeScript (`sidekick-core`).
- [ ] Implement the "Bookmark" and "Countdown" state logic.
- [ ] Create the `SessionSummaryService` in `feature-session-summary`.

### 5.2 Phase 2: Supervisor Integration
- [ ] Define the `AnalyzeSessionTask` interface.
- [ ] Implement the Supervisor worker handler.
- [ ] Connect the `user-prompt-submit` hook to dispatch the task.

### 5.3 Phase 3: Assets & Prompts
- [ ] Migrate `.prompt.txt` files to `assets/sidekick/prompts/`.
- [ ] Migrate `.schema.json` to `packages/schema-contracts`.

## 6. Outstanding Questions

1.  **Snarky Commentary**: The legacy script had hooks for "snarky comments". Is this a separate feature (`feature-personality`) or part of this one?
    *   *Recommendation*: Keep it separate. `feature-session-summary` produces the *data*. `feature-personality` (if we build it) *consumes* that data to generate commentary.
2.  **Sleeper**: The legacy script launched a "sleeper" process.
    *   *Recommendation*: The Supervisor replaces the ad-hoc "sleeper". The Supervisor can schedule delayed tasks (e.g., "If no activity for 5 mins, generate a 'bored' comment").
