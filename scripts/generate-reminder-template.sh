#!/bin/bash
#
# generate-reminder-template.sh - Generate reminder templates from CLAUDE.md files
#
# Usage:
#   ./scripts/generate-reminder-template.sh --user [--type TYPE] [--model MODEL] [--dry-run]
#   ./scripts/generate-reminder-template.sh --project [--type TYPE] [--model MODEL] [--dry-run]
#   ./scripts/generate-reminder-template.sh --both [--type TYPE] [--model MODEL] [--dry-run]
#
# Options:
#   --user          Generate user-scope reminder from ~/.claude/CLAUDE.md
#   --project       Generate project-scope reminder from both CLAUDE.md files
#   --both          Generate both user and project reminders
#   --type TYPE     Reminder type (default: user-prompt-submit)
#                   Options: user-prompt-submit | post-tool-use-cadence | post-tool-use-stuck | stop
#   --model MODEL   Override default model (default: haiku)
#   --dry-run       Output to console only, do not write files
#
# Description:
#   Uses Claude CLI to analyze CLAUDE.md files and extract the most important
#   rules and guidelines into a concise reminder template.
#
#   User scope:   Reads ~/.claude/CLAUDE.md
#                 Writes to ~/.sidekick/reminders/{type}-reminder.txt.template
#
#   Project scope: Reads ~/.claude/CLAUDE.md AND project CLAUDE.md
#                  Writes to ${PROJECT_ROOT}/.sidekick/reminders/{type}-reminder.txt.template

set -euo pipefail

# Script directory and project root
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Default configuration
DEFAULT_MODEL="haiku"
DEFAULT_TYPE="user-prompt-submit"
DEFAULT_MAX_WORDS=150
DEFAULT_MAX_CHARS=1000

# Valid reminder types
VALID_TYPES=("user-prompt-submit" "post-tool-use-cadence" "post-tool-use-stuck" "stop")

# Command line options
SCOPE=""
TYPE="${DEFAULT_TYPE}"
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

Generate reminder templates from CLAUDE.md files using Claude CLI.

Options:
  --user               Generate user-scope reminder from ~/.claude/CLAUDE.md
  --project            Generate project-scope reminder from both CLAUDE.md files
  --both               Generate both user and project reminders
  --type TYPE          Reminder type (default: ${DEFAULT_TYPE})
                       Options: user-prompt-submit | post-tool-use-cadence | post-tool-use-stuck | stop
  --model MODEL        Claude model to use (default: ${DEFAULT_MODEL})
                       Options: haiku, sonnet, opus
  --max-words NUM      Suggested maximum word count for reminder (default: ${DEFAULT_MAX_WORDS})
  --max-chars NUM      Suggested maximum character count for reminder (default: ${DEFAULT_MAX_CHARS})
  --dry-run            Output to console only, do not write files
  -h, --help           Show this help message

Reminder Types:
  user-prompt-submit      Input processing phase (verify user, parallelize, ask clarification)
  post-tool-use-cadence   Execution quality (tool choice, minimal edits, TodoWrite)
  post-tool-use-stuck     Stuck detection (repeated failures, no progress)
  stop                    Completion verification (tests, commits, security)

Examples:
  # Preview user-scope user-prompt-submit reminder without writing file
  $(basename "$0") --user --type user-prompt-submit --dry-run

  # Generate project-scope stop reminder with Sonnet
  $(basename "$0") --project --type stop --model sonnet

  # Generate both scopes for post-tool-use-cadence with custom limits
  $(basename "$0") --both --type post-tool-use-cadence --max-words 200 --max-chars 1500

