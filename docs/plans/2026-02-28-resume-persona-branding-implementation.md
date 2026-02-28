# Resume Message Persona Branding — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Store the source persona in resume messages and apply attribution wrapping when the current persona differs.

**Architecture:** Three-layer change: schema (types), generation (session-summary), display (statusline). No new LLM calls — attribution is pure string formatting.

**Tech Stack:** TypeScript, Zod schemas, Vitest

---

### Task 1: Extend ResumeMessageState Schema

**Files:**
- Modify: `packages/types/src/services/state.ts:169-178`

**Step 1: Add persona fields to the schema**

Add two nullable fields after `timestamp`:

```typescript
export const ResumeMessageStateSchema = z.object({
  last_task_id: z.string().nullable(),
  session_title: z.string().nullable(),
  snarky_comment: z.string(),
  timestamp: z.string(),
  /** Persona ID that generated this message (null when persona disabled) */
  persona_id: z.string().nullable().default(null),
  /** Display name for attribution (null when persona disabled) */
  persona_display_name: z.string().nullable().default(null),
})
```

Using `.default(null)` ensures backward compatibility — existing JSON files without these fields parse correctly.

**Step 2: Verify typecheck passes**

Run: `pnpm --filter @sidekick/types build`
Expected: PASS (no downstream breakage yet — new fields are nullable with defaults)

**Step 3: Commit**

```
feat(types): add persona_id and persona_display_name to ResumeMessageState
```

---

### Task 2: Populate Persona Fields During Generation

**Files:**
- Modify: `packages/feature-session-summary/src/handlers/update-summary.ts:625-630,705-710`
- Test: `packages/feature-session-summary/src/__tests__/side-effects.test.ts`

**Step 1: Write failing tests**

Add two tests to the "Resume Message Generation" describe block in `side-effects.test.ts`:

```typescript
it('includes persona_id and persona_display_name in resume message', async () => {
  const sessionId = 'test-session-persona-brand'

  // Pre-create existing summary
  stateService.setStored(stateService.sessionStatePath(sessionId, 'session-summary.json'), {
    session_id: sessionId,
    session_title: 'Old Project',
    session_title_confidence: 0.8,
    latest_intent: 'Old intent',
    latest_intent_confidence: 0.8,
    timestamp: new Date().toISOString(),
  })

  // Queue LLM responses: 1) summary with pivot, 2) snarky, 3) resume
  llm.queueResponses([
    JSON.stringify({
      session_title: 'New Project',
      session_title_confidence: 0.85,
      session_title_key_phrases: ['testing'],
      latest_intent: 'Testing persona branding',
      latest_intent_confidence: 0.85,
      pivot_detected: true,
    }),
    'Still at it.',
    'Back for more punishment?',
  ])

  await updateSessionSummary(createUserPromptEvent(sessionId), ctx)
  await flushPromises()

  const resumePath = stateService.sessionStatePath(sessionId, 'resume-message.json')
  const resumeContent = stateService.getStored(resumePath) as Record<string, unknown>
  expect(resumeContent.persona_id).toBe('sidekick')
  expect(resumeContent.persona_display_name).toBe('Sidekick')
})

it('stores null persona fields when persona is disabled', async () => {
  const sessionId = 'test-session-disabled-brand'

  // Set persona to disabled
  stateService.setStored(stateService.sessionStatePath(sessionId, 'session-persona.json'), {
    persona_id: 'disabled',
    selected_from: [],
    timestamp: new Date().toISOString(),
  })

  // Pre-create existing summary
  stateService.setStored(stateService.sessionStatePath(sessionId, 'session-summary.json'), {
    session_id: sessionId,
    session_title: 'Old Work',
    session_title_confidence: 0.8,
    latest_intent: 'Old intent',
    latest_intent_confidence: 0.8,
    timestamp: new Date().toISOString(),
  })

  // Queue LLM: 1) summary with pivot, 2) snarky
  // No resume LLM call — disabled persona uses deterministic path
  llm.queueResponses([
    JSON.stringify({
      session_title: 'Disabled Persona Work',
      session_title_confidence: 0.85,
      latest_intent: 'Testing disabled',
      latest_intent_confidence: 0.85,
      pivot_detected: true,
    }),
    'Title changed.',
  ])

  await updateSessionSummary(createUserPromptEvent(sessionId), ctx)
  await flushPromises()

  const resumePath = stateService.sessionStatePath(sessionId, 'resume-message.json')
  const resumeContent = stateService.getStored(resumePath) as Record<string, unknown>
  expect(resumeContent.persona_id).toBeNull()
  expect(resumeContent.persona_display_name).toBeNull()
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/feature-session-summary test -- --testPathPattern side-effects`
Expected: FAIL — `persona_id` is `undefined`, not `'sidekick'`

**Step 3: Implement — populate persona fields in both code paths**

In `update-summary.ts`, disabled persona path (~line 625):
```typescript
const resumeState: ResumeMessageState = {
  last_task_id: null,
  session_title: summary.session_title,
  snarky_comment: summary.latest_intent,
  timestamp: new Date().toISOString(),
  persona_id: null,
  persona_display_name: null,
}
```

In `update-summary.ts`, LLM persona path (~line 705):
```typescript
const resumeState: ResumeMessageState = {
  last_task_id: null,
  session_title: summary.session_title,
  snarky_comment: snarkyWelcome,
  timestamp: new Date().toISOString(),
  persona_id: persona?.id ?? null,
  persona_display_name: persona?.display_name ?? null,
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/feature-session-summary test -- --testPathPattern side-effects`
Expected: PASS

**Step 5: Commit**

```
feat(session-summary): populate persona_id in resume message generation
```

