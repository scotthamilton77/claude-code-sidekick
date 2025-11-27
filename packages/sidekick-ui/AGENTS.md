# AGENTS.md — @sidekick/ui

## Purpose

React SPA for "Time Travel" debugging of Sidekick sessions. Reconstructs past states from logs to show *why* the system behaved a certain way.

**Current State**: UI mockup only—uses hardcoded mock data, no real data integration.

## Tech Stack

React 18 + Vite + TypeScript + TailwindCSS

## Key Files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Main app, state management, event filtering |
| `src/data/mockData.ts` | Mock session/event/state data (replace with real integration) |
| `src/components/` | Layout, Header, Timeline, Transcript, StateInspector |
| `docs/LLD-MONITORING-UI.md` | **Detailed design doc**—read this for architecture/features |

## Commands

```bash
pnpm -F @sidekick/ui dev      # Start dev server
pnpm -F @sidekick/ui build    # Production build
pnpm -F @sidekick/ui lint     # ESLint check
```

## Design Concepts

- **Unified Cockpit**: Transcript + event log merged into single chronological stream
- **Time Travel**: Scrub timeline to reconstruct state at any point
- **State Inspector**: JSON tree view with diff mode showing what changed

See `docs/LLD-MONITORING-UI.md` for full specification and wireframes.
