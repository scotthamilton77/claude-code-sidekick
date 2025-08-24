#!/bin/bash

# Pull script: Copy files from ~/.claude to project .claude folder
# Only copies if source file is newer than destination (or destination doesn't exist)

set -e

# Get the absolute path of the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Get the project directory (parent of scripts directory)
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
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

# Build find exclusions for ignored directories
find_args=()
if [[ -f "$IGNORE_FILE" ]]; then
    while IFS= read -r pattern; do
        # Skip empty lines and comments
        [[ -z "$pattern" || "$pattern" =~ ^[[:space:]]*# ]] && continue
        
        # If pattern ends with / or looks like a directory, exclude it from find
        if [[ "$pattern" =~ /$ ]] || [[ "$pattern" =~ \*$ ]] || [[ -d "$SOURCE_DIR/${pattern%/}" ]]; then
            pattern="${pattern%/}"
            # Handle wildcard patterns specially
            if [[ "$pattern" =~ \*$ ]]; then
                pattern="${pattern%\*}"
                # For wildcard patterns, use shell pattern matching
                find_args+=(-not -path "$SOURCE_DIR/$pattern*" -not -path "$SOURCE_DIR/$pattern*/*")
            else
                find_args+=(-not -path "$SOURCE_DIR/$pattern" -not -path "$SOURCE_DIR/$pattern/*")
            fi
        fi
    done < "$IGNORE_FILE"
fi

echo "🔍 Scanning files (excluding ignored directories)..."

# Copy all files recursively, preserving directory structure
copied_count=0
skipped_count=0

# Disable exit-on-error for the file processing loop
set +e

while IFS= read -r -d '' file; do
    rel_path="${file#$SOURCE_DIR/}"
    
    # Skip ignored files (for individual file patterns)
    if is_ignored "$rel_path"; then
        continue
    fi
    
    dest_file="$DEST_DIR/$rel_path"
    
    if copy_if_newer "$file" "$dest_file"; then
        ((copied_count++))
    else
        ((skipped_count++))
    fi
done < <(find "$SOURCE_DIR" -type f "${find_args[@]}" -print0)

# Re-enable exit-on-error
set -e

echo ""
echo "📊 Summary:"
echo "  • Files copied: $copied_count"
echo "  • Files skipped: $skipped_count"
echo "  • Total processed: $((copied_count + skipped_count))"
echo ""
echo "✨ Pull completed successfully!"