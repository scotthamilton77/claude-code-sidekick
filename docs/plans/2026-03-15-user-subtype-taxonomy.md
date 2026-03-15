# User Message Subtype Taxonomy — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect `skill-content` user subtype and give each user message subtype distinct, context-aware rendering in the transcript panel.

**Architecture:** Two-layer change: (1) server-side detection in `classifyUserSubtype()` adds skill-content detection via `"Base directory for this skill:"` marker, (2) client-side rendering in `TranscriptLine.tsx` splits the shared system-injection/skill-content branch into distinct visuals with context-aware labels.

**Tech Stack:** TypeScript, React, Tailwind CSS, Vitest, lucide-react icons

---

### Task 1: Add skill-content detection tests

**Files:**
- Modify: `packages/sidekick-ui/server/__tests__/transcript-api.test.ts:537-577` (user subtype classification block)

**Step 1: Write the failing test for skill-content detection**

Add after the existing `classifies isMeta message with command-name as command` test (line ~559):

```typescript
it('classifies isMeta message with skill marker as skill-content', async () => {
  setupTranscript(
    makeUserEntry(
      'Base directory for this skill: /Users/scott/.claude/skills/brainstorming\n\n# Brainstorming\n\nSome skill content here.',
      { isMeta: true }
    )
  )

  const lines = await parseTranscriptLines('myproject', 'session-1')
  expect(lines[0].userSubtype).toBe('skill-content')
})

it('classifies isMeta command-name as command even with skill marker', async () => {
  setupTranscript(
    makeUserEntry(
      '<command-name>/brainstorm</command-name>\nBase directory for this skill: /path/to/skill',
      { isMeta: true }
    )
  )

  const lines = await parseTranscriptLines('myproject', 'session-1')
  expect(lines[0].userSubtype).toBe('command')
})

it('classifies non-meta message with skill marker as prompt', async () => {
  setupTranscript(
    makeUserEntry('Base directory for this skill: /path/to/skill')
  )

  const lines = await parseTranscriptLines('myproject', 'session-1')
  expect(lines[0].userSubtype).toBe('prompt')
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/ui test -- --run server/__tests__/transcript-api.test.ts`
Expected: FAIL — first test expects `'skill-content'` but gets `'system-injection'`

**Step 3: Commit failing tests**

```bash
git add packages/sidekick-ui/server/__tests__/transcript-api.test.ts
git commit -m "test(ui): add failing tests for skill-content user subtype detection"
```

---

### Task 2: Implement skill-content detection

**Files:**
- Modify: `packages/sidekick-ui/server/transcript-api.ts:150-162` (`classifyUserSubtype` function)

**Step 1: Update classifyUserSubtype to detect skill-content**

Replace the function at lines 150-162:

```typescript
/**
 * Classify a user message into subtypes for distinct rendering.
 * Detection order matters: command > skill-content > system-injection > prompt.
 */
function classifyUserSubtype(entry: Record<string, unknown>, content: string): ApiUserSubtype {
  if (entry.isMeta === true) {
    if (content.includes('<command-name>')) return 'command'
    if (content.includes('Base directory for this skill:')) return 'skill-content'
    return 'system-injection'
  }
  if (content.includes('<system-reminder>')) return 'system-injection'
  if (content.includes('<command-name>')) return 'command'
  return 'prompt'
}
```

The only change is inserting the skill-content check between command and system-injection in the isMeta branch.

**Step 2: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/ui test -- --run server/__tests__/transcript-api.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add packages/sidekick-ui/server/transcript-api.ts
git commit -m "feat(ui): detect skill-content user subtype via skill marker"
```

---

### Task 3: Add skill name extraction helper + context-aware label helpers

**Files:**
- Modify: `packages/sidekick-ui/src/components/transcript/TranscriptLine.tsx:87-91` (helper functions area)

**Step 1: Add extractSkillName helper after extractCommandName (line ~91)**

```typescript
/** Extract skill name from content containing "Base directory for this skill:" path */
function extractSkillName(content: string): string | null {
  const match = content.match(/Base directory for this skill:.*\/skills\/([\w-]+)/)
  return match ? match[1] : null
}

