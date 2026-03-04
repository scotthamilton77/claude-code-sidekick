# Design: sidekick-persona-craft Skill

**Date**: 2026-03-03
**Bead**: sidekick-okoz
**Status**: Approved

## Summary

New skill `sidekick-persona-craft` that codifies the proven 2-phase workflow for creating new personas and enriching existing ones with authentic, source-accurate content.

## Scope

- **In scope**: Creating new persona YAML files, enriching existing personas with better quotes/traits/themes
- **Out of scope**: Persona switching, weighting, curation, configuration (handled by `sidekick-personas`)

## Design

### Skill Metadata

- **Name**: `sidekick-persona-craft`
- **Trigger**: Creating new personas, enriching existing persona YAML files, improving persona voice quality from source material
- **Format**: Single `SKILL.md` (Approach A — inline, self-contained)
- **Location**: `packages/sidekick-plugin/skills/sidekick-persona-craft/SKILL.md` + synced to `.claude/skills/`

### Skill Sections

1. **Decision Gate** — New persona vs. enrichment of existing. Determines starting point.
2. **Phase 1: Research** — Web search for iconic quotes from source material. Collect 25-30 candidates per character. Identify defining traits, speech patterns, catchphrases.
3. **Phase 2: Author/Edit** — Adapt quotes to coding context (swap one key noun, keep the rest recognizable). Write theme, personality_traits, tone_traits. Fill all message arrays to target counts.
4. **Target Counts** — Exact numbers for each YAML field:
   - `theme`: 200-400 characters, full name, source, role, vivid personality, coding context
   - `personality_traits`: 6-8 specific hyphenated compound traits (not generic adjectives)
   - `tone_traits`: 5-6 speech-pattern descriptors (HOW they speak, not WHAT)
   - `statusline_empty_messages`: 18-20
   - `snarky_examples`: 5-7 (max 15 words each)
   - `snarky_welcome_examples`: 4-5 (8-10 words each)
5. **Gold Standard Examples** — Inline examples from Avasarala (theme), Spock (traits), GLaDOS (adapted quotes)
6. **Quality Gates Checklist** — YAML parse, count verification, duplicate checks, build/test commands, no cross-character contamination
7. **File Locations** — Custom persona paths, bundled persona path, hot-reload behavior, llmProfile preservation

### Key Principles

- Quotes must be recognizable from source material — adapt, don't fabricate
- "Swap one key noun" rule: keep the quote's rhythm and voice, change the subject to coding
- Behavioral directives in tone_traits (e.g., "no mechanical sounds") must be preserved during enrichment
- Validate YAML after every edit
- Check for within-file duplicates (same quote in multiple sections)

## Implementation Plan

1. Create `packages/sidekick-plugin/skills/sidekick-persona-craft/SKILL.md`
2. Sync copy to `.claude/skills/sidekick-persona-craft/SKILL.md`
3. Verify skill is loadable
4. Build passes, persona tests pass
