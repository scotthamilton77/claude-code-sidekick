# Doctor API Key / Persona Decoupling — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the incorrect persona-gating of OPENROUTER_API_KEY status in the doctor check so the key always reports its true status.

**Architecture:** Delete the 5-line persona-gating block in `runDoctorCheck()`, update one test expectation from `'not-required'` to `'missing'`, remove two now-redundant persona-specific tests. The second and third tests (lines 1232-1256) tested behavior that was only meaningful with the persona gate — without it, they duplicate the base "key present = healthy" and "key absent = missing" tests that already exist.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Update the test expectation (TDD — red)

**Files:**
- Modify: `packages/sidekick-core/src/__tests__/setup-status-service.test.ts:1221-1230`

**Step 1: Update test to expect `'missing'` instead of `'not-required'`**

Change the test at line 1221 from:

```typescript
    it('reports not-required when personas are disabled and no API key present', async () => {
      // Write features.yaml with personas disabled
      const sidekickDir = path.join(homeDir, '.sidekick')
      await fs.mkdir(sidekickDir, { recursive: true })
      await fs.writeFile(path.join(sidekickDir, 'features.yaml'), 'personas:\n  enabled: false\n')

      const result = await service.runDoctorCheck({ skipValidation: true })

      expect(result.apiKeys.OPENROUTER_API_KEY.actual).toBe('not-required')
    })
```

To:

```typescript
    it('reports missing when personas are disabled and no API key present', async () => {
      // Write features.yaml with personas disabled — key is still needed for
      // non-persona LLM features (session titles, completion detection, etc.)
      const sidekickDir = path.join(homeDir, '.sidekick')
      await fs.mkdir(sidekickDir, { recursive: true })
      await fs.writeFile(path.join(sidekickDir, 'features.yaml'), 'personas:\n  enabled: false\n')

      const result = await service.runDoctorCheck({ skipValidation: true })

      expect(result.apiKeys.OPENROUTER_API_KEY.actual).toBe('missing')
    })
```

**Step 2: Remove the two now-redundant persona-specific tests (lines 1232-1256)**

Delete the tests "reports healthy when personas are disabled but API key exists" and "reports missing when personas are enabled and no API key present" — these tested persona-gating behavior that no longer exists. The base doctor tests already cover "key present = healthy" and "key absent = missing".

**Step 3: Run the updated test to verify it fails (red)**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern setup-status-service --testNamePattern "reports missing when personas are disabled"`
Expected: FAIL — source still downgrades to `'not-required'`

---

### Task 2: Remove the persona-gating block (green)

**Files:**
- Modify: `packages/sidekick-core/src/setup-status-service.ts:1020-1024`

**Step 1: Delete the persona-gating block**

Remove these lines (1020-1024):

```typescript
    // If personas are disabled, OPENROUTER_API_KEY is not required regardless of live detection
    const personasEnabled = await this.isPersonasEnabled()
    if (!personasEnabled && apiKeyResults.OPENROUTER_API_KEY.actual === 'missing') {
      apiKeyResults.OPENROUTER_API_KEY.actual = 'not-required'
    }
```

**Step 2: Run the test again to verify it passes (green)**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern setup-status-service --testNamePattern "reports missing when personas are disabled"`
Expected: PASS

---

### Task 3: Verify full suite and build

**Step 1: Run full setup-status-service test suite**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern setup-status-service --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Expected: All tests PASS

**Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Build**

Run: `pnpm build`
Expected: PASS

---

### Task 4: Commit

**Step 1: Stage and commit**

```bash
git add packages/sidekick-core/src/setup-status-service.ts packages/sidekick-core/src/__tests__/setup-status-service.test.ts
git commit -m "fix(doctor): decouple API key status from persona enablement (sidekick-nwpr)"
```
