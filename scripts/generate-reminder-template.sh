#!/bin/bash
#
# generate-reminder-template.sh - Generate turn-cadence reminder templates from CLAUDE.md files
#
# Usage:
#   ./scripts/generate-reminder-template.sh --user [--model MODEL] [--dry-run]
#   ./scripts/generate-reminder-template.sh --project [--model MODEL] [--dry-run]
#   ./scripts/generate-reminder-template.sh --both [--model MODEL] [--dry-run]
#
# Options:
#   --user          Generate user-scope reminder from ~/.claude/CLAUDE.md
#   --project       Generate project-scope reminder from both CLAUDE.md files
#   --both          Generate both user and project reminders
#   --model MODEL   Override default model (default: haiku)
#   --dry-run       Output to console only, do not write files
#
# Description:
#   Uses Claude CLI to analyze CLAUDE.md files and extract the most important
#   rules and guidelines into a concise turn-cadence reminder template.
#
#   User scope:   Reads ~/.claude/CLAUDE.md
#                 Writes to ~/.sidekick/reminders/turn-cadence-reminder.txt.template
#
#   Project scope: Reads ~/.claude/CLAUDE.md AND project CLAUDE.md
#                  Writes to ${PROJECT_ROOT}/.sidekick/reminders/turn-cadence-reminder.txt.template

set -euo pipefail

# Script directory and project root
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Default configuration
DEFAULT_MODEL="haiku"
DEFAULT_MAX_WORDS=150
DEFAULT_MAX_CHARS=1000

# Command line options
SCOPE=""
MODEL="${DEFAULT_MODEL}"
DRY_RUN=false
MAX_WORDS="${DEFAULT_MAX_WORDS}"
MAX_CHARS="${DEFAULT_MAX_CHARS}"

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

#######################################
# Print colored message to stderr
# Arguments:
#   $1 - Color code
#   $2 - Message
#######################################
print_msg() {
    local color="$1"
    shift
    echo -e "${color}$*${NC}" >&2
}

#######################################
# Print error message and exit
# Arguments:
#   $* - Error message
#######################################
die() {
    print_msg "${RED}" "ERROR: $*"
    exit 1
}

#######################################
# Print usage information
#######################################
usage() {
    cat >&2 <<EOF
Usage: $(basename "$0") [--user | --project | --both] [OPTIONS]

Generate turn-cadence reminder templates from CLAUDE.md files using Claude CLI.

Options:
  --user               Generate user-scope reminder from ~/.claude/CLAUDE.md
  --project            Generate project-scope reminder from both CLAUDE.md files
  --both               Generate both user and project reminders
  --model MODEL        Claude model to use (default: ${DEFAULT_MODEL})
                       Options: haiku, sonnet, opus
  --max-words NUM      Suggested maximum word count for reminder (default: ${DEFAULT_MAX_WORDS})
  --max-chars NUM      Suggested maximum character count for reminder (default: ${DEFAULT_MAX_CHARS})
  --dry-run            Output to console only, do not write files
  -h, --help           Show this help message

Examples:
  # Preview user-scope reminder without writing file
  $(basename "$0") --user --dry-run

  # Generate project-scope reminder with Sonnet and custom limits
  $(basename "$0") --project --model sonnet --max-words 200 --max-chars 1500

  # Generate both with default model (haiku)
  $(basename "$0") --both

Output Locations:
  User scope:    ~/.sidekick/reminders/turn-cadence-reminder.txt.template
  Project scope: .sidekick/reminders/turn-cadence-reminder.txt.template
EOF
    exit 1
}

