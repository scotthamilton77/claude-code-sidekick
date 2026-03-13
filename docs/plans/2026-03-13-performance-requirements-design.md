# Performance Requirements Design

**Date:** 2026-03-13
**Spec section:** IMPLEMENTATION-SPEC.md §5
**Status:** Approved

## Context

Neither REQUIREMENTS.md nor PHASE2-AUDIT.md define concrete performance targets for the sidekick UI. This design establishes targets derived from observed data volumes (PHASE2-AUDIT §2.4), UX expectations for a local dev tool, and architectural constraints from §4 (file-based data source, SSE push, Vite middleware).

## Design Principles

1. **Measure, don't guess** — performance marks at key boundaries, not premature optimization
2. **Rotation is the regulator** — log rotation policy (10MB × 5 files) bounds data volume
3. **Single-session model** — one session hydrated at a time, previous released on navigation

## Key Decisions

### Virtual Scrolling (§5.2)

- **Threshold:** 200 events (native DOM below, TanStack Virtual at or above)
- **Library:** TanStack Virtual — ~3KB gzipped, zero-dependency, handles variable-height rows
- **Rationale:** 200 events (~60KB) is trivial for native DOM. Beyond 200, layout thrash is measurable. The known 1000+ event pain point (sidekick-n4lx) is well above threshold

### Live Mode Polling (§5.3)

- **Interval:** 1s frontend refetch cycle after SSE notification
- **Architecture:** Backend pushes SSE via chokidar (50ms stabilization); frontend coalesces notifications within 1s window into a single fetch
- **Reference:** REQUIREMENTS.md F-9

### Rendering Budget (§5.4)

- **Target:** 16ms/frame (60fps)
- **Strategy:** React 18 `startTransition` for non-urgent timeline updates

### Log File Ingestion (§5.5)

- **Ceiling:** 10MB/file, 50MB total (5 rotated files)
- **Approach:** Backend parses NDJSON server-side; browser never touches raw log files
- **No streaming parser needed** — worst case ~33K events from a single file; `JSON.parse` per line handles this in <100ms

### Initial Load Time (§5.6)

- **Target:** <1 second from session selection to rendered timeline
- **Achievable because:** local tool, no network latency, data on same filesystem

### Memory Budget (§5.7)

- **Target:** 256MB maximum browser heap
- **Worst case:** 50MB raw NDJSON → 100-250MB parsed JS objects + ~10MB overhead
- **Bounded by:** log rotation policy; exceeding 256MB indicates a leak, not normal operation

## Performance Targets Summary

| Area | Target | Bound By |
|---|---|---|
| Virtual scrolling threshold | 200 events | DOM layout performance |
| Live mode polling | 1s refetch cycle | UX responsiveness vs CPU |
| Rendering budget | 16ms/frame (60fps) | Browser refresh rate |
| Log file ingestion | 10MB/file, 50MB total | Log rotation policy |
| Initial load time | < 1 second | User perception |
| Memory budget | 256MB browser heap | Log rotation × JS overhead |

## Risks

| Risk | Fallback |
|---|---|
| >100K events in single session | Paginate at API level (§4.5.2) |
| Parse time exceeds 1s | Stream partial results from backend |
| Memory exceeds 256MB | Profile for retained references |
| Sustained high CPU from live mode | Dynamic debounce window increase |

## References

- IMPLEMENTATION-SPEC.md §5 (full specification)
- REQUIREMENTS.md F-9 (live mode auto-follow)
- PHASE2-AUDIT §2.4 (log rotation policy, data volumes)
- IMPLEMENTATION-SPEC §4.2 (chokidar file watching)
- Epic sidekick-n4lx (1000+ event performance)