---

### Task 3: Attribution Wrapper in Statusline Display

**Files:**
- Modify: `packages/feature-statusline/src/statusline-service.ts:916-933` (getSummaryContent)
- Modify: `packages/feature-statusline/src/statusline-service.ts:729-735` (buildViewModel call to getSummaryContent)
- Test: `packages/feature-statusline/src/__tests__/statusline.test.ts`

**Step 1: Write failing tests**

Add tests to the display mode describe block in `statusline.test.ts`:

```typescript
it('wraps resume message with persona attribution when persona differs', async () => {
  // Resume from a different persona (TARS generated, current is Sidekick)
  await fs.writeFile(
    path.join(stateDir, 'resume-message.json'),
    JSON.stringify({
      last_task_id: null,
      session_title: 'Previous Work',
      snarky_comment: 'Back already? Shocking.',
      timestamp: new Date().toISOString(),
      persona_id: 'tars',
      persona_display_name: 'TARS',
    })
  )
  // Current session persona is different (sidekick)
  await fs.writeFile(
    path.join(stateDir, 'session-persona.json'),
    JSON.stringify({
      persona_id: 'sidekick',
      selected_from: ['sidekick'],
      timestamp: new Date().toISOString(),
    })
  )

  const service = createStatuslineService({
    stateService,
    setupService,
    sessionId,
    cwd: '/test',
    useColors: false,
    isResumedSession: true,
  })

  const result = await service.render()
  expect(result.displayMode).toBe('resume_message')
  expect(result.viewModel.summary).toBe('TARS: Back already? Shocking.')
})

it('shows resume message as-is when persona matches', async () => {
  await fs.writeFile(
    path.join(stateDir, 'resume-message.json'),
    JSON.stringify({
      last_task_id: null,
      session_title: 'Previous Work',
      snarky_comment: 'Welcome back!',
      timestamp: new Date().toISOString(),
      persona_id: 'sidekick',
      persona_display_name: 'Sidekick',
    })
  )
  await fs.writeFile(
    path.join(stateDir, 'session-persona.json'),
    JSON.stringify({
      persona_id: 'sidekick',
      selected_from: ['sidekick'],
      timestamp: new Date().toISOString(),
    })
  )

  const service = createStatuslineService({
    stateService,
    setupService,
    sessionId,
    cwd: '/test',
    useColors: false,
    isResumedSession: true,
  })

  const result = await service.render()
  expect(result.displayMode).toBe('resume_message')
  expect(result.viewModel.summary).toBe('Welcome back!')
})

it('shows resume as-is when source persona is null (disabled)', async () => {
  await fs.writeFile(
    path.join(stateDir, 'resume-message.json'),
    JSON.stringify({
      last_task_id: null,
      session_title: 'Previous Work',
      snarky_comment: 'Some neutral message',
      timestamp: new Date().toISOString(),
      persona_id: null,
      persona_display_name: null,
    })
  )
  await fs.writeFile(
    path.join(stateDir, 'session-persona.json'),
    JSON.stringify({
      persona_id: 'tars',
      selected_from: ['tars'],
      timestamp: new Date().toISOString(),
    })
  )

  const service = createStatuslineService({
    stateService,
    setupService,
    sessionId,
    cwd: '/test',
    useColors: false,
    isResumedSession: true,
  })

  const result = await service.render()
  expect(result.displayMode).toBe('resume_message')
  expect(result.viewModel.summary).toBe('Some neutral message')
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/feature-statusline test -- --testPathPattern statusline`
Expected: FAIL — attribution not applied yet

**Step 3: Implement attribution wrapper**

In `getSummaryContent`, pass `persona` as a parameter and apply attribution:

```typescript
private getSummaryContent(
  displayMode: DisplayMode,
  summary: SessionSummaryState,
  resume: ResumeMessageState | null,
  snarkyMessage: string,
  emptySessionMessage: string,
  persona: PersonaDefinition | null  // NEW parameter
): { summaryText: string; title: string } {
  switch (displayMode) {
    case 'resume_message': {
      const resumeTitle = resume?.session_title
        ? `Last Session: ${resume.session_title}`
        : DEFAULT_PLACEHOLDERS.newSession
      let resumeSummary = resume?.snarky_comment || emptySessionMessage

      // Attribution wrapper: when source persona differs from current, prefix with source name
      if (
        resume?.persona_id &&
        resume.persona_display_name &&
        persona &&
        persona.id !== 'disabled' &&
        resume.persona_id !== persona.id
      ) {
        resumeSummary = `${resume.persona_display_name}: ${resumeSummary}`
      }

      return {
        summaryText: resumeSummary,
        title: resumeTitle,
      }
    }
    // ... rest unchanged
  }
}
```

Update the call in `buildViewModel` to pass `persona`:

```typescript
const { summaryText, title } = this.getSummaryContent(
  displayMode,
  summary,
  resume,
  snarkyMessage,
  emptySessionMessage,
  persona  // NEW argument
)
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/feature-statusline test -- --testPathPattern statusline`
Expected: PASS

**Step 5: Commit**

```
feat(statusline): apply persona attribution wrapper on resume message mismatch
```

---

### Task 4: Build Verification & Existing Test Pass

**Step 1: Run full build**

Run: `pnpm build`
Expected: PASS

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Run affected test suites**

Run: `pnpm --filter @sidekick/feature-session-summary test -- --testPathPattern side-effects`
Run: `pnpm --filter @sidekick/feature-statusline test -- --testPathPattern statusline`
Expected: All PASS — no regressions from schema change (Zod defaults handle backward compat)

**Step 4: Commit (if any fixups needed)**

```
fix: address build/test issues from persona branding
```
