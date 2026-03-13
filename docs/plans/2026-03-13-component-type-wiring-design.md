# Component Type Wiring — Section 4 Design

**Task**: sidekick-e4374d53
**Parent**: sidekick-bf3bcd19 (UI Implementation Spec)
**Target**: `packages/sidekick-ui/docs/IMPLEMENTATION-SPEC.md`, Section 4

## Approach

Option C — map components to canonical `@sidekick/types` (forward-looking). Flag gaps where no canonical type exists yet rather than inventing ad-hoc types.

## Component Count

19 components (revised down from the original 21 estimate after inventory).

## Section Structure

### 4.1 — Component Inventory & Type Mapping Table

Master table grouping all 19 components by UI panel:

- **Session Selector** — session list, search/filter
- **Summary Strip** — session metadata, status indicators
- **Transcript** — message bubbles, tool calls, streaming
- **Timeline** — event timeline, markers
- **Detail** — inspector panels, raw data views

Each row: component name, primary props, source `@sidekick/types` type, transformation needed (yes/no).

### 4.2 — Props Interface Definitions

- Components already aligned with `@sidekick/types`: one-liner reference to the canonical type.
- Components needing new interfaces: inline `interface` definition with rationale.

### 4.3 — Transformation Functions

Function signatures and logic descriptions for converting backend data shapes into component props. Spec only — implementations belong to the implementation epic (sidekick-43a8b12e).

### 4.4 — Gap List

Components or props with no backend data source yet. Each entry includes: component, prop, what is missing, and suggested resolution path.

## Cross-References

- Section 2 — Canonical events (event types that feed Timeline and Transcript)
- Section 3 — Data contracts (API response shapes that transformations consume)
- Section 7 — Feature integration (how components compose into features)

## Scope Boundary

This section is **spec only**. Transformation function implementations, component code, and test scaffolding belong to the implementation epic (sidekick-43a8b12e).
