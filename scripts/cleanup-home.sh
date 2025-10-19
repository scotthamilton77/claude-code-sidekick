#!/bin/bash
# Cleanup script: Remove all project .claude files from ~/.claude
# This removes the entire footprint of this project from the user's global config
#
# Usage: cleanup-home.sh [--dry-run]
#   --dry-run: Show what would be deleted without actually deleting
#
# Process:
# 1. Run cleanup-reminders.sh to remove hooks, permissions, and statusline
# 2. Find all files in ~/.claude that exactly match files in this project's .claude/
# 3. Delete matching files (preserving backup files from cleanup-reminders.sh)

# Determine script location and context
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="$PROJECT_ROOT/.claude"
DEST_DIR="$HOME/.claude"
IGNORE_FILE="$PROJECT_ROOT/.claudeignore"

# Color output helpers
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }
log_dry_run() { echo -e "${MAGENTA}[DRY-RUN]${NC} $1"; }

# Parse command line arguments
DRY_RUN=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            echo "Usage: $0 [--dry-run]"
            exit 1
            ;;
    esac
done

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

# Function to check if file is a backup file
is_backup_file() {
    local file="$1"
    # Match patterns: *.backup, *.backup.*, settings.json.backup.YYYYMMDD_HHMMSS
    if [[ "$file" == *.backup ]] || [[ "$file" == *.backup.* ]]; then
        return 0
    fi
    return 1
}

# Function to backup a file before deletion
# Args: $1 = file path
# Returns: 0 on success, 1 on failure
backup_file() {
    local file="$1"
    local backup_file="${file}.backup.$(date +%Y%m%d_%H%M%S)"

    if cp -p "$file" "$backup_file" 2>/dev/null; then
        echo "$backup_file"
        return 0
    else
        return 1
    fi
}