Output Locations:
  User scope:    ~/.sidekick/reminders/{type}-reminder.txt.template
  Project scope: .sidekick/reminders/{type}-reminder.txt.template
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
            --type)
                [[ $# -lt 2 ]] && die "--type requires an argument"
                TYPE="$2"
                # Validate type
                local valid=false
                for valid_type in "${VALID_TYPES[@]}"; do
                    if [[ "${TYPE}" == "${valid_type}" ]]; then
                        valid=true
                        break
                    fi
                done
                if [[ "${valid}" != "true" ]]; then
                    die "Invalid type: ${TYPE}. Must be one of: ${VALID_TYPES[*]}"
                fi
                shift 2
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
# Get type-specific context for LLM prompt
# Arguments:
#   $1 - Reminder type
# Outputs:
#   Context description for the specified type
#######################################
get_type_context() {
    local type="$1"

    case "${type}" in
        user-prompt-submit)
            cat <<'EOF'
HOOK CONTEXT: UserPromptSubmit (Input Processing Phase)
This reminder fires when the user submits a new prompt/request. The AI is about to process and plan their response.

DECISION MOMENT: The AI is deciding:
- How to interpret the user's request
- Whether to trust user's assumptions or verify first
- Whether to ask clarifying questions or make assumptions
- How to parallelize initial exploration (reading files, searching code)
- What security/architecture risks exist in the request

FOCUS AREAS FOR THIS REMINDER:
1. Verify user assumptions before agreeing (confident users can be wrong)
2. Parallelize initial file reads and searches (one message, multiple tool calls)
3. Ask clarifying questions when uncertain (don't guess)
4. Identify security/architecture red flags in the request
5. Challenge user direction if it violates Laws 0-1 (codebase integrity, security)

AVOID: Execution details (tool choice, editing), completion verification (tests, commits)
EOF
            ;;
        post-tool-use-cadence)
            cat <<'EOF'
HOOK CONTEXT: PostToolUse - Cadence (Execution Quality Check)
This reminder fires periodically during tool execution (every N tools). The AI is in the middle of implementing a solution.

DECISION MOMENT: The AI is deciding:
- Which tools to use for the next operation
- Whether to create new files or edit existing ones
- How to parallelize operations (sequential vs. parallel tool calls)
- How much code to modify (minimal edits vs. "while I'm here" improvements)
- Whether to track tasks in TodoWrite

FOCUS AREAS FOR THIS REMINDER:
1. Use specialized tools (Read/Edit/Write) instead of Bash for file operations
2. Parallelize independent operations (one message, N tool calls)
3. Prefer editing existing files over creating new ones
4. Minimal edits only - no scope creep or tangential improvements
5. Use TodoWrite for multi-step tasks (mark in_progress before starting, completed immediately when done)

AVOID: Input validation (user prompts), completion verification (tests, commits), stuck detection
EOF
            ;;
        post-tool-use-stuck)
            cat <<'EOF'
HOOK CONTEXT: PostToolUse - Stuck Detection (High Tool Count Alert)
This reminder fires when the AI uses many tools in a single response (threshold exceeded). The AI may be stuck in a loop.

DECISION MOMENT: The AI is deciding:
- Whether to continue the current approach or try something different
- Whether they're making actual progress or repeating failed attempts
- Whether to ask the user for help or keep trying
- Whether to simplify the approach or add more complexity

FOCUS AREAS FOR THIS REMINDER:
1. Recognize when repeating the same failed approach (stop the loop)
2. Step back and try a fundamentally different strategy
3. Ask the user for clarification or guidance when stuck
4. Simplify the approach - complex solutions often indicate wrong path
5. Review what's already been tried and explicitly avoid repeating it

AVOID: General execution advice, input processing, completion verification
EOF
            ;;
        stop)
            cat <<'EOF'
HOOK CONTEXT: Stop (Completion Verification)
This reminder fires when the conversation is stopping/completing. The AI is about to claim work is finished.

DECISION MOMENT: The AI is deciding:
- Whether the work is truly complete or just partially done
- Whether to verify with tests/builds or trust their changes
- Whether to commit changes or wait for user approval
- Whether all acceptance criteria have been met

FOCUS AREAS FOR THIS REMINDER:
1. Run verification commands (lint, type-check, tests, build) - evidence required, not claims
2. NO auto-commits - user must explicitly request "commit" even after multiple features
3. Confirm all TodoWrite items are completed (no forgotten requirements)
4. Verify minimal edits (no scope creep in final diff)
5. Security check (XSS, SQL injection, command injection, insecure defaults)
6. Acceptance criteria - re-read original request, fully addressed or partial?
7. Documentation - if user requested docs/README/comments, verify included

