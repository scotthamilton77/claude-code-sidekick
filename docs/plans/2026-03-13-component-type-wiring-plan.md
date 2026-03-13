# Section 4: Component-to-Type Wiring — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Produce Section 4 of IMPLEMENTATION-SPEC.md — mapping all 19 v2 prototype React components to their target @sidekick/types, identifying transformation functions and gaps.

**Architecture:** Documentation task. Read component source and @sidekick/types, produce spec tables and interface definitions. Forward-looking (target types, not current UI-local types). Gaps flagged where no canonical type exists.

**Tech Stack:** Markdown spec document, cross-referencing §2 (canonical events), §3 (data contracts), §7 (feature integration)

---

### Task 1: Write §4.1 — Component Inventory & Type Mapping Table

**Files:**
- Modify: `packages/sidekick-ui/docs/IMPLEMENTATION-SPEC.md` (insert Section 4 after Section 3)
- Reference: `packages/sidekick-ui/src/components/*.tsx` (19 files)
- Reference: `packages/sidekick-types/src/events.ts`, `packages/sidekick-types/src/services/state.ts`

**Step 1: Read all 19 component files**

Read every .tsx file in `packages/sidekick-ui/src/components/` to catalog:
- Component name
- Current props interface
- Data it consumes (mock or passed from parent)
- Panel category (Session Selector, Summary Strip, Transcript, Timeline, Detail)

**Step 2: Read @sidekick/types source**

Read `packages/sidekick-types/src/events.ts` and `packages/sidekick-types/src/services/state.ts` to catalog all available target types.

**Step 3: Write the mapping table**

Insert into IMPLEMENTATION-SPEC.md after the last line of Section 3. Create the section header and master table:

```markdown
## 4. Component-to-Type Wiring

Section 4 maps each v2 prototype React component to its target `@sidekick/types` data source, identifies transformation functions needed, and flags gaps where no canonical type exists yet.

> **Scope**: This section defines the wiring spec. Transformation function implementations belong to the implementation epic.

### 4.1 Component Inventory & Type Mapping

| # | Component | Panel | Target Type(s) | Import Path | Transform Needed |
|---|-----------|-------|----------------|-------------|-----------------|
```

Fill in all 19 rows grouped by panel category. For each component:
- **Target Type(s)**: The @sidekick/types type(s) that will feed this component's props
- **Import Path**: e.g., `@sidekick/types/services/state` or `@sidekick/types/events`
- **Transform Needed**: Yes/No — whether backend shape differs from component props

**Step 4: Verify the table**

Count rows — must be exactly 19. Verify every component from the source directory is represented.

**Step 5: Commit**

```bash
git add packages/sidekick-ui/docs/IMPLEMENTATION-SPEC.md
git commit -m "docs(ui): add Section 4.1 component inventory and type mapping table"
```

---

### Task 2: Write §4.2 — Props Interface Definitions

**Files:**
- Modify: `packages/sidekick-ui/docs/IMPLEMENTATION-SPEC.md`

**Step 1: Categorize components by alignment**

Review each component's current props against its target @sidekick/types. Categorize:
- **Aligned**: Props already match target type shape (one-liner reference)
- **Needs new interface**: Props require a new or modified interface (define inline)
- **Needs type extension**: Canonical type exists but is missing fields

**Step 2: Write the subsection**

```markdown
### 4.2 Props Interface Definitions
```

For aligned components, write a one-liner:
```markdown
**CompressedLabel** — No type dependency. Props: `{ text: string; onClick?: () => void }` (UI-only, no backend data).
```

For components needing new interfaces, write the TypeScript interface:
```typescript
/** Props for SessionSelector after wiring to real data */
interface SessionSelectorProps {
  projects: ProjectListItem[]  // from SessionListResponse (§3.2)
}
```

For components needing type extensions, reference §3.7 and the gap list (§4.4).

**Step 3: Commit**

```bash
git add packages/sidekick-ui/docs/IMPLEMENTATION-SPEC.md
git commit -m "docs(ui): add Section 4.2 props interface definitions"
```

---

### Task 3: Write §4.3 — Transformation Functions

**Files:**
- Modify: `packages/sidekick-ui/docs/IMPLEMENTATION-SPEC.md`

**Step 1: Identify all transformations**

