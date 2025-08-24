#!/bin/bash

# Pull script: Copy files from ~/.claude to project .claude folder
# Only copies if source file is newer than destination (or destination doesn't exist)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE_DIR="$HOME/.claude"
DEST_DIR="$PROJECT_DIR/.claude"
IGNORE_FILE="$PROJECT_DIR/.claudeignore"

echo "🔄 Pulling updates from ~/.claude to project .claude folder..."

# Create destination directory if it doesn't exist
mkdir -p "$DEST_DIR"

# Function to check if a path should be ignored
is_ignored() {
    local path="$1"
    
    # If .claudeignore doesn't exist, don't ignore anything
    if [[ ! -f "$IGNORE_FILE" ]]; then
        return 1
    fi
    
    # Check each ignore pattern
    while IFS= read -r pattern; do
        # Skip empty lines and comments
        [[ -z "$pattern" || "$pattern" =~ ^[[:space:]]*# ]] && continue
        
        # Remove trailing slash for directory patterns
        pattern="${pattern%/}"
        
        # Check if path matches pattern (exact match or starts with pattern/)
        if [[ "$path" == "$pattern" ]] || [[ "$path" == "$pattern"/* ]]; then
            return 0
        fi
    done < "$IGNORE_FILE"
    
    return 1
}

# Function to safely copy a file if source is newer
copy_if_newer() {
    local src="$1"
    local dest="$2"
    local rel_path="${src#$SOURCE_DIR/}"
    
    # Skip if source doesn't exist
    if [[ ! -e "$src" ]]; then
        return 0
    fi
    
    # Create destination directory if needed
    local dest_dir="$(dirname "$dest")"
    mkdir -p "$dest_dir"
    
    # Copy if destination doesn't exist or source is newer
    if [[ ! -e "$dest" ]] || [[ "$src" -nt "$dest" ]]; then
        cp "$src" "$dest"
        echo "  ✅ Copied: $rel_path"
        return 0
    else
        echo "  ⏭️  Skipped: $rel_path (destination is newer or same)"
        return 1
    fi
}

# Copy all files recursively, preserving directory structure
copied_count=0
skipped_count=0

while IFS= read -r -d '' file; do
    rel_path="${file#$SOURCE_DIR/}"
    
    # Skip ignored files
    if is_ignored "$rel_path"; then
        continue
    fi
    
    dest_file="$DEST_DIR/$rel_path"
    
    if copy_if_newer "$file" "$dest_file"; then
        ((copied_count++))
    else
        ((skipped_count++))
    fi
done < <(find "$SOURCE_DIR" -type f -print0)

echo ""
echo "📊 Summary:"
echo "  • Files copied: $copied_count"
echo "  • Files skipped: $skipped_count"
echo "  • Total processed: $((copied_count + skipped_count))"
echo ""
echo "✨ Pull completed successfully!"