#######################################
# Parse command line arguments
# Arguments:
#   $@ - Command line arguments
#######################################
parse_args() {
    if [[ $# -eq 0 ]]; then
        usage
    fi

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --user)
                [[ -n "${SCOPE}" ]] && die "Cannot specify multiple scope options"
                SCOPE="user"
                shift
                ;;
            --project)
                [[ -n "${SCOPE}" ]] && die "Cannot specify multiple scope options"
                SCOPE="project"
                shift
                ;;
            --both)
                [[ -n "${SCOPE}" ]] && die "Cannot specify multiple scope options"
                SCOPE="both"
                shift
                ;;
            --model)
                [[ $# -lt 2 ]] && die "--model requires an argument"
                MODEL="$2"
                shift 2
                ;;
            --max-words)
                [[ $# -lt 2 ]] && die "--max-words requires an argument"
                MAX_WORDS="$2"
                [[ ! "${MAX_WORDS}" =~ ^[0-9]+$ ]] && die "--max-words must be a positive integer"
                shift 2
                ;;
            --max-chars)
                [[ $# -lt 2 ]] && die "--max-chars requires an argument"
                MAX_CHARS="$2"
                [[ ! "${MAX_CHARS}" =~ ^[0-9]+$ ]] && die "--max-chars must be a positive integer"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            -h|--help)
                usage
                ;;
            *)
                die "Unknown option: $1"
                ;;
        esac
    done

    [[ -z "${SCOPE}" ]] && die "Must specify --user, --project, or --both"
    return 0
}

#######################################
# Validate prerequisites
#######################################
validate_prerequisites() {
    # Check for Claude CLI in multiple locations (matching sidekick pattern)
    local claude_bin=""

    # 1. Check ~/.claude/local/claude (default installation)
    if [[ -x "${HOME}/.claude/local/claude" ]]; then
        claude_bin="${HOME}/.claude/local/claude"
    fi

    # 2. Check PATH using command -v
    if [[ -z "${claude_bin}" ]]; then
        claude_bin=$(command -v claude 2>/dev/null || true)
    fi

    # Validate we found an executable
    if [[ -z "${claude_bin}" ]] || [[ ! -x "${claude_bin}" ]]; then
        die "Claude CLI not found. Checked: ~/.claude/local/claude, PATH
Install from: https://claude.ai/download"
    fi
}

#######################################
# Read CLAUDE.md file with error handling
# Arguments:
#   $1 - File path
# Outputs:
#   File contents or empty string if not found
#######################################
read_claude_md() {
    local file_path="$1"

    if [[ -f "${file_path}" ]]; then
        cat "${file_path}"
    else
        echo ""
    fi
}

#######################################
# Call Claude CLI to generate reminder
# Arguments:
#   $1 - Combined CLAUDE.md content
#   $2 - Model name
# Outputs:
#   Generated reminder text
#######################################
call_claude_cli() {
    local content="$1"
    local model="$2"

    local prompt="You are analyzing CLAUDE.md instruction files for an AI coding assistant. Your task is to extract and synthesize the MOST IMPORTANT and HIGH-IMPACT rules, guidelines, and principles that should be periodically reinforced during conversations.

INPUT CLAUDE.MD CONTENT:
${content}

TASK:
Generate a concise turn-cadence reminder (~${MAX_WORDS} words max, ~${MAX_CHARS} characters max) that captures:
1. Critical behavioral rules (Laws, non-negotiables)
2. High-impact workflow requirements (testing, commits, verification)
3. Key quality standards (architecture, security, maintainability)
4. Important interaction patterns (when to ask questions, how to respond)

REQUIREMENTS:
- Use unformatted, plain text - not markdown
- Use bullet points or numbered lists for clarity
- Prioritize rules that are frequently forgotten or violated
- Focus on actionable guidance, not background information
- Be concise but comprehensive
- Use imperative voice (\"Verify X before Y\", not \"X should be verified\")
- Avoid redundancy with built-in Claude Code behavior

OUTPUT FORMAT:
Return ONLY the reminder text, no preamble or explanation."

    # Call Claude CLI with the model and prompt
    local reminder
    if ! reminder=$(echo "${prompt}" | claude --model "${model}" 2>&1); then
        print_msg "${RED}" "Claude CLI failed"
        print_msg "${RED}" "Output: ${reminder}"
        return 1
    fi

    echo "${reminder}"
}

#######################################
# Generate reminder for a specific scope
# Arguments:
#   $1 - Scope ("user" or "project")
#######################################
generate_reminder() {
    local scope="$1"
    local user_claude_md="${HOME}/.claude/CLAUDE.md"
    local project_claude_md="${PROJECT_ROOT}/CLAUDE.md"
    local output_dir
    local output_file

    # Determine output location
    if [[ "${scope}" == "user" ]]; then
        output_dir="${HOME}/.sidekick/reminders"
        output_file="${output_dir}/turn-cadence-reminder.txt.template"
    else
        output_dir="${PROJECT_ROOT}/.sidekick/reminders"
        output_file="${output_dir}/turn-cadence-reminder.txt.template"
    fi

    print_msg "${BLUE}" "Generating ${scope}-scope reminder..."

    # Read CLAUDE.md file(s)
    local combined_content=""

    if [[ "${scope}" == "user" ]]; then
        print_msg "${BLUE}" "  Reading ${user_claude_md}..."
        combined_content=$(read_claude_md "${user_claude_md}")

        if [[ -z "${combined_content}" ]]; then
            print_msg "${YELLOW}" "  Warning: ${user_claude_md} not found or empty"
            return 0
        fi
    else
        # Project scope reads both files
        print_msg "${BLUE}" "  Reading ${user_claude_md}..."
        local user_content
        user_content=$(read_claude_md "${user_claude_md}")

        print_msg "${BLUE}" "  Reading ${project_claude_md}..."
        local project_content
        project_content=$(read_claude_md "${project_claude_md}")

        if [[ -z "${user_content}" && -z "${project_content}" ]]; then
            print_msg "${YELLOW}" "  Warning: No CLAUDE.md files found"
            return 0
        fi

        # Combine with clear separation
        combined_content="<USER-WIDE-CLAUDE.MD>
${user_content}
</USER-WIDE-CLAUDE.MD>

<PROJECT-CLAUDE.MD>
${project_content}
</PROJECT-CLAUDE.MD>"
    fi

    # Call Claude CLI to generate reminder
    print_msg "${BLUE}" "  Calling Claude (${MODEL}) to generate reminder..."
    local reminder
    if ! reminder=$(call_claude_cli "${combined_content}" "${MODEL}"); then
        die "Failed to generate reminder for ${scope} scope"
    fi

    if [[ -z "${reminder}" ]]; then
        die "Claude returned empty reminder for ${scope} scope"
    fi

    # Generate the template content
    local template_content
    template_content=$(cat <<EOF
${reminder}
EOF
)

    if [[ "${DRY_RUN}" == "true" ]]; then
        # Dry-run mode: output to console
        print_msg "${YELLOW}" "  [DRY-RUN] Would write to: ${output_file}"
        echo >&2
        print_msg "${BLUE}" "=== Generated Content (${scope}-scope) ==="
        echo "${template_content}"
        echo >&2
    else
        # Normal mode: write to file
        mkdir -p "${output_dir}"
        echo "${template_content}" > "${output_file}"

        print_msg "${GREEN}" "✓ Generated: ${output_file}"
        print_msg "${BLUE}" "  Preview (first 10 lines):"
        head -n 10 "${output_file}" | sed 's/^/    /' >&2
        echo >&2
    fi
}

#######################################
# Main function
#######################################
main() {
    parse_args "$@"
    validate_prerequisites

    print_msg "${BLUE}" "=== Turn-Cadence Reminder Template Generator ==="
    print_msg "${BLUE}" "Model: ${MODEL}"
    print_msg "${BLUE}" "Scope: ${SCOPE}"
    if [[ "${DRY_RUN}" == "true" ]]; then
        print_msg "${YELLOW}" "Mode: DRY-RUN (no files will be written)"
    fi
    echo >&2

    case "${SCOPE}" in
        user)
            generate_reminder "user"
            ;;
        project)
            generate_reminder "project"
            ;;
        both)
            generate_reminder "user"
            generate_reminder "project"
            ;;
    esac

    print_msg "${GREEN}" "=== Done ==="
}

main "$@"
