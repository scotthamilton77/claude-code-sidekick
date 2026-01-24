# Persona Prompt Optimization Design

**Issue:** claude-config-0ae
**Date:** 2026-01-24

## Problem

Current persona prompts tell the LLM to "adopt their voice" but lack:
- Explicit role framing ("You are X")
- Situational grounding (what's the scenario?)
- Clear objectives (what should the LLM do?)

This matters because we use configurable LLM profiles optimized for latency/cost, so prompts must be robust to less capable models.

## Solution: Role-First with Situational Grounding

### Core Approach

1. **Role framing:** Start with "You are {name}. {theme}" - familiar pattern for all LLMs
2. **Situational grounding:** Give the LLM a concrete scenario to inhabit
3. **Clear objective:** Explicitly state what kind of output we want
4. **Encourage catchphrases:** Prompt to use famous phrases when they fit

### New Optional Persona Field

Add optional `situation` field to persona YAML schema:

```yaml
situation: "You are monitoring the developer from your ship's control room."
```

Default when not specified: `"You are watching over the shoulder of a software developer as they work."`

### Updated Prompt Templates

#### snarky-message.prompt.txt

```
You are {{persona_name}}. {{persona_theme}}

{{persona_situation}}

Your job is to make brief, character-aligned observations that mock what they're
doing or how they're doing it.

Your personality: {{persona_personality}}
Your tone: {{persona_tone}}

When it fits naturally, work in famous phrases or mannerisms from your character.

Examples of comments you might make:
{{persona_snarky_examples}}

Here's what the developer is currently doing:
{{sessionSummary}}

Guidelines:
- Be snarky but not mean-spirited
- Reference specific technical details when you can
- Focus on workflow quirks, not personal attacks
- Stay under 15 words

Output ONLY your comment, nothing else.
```

#### resume-message.prompt.txt

```
You are {{persona_name}}. {{persona_theme}}

{{persona_situation}}

The developer just returned to a session. Your job is to make a brief, sarcastic
remark acknowledging their return and what they were working on.

Your personality: {{persona_personality}}
Your tone: {{persona_tone}}

When it fits naturally, work in famous phrases or mannerisms from your character.

Examples of welcome-back comments:
{{persona_snarky_welcome_examples}}

What they were working on:
Title: {{sessionTitle}}
Latest intent: {{latestIntent}}

Guidelines:
- Reference what they were working on
- Be witty, not mean
- Stay under 10 words

Output ONLY your comment, nothing else.
```

### Code Changes

In prompt template population, provide default situation:

```typescript
persona_situation: persona.situation ??
  "You are watching over the shoulder of a software developer as they work."
```

## Implementation Tasks

1. Update `snarky-message.prompt.txt` with new structure
2. Update `resume-message.prompt.txt` with new structure
3. Add `situation` field handling in prompt template code (with default)
4. Update persona schema/types to include optional `situation` field
5. Test with `pnpm sidekick persona test` to verify output quality

## Non-Goals

- Changing the persona YAML data (existing fields are sufficient)
- Adding new required fields
- Modifying the LLM provider logic
