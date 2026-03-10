# Unified Event Contract — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Write IMPLEMENTATION-SPEC.md Section 2 defining the canonical event contract, then create beads for CLI/daemon requirements.

**Architecture:** Replace adapter mapping approach with unified event vocabulary in `@sidekick/types`. Push requirements back to emitters.

**Tech Stack:** TypeScript types, NDJSON logging, Pino

---

### Task 1: Write IMPLEMENTATION-SPEC.md Section 2

**Files:**
- Modify: `packages/sidekick-ui/docs/IMPLEMENTATION-SPEC.md:9-10` (replace placeholder)

**Step 1:** Read current events.ts to build accurate canonical mapping table

**Step 2:** Write Section 2 with these subsections:
- 2.1 Design Decision: No Adapter Layer (rationale, what changes)
- 2.2 Canonical Event Table (every event type, visibility, payload, emitter, naming)
- 2.3 Naming Convention (`category:action` format, resolution of 4 audit mismatches)
- 2.4 Start/Finish Pairs (which operations, what daemon must emit)
- 2.5 Validated Phantom Events (each UI-only type → daemon requirement)
- 2.6 Two-File Contract (CLI + daemon write same schema, UI merges)
- 2.7 Deprecation List (current types that die or rename)

**Step 3:** Update Section 3.4's cross-reference that says "event adapter (see Section 2)" to reflect the new approach

**Step 4:** Commit

### Task 2: Create Requirements Backlog Beads

**Step 1:** Create beads for each CLI/daemon change required:
- Daemon: emit start/finish pairs for summary, snarky, resume
- Daemon: emit persona:selected and persona:changed events
- Daemon: emit decision events
- Daemon: emit reminder:unstaged events
- Daemon: emit session-title-changed and intent-changed as discrete events (extract from SummaryUpdated)
- CLI/daemon: align ReminderStaged schema with canonical contract
- Types: add canonical SidekickEventType union to @sidekick/types

**Step 2:** Set dependencies (all depend on the types change)

**Step 3:** Commit beads