From the §4.1 table, collect every component marked "Transform Needed: Yes". For each, determine:
- Source type (backend response or state file schema)
- Target type (component props)
- What the transformation does

Key transformations expected:
1. **Log NDJSON → TranscriptLine[]**: Parse log entries into UI transcript lines
2. **Multiple state files → LEDState**: Assemble LED indicators from several state files
3. **Log events → SidekickEvent[]**: Derive timeline events from canonical log entries
4. **SessionListResponse → Project[]**: Group sessions by project for the selector
5. **StateFileResponse → StateTab data**: Map state file responses to collapsible sections
6. **Log events → Detail component props**: Extract detail fields from canonical events

**Step 2: Write transformation signatures**

For each transformation, document:
- Function signature (input type → output type)
- Brief logic description (2-4 sentences)
- Which spec sections define the input/output contracts

```markdown
### 4.3 Transformation Functions

#### T-1: Log Stream → Transcript Lines

```typescript
function parseLogToTranscriptLines(entries: LogStreamEntry[]): TranscriptLine[]
```

**Input**: `LogStreamEntry[]` from `LogStreamResponse` (§3.4)
**Output**: `TranscriptLine[]` consumed by `Transcript`, `TranscriptLineCard`, `DetailPanel`
**Logic**: Each log entry's canonical event type (§2.4) determines the `TranscriptLineType`. Fields are extracted from the event payload...
```

**Step 3: Commit**

```bash
git add packages/sidekick-ui/docs/IMPLEMENTATION-SPEC.md
git commit -m "docs(ui): add Section 4.3 transformation function signatures"
```

---

### Task 4: Write §4.4 — Gap List

**Files:**
- Modify: `packages/sidekick-ui/docs/IMPLEMENTATION-SPEC.md`

**Step 1: Compile gaps from Tasks 1-3**

Review the mapping table and transformation list. Identify:
1. Components whose target type does not yet exist in @sidekick/types
2. Components that need backend events not yet emitted (cross-ref §2.9 backend work items R1-R8)
3. Props that require state files not yet written by the daemon
4. Transformation functions that depend on types not yet defined

**Step 2: Write the gap table**

```markdown
### 4.4 Gap List — Components Without Backend Data Sources

| # | Component | Missing Data | Blocked By | Resolution |
|---|-----------|-------------|------------|------------|
| G-1 | ... | ... | §2.9 R1 | ... |
```

For each gap:
- **Missing Data**: What the component needs that doesn't exist
- **Blocked By**: Reference to the spec section or backend work item
- **Resolution**: What must be built (new type, new daemon emission, new state file)

**Step 3: Add cross-reference summary**

Brief paragraph linking §4.4 gaps to §2.9 (backend work items) and §7 (feature tiers), so implementers know the dependency chain.

**Step 4: Commit**

```bash
git add packages/sidekick-ui/docs/IMPLEMENTATION-SPEC.md
git commit -m "docs(ui): add Section 4.4 gap list"
```

---

### Task 5: Final Review & Section Numbering

**Files:**
- Modify: `packages/sidekick-ui/docs/IMPLEMENTATION-SPEC.md`

**Step 1: Verify acceptance criteria**

- [ ] Table mapping all 19 components to @sidekick/types with import paths
- [ ] Each component's props interface defined or referenced
- [ ] Transformation functions identified where backend shape ≠ component props shape
- [ ] Gap list: components needing types that don't exist yet in @sidekick/types

**Step 2: Verify section numbering**

Ensure Section 4 fits between Section 3 and the existing Section 5 (Performance Requirements). Check that existing section numbers (5, 6, 7) don't need renumbering. Update the table of contents if one exists.

**Step 3: Verify cross-references**

Search the document for any references to "Section 4" or "§4" from other sections. Ensure they now resolve correctly.

**Step 4: Run build verification**

```bash
pnpm build && pnpm typecheck
```

(Spec is documentation only — this verifies no accidental code changes broke anything.)

**Step 5: Final commit**

```bash
git add packages/sidekick-ui/docs/IMPLEMENTATION-SPEC.md
git commit -m "docs(ui): complete Section 4 component-to-type wiring spec"
```

---

Commit the plan file:
```bash
git add docs/plans/2026-03-13-component-type-wiring-plan.md
git commit -m "docs(ui): add Section 4 implementation plan"
```