AVOID: Input processing decisions, execution tool choices, stuck detection
EOF
            ;;
        *)
            die "Unknown reminder type: ${type}"
            ;;
    esac
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
#   $3 - Reminder type
# Outputs:
#   Generated reminder text
#######################################
call_claude_cli() {
    local content="$1"
    local model="$2"
    local type="$3"

    # Get type-specific context
    local type_context
    type_context=$(get_type_context "${type}")

    local prompt="You are analyzing CLAUDE.md instruction files for an AI coding assistant. Your task is to extract and synthesize the MOST IMPORTANT and HIGH-IMPACT rules into a reminder that will interrupt
bad decisions at the moment they're about to happen.

INPUT CLAUDE.MD CONTENT:
${content}

${type_context}

CORE OBJECTIVE:
Generate reminders that trigger BEFORE mistakes happen, not after. Each reminder should answer: \"What decision point will the AI face where they might ignore this rule?\"

TASK:
Generate a concise turn-cadence reminder (~${MAX_WORDS} words max, ~${MAX_CHARS} characters max) that captures:
1. Critical behavioral rules (Laws, non-negotiables) → framed as decision triggers
2. High-impact workflow requirements (testing, commits, verification) → with failure costs
3. Key quality standards (architecture, security, maintainability) → with anti-patterns
4. Important interaction patterns (when to ask questions, how to respond) → with scenarios

STRUCTURE EACH REMINDER AS:
[TRIGGER/SCENARIO] → [ACTION] → [CONSEQUENCE/WHY]

GOOD EXAMPLES:
✓ \"USER CONFIDENT ≠ CORRECT: Verify before agreeing. Wrong paths waste 10+ turns (Law 1).\"
✓ \"PARALLELIZE NOW: Read 5 files? One message, 5 Read calls. Token efficiency compounds.\"
✓ \"FINISHED FEATURE? Don't commit. Wait for explicit 'commit' request.\"

BAD EXAMPLES (too abstract):
✗ \"Follow the Four Laws hierarchy\" (no trigger, no action)
✗ \"Maintain code quality\" (vague, no scenario)
✗ \"Be careful with commits\" (passive, no specifics)

FORMATTING PRINCIPLES:
- Start with trigger words: WHEN, BEFORE, ABOUT TO, IF, FINISHED, TEMPTED TO
- Use action verbs: VERIFY, PARALLELIZE, STOP, WAIT, CHECK, ASK, CHALLENGE
- Include consequences: \"waste 10+ turns\", \"compounds\", \"breaks build\", \"security risk\"
- Add concrete examples: \"Read 5 files? One message\" not \"use parallelization\"
- Use symbols for impact: → for flow, = for equivalence, ≠ for contradiction

PRIORITIZATION (rank these patterns from CLAUDE.md):
1. Rules the AI commonly violates despite being told (e.g., auto-committing, sequential tool calls)
2. Rules with high cost of violation (e.g., security issues, architecture breaks)
3. Rules that conflict with AI training (e.g., \"challenge confident users\" vs. \"be helpful\")
4. Rules about workflow automation (e.g., when to use TodoWrite, how to parallelize)
5. Rules about scope control (e.g., minimal edits, no tangential improvements)

EXTRACTION STRATEGY:
1. Scan for words like \"MUST\", \"NEVER\", \"ALWAYS\", \"CRITICAL\", \"IMPORTANT\" in CLAUDE.md
2. Look for specific examples or scenarios already in the content
3. Identify anti-patterns mentioned (what NOT to do)
4. Find rules with explicit consequences or rationale
5. Notice patterns in multiple sections (signals importance)

REQUIREMENTS:
- Use unformatted, plain text - not markdown
- Use numbered lists (1-5 items) or \"TOP N\" format
- Each item: one sentence max, two if complex
- Imperative voice (\"Verify X before Y\", not \"X should be verified\")
- Front-load the trigger/scenario (most important words first)
- Avoid redundancy with built-in Claude Code behavior
- Include at least one concrete example per reminder when possible

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
        output_file="${output_dir}/${TYPE}-reminder.txt.template"
    else
        output_dir="${PROJECT_ROOT}/.sidekick/reminders"
        output_file="${output_dir}/${TYPE}-reminder.txt.template"
    fi

    print_msg "${BLUE}" "Generating ${scope}-scope ${TYPE} reminder..."

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
    print_msg "${BLUE}" "  Calling Claude (${MODEL}) to generate ${TYPE} reminder..."
    local reminder
    if ! reminder=$(call_claude_cli "${combined_content}" "${MODEL}" "${TYPE}"); then
        die "Failed to generate ${TYPE} reminder for ${scope} scope"
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

    print_msg "${BLUE}" "=== Reminder Template Generator ==="
    print_msg "${BLUE}" "Type: ${TYPE}"
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