/** Derive a context-aware label for system-injection subtypes */
function getSystemInjectionLabel(content: string): string {
  if (content.includes('SessionStart')) return 'Session start hook'
  if (content.includes('UserPromptSubmit')) return 'Prompt hook'
  if (content.includes('<system-reminder>')) return 'System reminder'
  return 'System injection'
}
```

**Step 2: No separate test** — these are pure rendering helpers tested via the component rendering in Task 4.

**Step 3: Commit**

```bash
git add packages/sidekick-ui/src/components/transcript/TranscriptLine.tsx
git commit -m "feat(ui): add skill name extraction and system injection label helpers"
```

---

### Task 4: Split rendering for skill-content vs system-injection

**Files:**
- Modify: `packages/sidekick-ui/src/components/transcript/TranscriptLine.tsx:1` (add BookOpen import)
- Modify: `packages/sidekick-ui/src/components/transcript/TranscriptLine.tsx:206-231` (split rendering branch)

**Step 1: Add BookOpen to the lucide-react import (line 1-20)**

Add `BookOpen` to the existing import:

```typescript
import {
  User,
  Bot,
  Terminal,
  BookOpen,
  Scissors,
  // ... rest unchanged
} from 'lucide-react'
```

**Step 2: Replace the combined system-injection/skill-content block (lines 206-231)**

Replace the single branch with two separate branches:

```typescript
  // Skill content: purple collapsed pill with skill name
  if (line.type === 'user-message' && line.userSubtype === 'skill-content') {
    const skillName = extractSkillName(line.content ?? '') ?? 'unknown'
    return (
      <div onClick={onClick} className="px-2 py-0.5 cursor-pointer flex justify-center">
        <div className="w-[60%]">
        <div className={`rounded-lg px-2.5 py-1 bg-purple-50 dark:bg-purple-950/30 border-l-2 border border-purple-200 dark:border-purple-800 border-l-purple-400 dark:border-l-purple-500 ${
          isSelected ? 'ring-2 ring-indigo-400 dark:ring-indigo-500' : isSynced ? 'ring-2 ring-amber-400 dark:ring-amber-500' : ''
        }`}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowInjection(!showInjection) }}
            className="flex items-center gap-1.5 w-full"
          >
            {showInjection ? <ChevronDown size={10} className="text-purple-400" /> : <ChevronRight size={10} className="text-purple-400" />}
            <BookOpen size={10} className="text-purple-500 dark:text-purple-400" />
            <span className="text-[10px] font-medium text-purple-600 dark:text-purple-400">Skill: {skillName}</span>
            <span className="text-[10px] text-slate-400 ml-auto tabular-nums flex-shrink-0">{formatTime(line.timestamp)}</span>
          </button>
          {showInjection && line.content && (
            <p className="text-[10px] font-mono text-purple-600/70 dark:text-purple-300/60 mt-1 leading-relaxed whitespace-pre-wrap line-clamp-[20]">
              {line.content}
            </p>
          )}
        </div>
        </div>
      </div>
    )
  }

  // System injection: gray collapsed with context-aware label
  if (line.type === 'user-message' && line.userSubtype === 'system-injection') {
    const label = getSystemInjectionLabel(line.content ?? '')
    return (
      <div onClick={onClick} className="px-2 py-0.5 cursor-pointer flex justify-center">
        <div className="w-[60%]">
        <div className={`rounded-lg px-2.5 py-1 bg-gray-50 dark:bg-gray-900/50 border-l-2 border border-gray-200 dark:border-gray-700 border-l-gray-400 dark:border-l-gray-500 ${
          isSelected ? 'ring-2 ring-indigo-400 dark:ring-indigo-500' : isSynced ? 'ring-2 ring-amber-400 dark:ring-amber-500' : ''
        }`}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowInjection(!showInjection) }}
            className="flex items-center gap-1.5 w-full"
          >
            {showInjection ? <ChevronDown size={10} className="text-gray-400" /> : <ChevronRight size={10} className="text-gray-400" />}
            <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">{label}</span>
            <span className="text-[10px] text-slate-400 ml-auto tabular-nums flex-shrink-0">{formatTime(line.timestamp)}</span>
          </button>
          {showInjection && line.content && (
            <p className="text-[10px] font-mono text-gray-500 dark:text-gray-400 mt-1 leading-relaxed whitespace-pre-wrap line-clamp-[20]">
              {line.content}
            </p>
          )}
        </div>
        </div>
      </div>
    )
  }
```

**Step 3: Run build + typecheck to verify**

Run: `pnpm build && pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/sidekick-ui/src/components/transcript/TranscriptLine.tsx
git commit -m "feat(ui): distinct rendering for skill-content (purple) and context-aware system-injection labels"
```

---

### Task 5: Verify end-to-end + update doc comment

**Files:**
- Modify: `packages/sidekick-ui/server/transcript-api.ts:150-153` (doc comment only)

**Step 1: Run full verification suite**

Run: `pnpm build && pnpm typecheck && pnpm lint`
Expected: ALL PASS

**Step 2: Run targeted tests**

Run: `pnpm --filter @sidekick/ui test -- --run server/__tests__/transcript-api.test.ts`
Expected: ALL PASS

**Step 3: Verify the updated doc comment matches new detection order**

The comment at line 150-152 should already say:
```
Detection order matters: command > skill-content > system-injection > prompt.
```
(Updated in Task 2.)

**Step 4: Final commit if any doc adjustments needed, otherwise skip**

---

### Task 6: Cleanup and design doc update

**Files:**
- Modify: `docs/plans/2026-03-15-user-subtype-taxonomy-design.md` (mark complete)

**Step 1: Update design doc status to Complete**

Change `**Status**: Approved` to `**Status**: Complete`

**Step 2: Commit**

```bash
git add docs/plans/2026-03-15-user-subtype-taxonomy-design.md
git commit -m "docs: mark user subtype taxonomy design as complete"
```
