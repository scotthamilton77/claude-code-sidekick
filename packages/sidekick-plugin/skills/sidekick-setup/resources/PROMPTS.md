# Prompt Templates Reference

**Default location:** `assets/sidekick/prompts/`
**Override locations:** `~/.sidekick/assets/prompts/` or `.sidekick/assets/prompts/`

Prompts are LLM instruction templates used by sidekick features. They use Handlebars syntax for variable interpolation.

## Available Prompts

| Prompt | Used By | Purpose |
|--------|---------|---------|
| `completion-classifier.prompt.txt` | Reminders | Classify if assistant is claiming completion |
| `session-summary.prompt.txt` | Session Summary | Generate title and intent |
| `snarky-message.prompt.txt` | Session Summary | Generate persona-voiced comments |
| `resume-message.prompt.txt` | Session Summary | Generate "welcome back" messages |

---

## completion-classifier.prompt.txt

Classifies assistant stopping intent into categories:
- `CLAIMING_COMPLETION` - Task done
- `ASKING_QUESTION` - Requesting user input
- `ANSWERING_QUESTION` - Responding to info request
- `OTHER` - Progress update, blocker, etc.

### Variables

| Variable | Description |
|----------|-------------|
| `{{lastUserPrompt}}` | User's most recent message |
| `{{lastAssistantMessage}}` | Assistant's response to classify |

### Output Schema

See `assets/sidekick/schemas/completion-classifier.schema.json`

```json
{
  "category": "CLAIMING_COMPLETION | ASKING_QUESTION | ANSWERING_QUESTION | OTHER",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation"
}
```

---

## session-summary.prompt.txt

Analyzes transcript to generate session title and current intent.

### Variables

| Variable | Description |
|----------|-------------|
| `{{previousConfidence}}` | Confidence from last analysis |
| `{{previousAnalysis}}` | Previous summary output |
| `{{transcript}}` | Recent transcript excerpt |

### Output Schema

See `assets/sidekick/schemas/session-summary.schema.json`

```json
{
  "session_title": "string, max 8 words",
  "session_title_confidence": 0.0-1.0,
  "session_title_key_phrases": ["array"],
  "latest_intent": "string, max 15 words",
  "latest_intent_confidence": 0.0-1.0,
  "latest_intent_key_phrases": ["array"],
  "pivot_detected": false
}
```

---

## snarky-message.prompt.txt

Generates persona-voiced snarky comments about the session.

### Variables

| Variable | Description |
|----------|-------------|
| `{{persona}}` | Boolean - is persona active? |
| `{{persona_name}}` | Persona display name |
| `{{persona_theme}}` | Persona character description |
| `{{persona_personality}}` | Comma-separated traits |
| `{{persona_tone}}` | Comma-separated tone traits |
| `{{persona_snarky_examples}}` | Example snarky messages |
| `{{sessionSummary}}` | Current session summary |

### Output

Plain text, max 15 words. No JSON wrapper.

---

## resume-message.prompt.txt

Generates "welcome back" messages for returning sessions.

### Variables

| Variable | Description |
|----------|-------------|
| `{{persona}}` | Boolean - is persona active? |
| `{{persona_name}}` | Persona display name |
| `{{persona_theme}}` | Persona character description |
| `{{persona_personality}}` | Comma-separated traits |
| `{{persona_tone}}` | Comma-separated tone traits |
| `{{persona_snarky_welcome_examples}}` | Example snarky welcome messages for returning users |
| `{{sessionTitle}}` | Session title |
| `{{confidence}}` | Title confidence |
| `{{latestIntent}}` | Latest user intent |
| `{{keyPhrases}}` | Key phrases from session |
| `{{transcript}}` | Recent transcript excerpt |

### Output

Plain text snarky welcome message (8-10 words max). No JSON wrapper.

---

## Overriding Prompts

To customize a prompt:

1. Copy from `assets/sidekick/prompts/` to override location
2. Modify the template
3. Changes apply immediately (hot-reload)

**User-level:** `~/.sidekick/assets/prompts/completion-classifier.prompt.txt`
**Project-level:** `.sidekick/assets/prompts/completion-classifier.prompt.txt`

### Asset Cascade (Priority Order)

1. `.sidekick/assets.local/prompts/` - Untracked project overrides
2. `.sidekick/assets/prompts/` - Tracked project overrides
3. `~/.sidekick/assets/prompts/` - User overrides
4. `assets/sidekick/prompts/` - Bundled defaults

## Tips

- Keep prompt structure intact - only modify wording/guidelines
- Persona variables are conditionally available (use `{{#if persona}}`)
- Test changes with `SIDEKICK_LLM_DEBUG_DUMP=true` to see LLM calls
