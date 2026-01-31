#!/usr/bin/env bash
# dev-mode.sh - Wrapper for TypeScript dev-mode CLI command
#
# Usage:
#   dev-mode.sh enable     # Add dev-sidekick to settings.local.json
#   dev-mode.sh disable    # Remove dev-sidekick from settings.local.json
#   dev-mode.sh status     # Show current state
#   dev-mode.sh clean      # Truncate logs, kill daemon, clean state
#   dev-mode.sh clean-all  # Full cleanup including sessions
#
# This script delegates to: pnpm sidekick dev-mode
# See: packages/sidekick-cli/src/commands/dev-mode.ts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_ROOT}"
exec pnpm sidekick dev-mode "$@"
