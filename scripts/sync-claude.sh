#!/bin/bash

# Sync script: Bidirectional synchronization between ~/.claude and project .claude folder
# Performs pull first, then push to ensure both directories are up to date

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🔄 Starting Claude configuration synchronization..."
echo ""

# Run pull script first (from ~/.claude to project)
echo "📥 Step 1: Pulling from ~/.claude to project..."
"$SCRIPT_DIR/pull-from-claude.sh"

echo ""
echo "📤 Step 2: Pushing from project to ~/.claude..."
"$SCRIPT_DIR/push-to-claude.sh"

echo ""
echo "🎉 Synchronization completed successfully!"
echo ""
echo "💡 Both ~/.claude and project .claude folders are now synchronized"
echo "   Files were copied only when source was newer than destination"