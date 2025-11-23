# Background Supervisor

## Scope

Detached process management, IPC, state management (single writer), async tasks (resume, summary).

## Outstanding Questions / Concerns

- **IPC Mechanism**: Need to pick between Unix domain sockets, named pipes, or stdio RPC and describe handshake + auth expectations.
- **Task Protocol**: Define message schema for enqueueing work (e.g., statusline refresh vs session-summary update) and how results/metrics are returned.
- **Lifecycle Management**: Clarify how the CLI detects stale PIDs, restarts the supervisor after hook updates, and ensures only one instance runs per scope.
- **State Writes**: Document atomic write strategy (temp files + mv) and how supervisor guards against partial writes when crashed.
- **Resource Limits**: Establish concurrency controls so CPU-heavy tasks don't starve low-latency hooks.
