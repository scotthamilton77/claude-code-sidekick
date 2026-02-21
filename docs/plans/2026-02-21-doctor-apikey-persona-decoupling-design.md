# Doctor API Key / Persona Decoupling

**Bead**: sidekick-nwpr
**Date**: 2026-02-21
**Status**: Approved

## Problem

`runDoctorCheck()` in `setup-status-service.ts` (lines 1020-1024) downgrades
`OPENROUTER_API_KEY` from `'missing'` to `'not-required'` when personas are
disabled. This suppresses warnings even though the API key powers non-persona
LLM features:

- Session title generation
- Topic/intent classification
- Completion detection

## Approach

Remove the persona-gating block entirely. The API key status always reflects
live detection truth regardless of persona state.

## Changes

| File | Change |
|------|--------|
| `setup-status-service.ts` | Remove lines 1020-1024 (persona check + downgrade) |
| `setup-status-service.test.ts` | Update test at ~line 1221: expect `'missing'` instead of `'not-required'` when personas disabled and no key present |

## What does NOT change

- `isPersonasEnabled()` method itself (still used by persona features)
- The `setup` command's `--no-personas` flow (decoupled by sidekick-e5sm)
- Overall health calculation logic

## Acceptance criteria

- Build passes
- Typecheck passes
- Tests pass
- Doctor reports `'missing'` for OPENROUTER_API_KEY when absent, regardless of persona state