# Main execution
main() {
    echo ""
    log_info "Claude Config Home Cleanup"
    echo ""

    if [ "$DRY_RUN" = true ]; then
        log_dry_run "Running in DRY-RUN mode - no files will be deleted"
        echo ""
    fi

    # Check if source directory exists
    if [[ ! -d "$SOURCE_DIR" ]]; then
        log_error "Source directory $SOURCE_DIR does not exist"
        exit 1
    fi

    # Check if destination directory exists
    if [[ ! -d "$DEST_DIR" ]]; then
        log_warning "Destination directory $DEST_DIR does not exist - nothing to clean"
        exit 0
    fi

    # Step 1: Run cleanup-reminders.sh (unless dry-run)
    log_info "Step 1: Cleaning up reminders configuration"
    echo ""

    if [ "$DRY_RUN" = false ]; then
        if [ -x "$SCRIPT_DIR/cleanup-reminders.sh" ]; then
            "$SCRIPT_DIR/cleanup-reminders.sh"
            echo ""
        else
            log_error "cleanup-reminders.sh not found or not executable"
            exit 1
        fi
    else
        log_dry_run "Would run: $SCRIPT_DIR/cleanup-reminders.sh"
        echo ""
    fi

    # Step 2: Find and delete matching files
    log_info "Step 2: Finding files to delete from ~/.claude"
    echo ""

    # Build find command with ignored directory exclusions (same logic as push script)
    find_cmd="find \"$SOURCE_DIR\" -type f"

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
                    find_cmd+=" -not -path \"$SOURCE_DIR/$pattern*\" -not -path \"$SOURCE_DIR/$pattern*/*\""
                else
                    find_cmd+=" -not -path \"$SOURCE_DIR/$pattern\" -not -path \"$SOURCE_DIR/$pattern/*\""
                fi
            fi
        done < "$IGNORE_FILE"
    fi

    find_cmd+=" -print0"

    # Arrays to track operations
    deleted_files=()
    skipped_files=()
    not_found_files=()
    backup_files=()
    newer_files=()
    created_backups=()

    # Process each file in source directory
    while IFS= read -r -d '' file; do
        rel_path="${file#$SOURCE_DIR/}"

        # Skip ignored files (for individual file patterns)
        if is_ignored "$rel_path"; then
            continue
        fi

        dest_file="$DEST_DIR/$rel_path"

        # Check if file exists in destination
        if [[ ! -f "$dest_file" ]]; then
            not_found_files+=("$rel_path")
            continue
        fi

        # Skip backup files (preserve them)
        if is_backup_file "$dest_file"; then
            backup_files+=("$rel_path")
            continue
        fi

        # Skip if destination file is newer than source (user has made changes)
        if [[ "$dest_file" -nt "$file" ]]; then
            newer_files+=("$rel_path")
            if [ "$DRY_RUN" = true ]; then
                log_dry_run "Skipped (newer): $rel_path"
            else
                log_warning "Skipped (newer): $rel_path"
            fi
            continue
        fi

        # Check if file is in root ~/.claude/ directory (needs backup)
        local needs_backup=false
        if [[ "$rel_path" != */* ]]; then
            needs_backup=true
        fi

        # Delete or report
        if [ "$DRY_RUN" = true ]; then
            if [ "$needs_backup" = true ]; then
                log_dry_run "Would backup & delete: $rel_path"
            else
                log_dry_run "Would delete: $rel_path"
            fi
            deleted_files+=("$rel_path")
        else
            # Backup root-level files before deletion
            if [ "$needs_backup" = true ]; then
                backup_path=$(backup_file "$dest_file")
                if [ $? -eq 0 ]; then
                    created_backups+=("$backup_path")
                    log_info "Backed up: $rel_path → $(basename "$backup_path")"
                else
                    log_error "Failed to backup: $rel_path - skipping deletion"
                    skipped_files+=("$rel_path")
                    continue
                fi
            fi

            # Delete the file
            if rm "$dest_file" 2>/dev/null; then
                log_success "Deleted: $rel_path"
                deleted_files+=("$rel_path")
            else
                log_error "Failed to delete: $rel_path"
                skipped_files+=("$rel_path")
            fi
        fi
    done < <(eval "$find_cmd")

    # Remove empty directories (except for .claude root)
    if [ "$DRY_RUN" = false ]; then
        log_info "Removing empty directories..."
        # Find and remove empty directories (bottom-up)
        find "$DEST_DIR" -mindepth 1 -type d -empty -delete 2>/dev/null || true
    fi

    echo ""
    log_info "═══════════════════════════════════════════════════════"
    log_info "Summary Report"
    log_info "═══════════════════════════════════════════════════════"
    echo ""

    if [ "$DRY_RUN" = true ]; then
        log_dry_run "DRY-RUN MODE - No files were actually deleted"
        echo ""
    fi

    log_info "Files that would be/were deleted: ${#deleted_files[@]}"
    if [ ${#deleted_files[@]} -gt 0 ] && [ ${#deleted_files[@]} -le 20 ]; then
        for file in "${deleted_files[@]}"; do
            echo "  • $file"
        done
        echo ""
    fi

    log_info "Files not found in ~/.claude: ${#not_found_files[@]}"
    if [ ${#not_found_files[@]} -gt 0 ] && [ ${#not_found_files[@]} -le 10 ]; then
        for file in "${not_found_files[@]}"; do
            echo "  • $file"
        done
        echo ""
    fi

    if [ ${#newer_files[@]} -gt 0 ]; then
        log_warning "Files skipped (newer in ~/.claude): ${#newer_files[@]}"
        if [ ${#newer_files[@]} -le 10 ]; then
            for file in "${newer_files[@]}"; do
                echo "  • $file"
            done
        fi
        echo ""
    fi

    if [ ${#created_backups[@]} -gt 0 ]; then
        log_success "Backups created: ${#created_backups[@]}"
        for backup in "${created_backups[@]}"; do
            echo "  • $backup"
        done
        echo ""
    fi

    if [ ${#backup_files[@]} -gt 0 ]; then
        log_warning "Backup files preserved: ${#backup_files[@]}"
        for file in "${backup_files[@]}"; do
            echo "  • $file"
        done
        echo ""
    fi

    if [ ${#skipped_files[@]} -gt 0 ]; then
        log_error "Files failed to delete: ${#skipped_files[@]}"
        for file in "${skipped_files[@]}"; do
            echo "  • $file"
        done
        echo ""
    fi

    log_info "═══════════════════════════════════════════════════════"

    if [ "$DRY_RUN" = true ]; then
        echo ""
        log_info "To actually delete these files, run: $0"
    else
        echo ""
        log_success "Cleanup complete!"
        echo ""
        log_info "Your ~/.claude directory no longer contains files from this project"
        if [ ${#backup_files[@]} -gt 0 ]; then
            log_info "(except for backup files created by cleanup-reminders.sh)"
        fi
    fi

    echo ""
}

# Run main function
main
