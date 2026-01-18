#!/usr/bin/env bash
# dev-mode.sh - Toggle Sidekick dev-mode hooks in .claude/settings.local.json
#
# Usage:
#   dev-mode.sh enable    # Add dev-hooks to settings.local.json
#   dev-mode.sh disable   # Remove dev-hooks from settings.local.json
#   dev-mode.sh status    # Show current state
#
# This script modifies .claude/settings.local.json to register hooks that
# point to the local workspace CLI (packages/sidekick-cli/dist/bin.js)
# via $CLAUDE_PROJECT_DIR for Docker volume mount compatibility.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEV_HOOKS_DIR="${PROJECT_ROOT}/scripts/dev-hooks"
SETTINGS_FILE="${PROJECT_ROOT}/.claude/settings.local.json"

# Hook scripts (all 7 Claude Code hooks + statusline)
HOOK_SCRIPTS=(session-start session-end user-prompt-submit pre-tool-use post-tool-use stop pre-compact statusline)

# ANSI colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_step() { echo -e "${BLUE}[STEP]${NC} $*"; }

# Check prerequisites
check_prereqs() {
  if ! command -v jq &>/dev/null; then
    log_error "jq is required but not installed"
    exit 1
  fi

  # Verify dev-hooks scripts exist
  for hook in "${HOOK_SCRIPTS[@]}"; do
    if [[ ! -f "${DEV_HOOKS_DIR}/${hook}" ]]; then
      log_error "Dev hook script missing: ${DEV_HOOKS_DIR}/${hook}"
      exit 1
    fi
  done

  # Verify CLI is built
  local cli_bin="${PROJECT_ROOT}/packages/sidekick-cli/dist/bin.js"
  if [[ ! -f "${cli_bin}" ]]; then
    log_warn "CLI not built at ${cli_bin}"
    log_warn "Run 'pnpm build' before using dev-mode hooks"
  fi
}

# Ensure .claude directory exists
ensure_claude_dir() {
  mkdir -p "${PROJECT_ROOT}/.claude"
}

# Read existing settings or create empty object
read_settings() {
  if [[ -f "${SETTINGS_FILE}" ]]; then
    cat "${SETTINGS_FILE}"
  else
    echo '{}'
  fi
}

# Backup existing settings
backup_settings() {
  if [[ -f "${SETTINGS_FILE}" ]]; then
    local backup="${SETTINGS_FILE}.backup.$(date +%Y%m%d-%H%M%S)"
    cp "${SETTINGS_FILE}" "${backup}"
    log_info "Backup created: ${backup}"
  fi
}

# Check if dev-hooks are currently enabled
is_dev_mode_enabled() {
  if [[ ! -f "${SETTINGS_FILE}" ]]; then
    return 1
  fi

  # Check if any hook contains "dev-hooks" in command path
  jq -e '.hooks | to_entries | any(.value[]?.hooks[]?.command |
    strings | contains("dev-hooks"))' "${SETTINGS_FILE}" >/dev/null 2>&1
}

# Enable dev-mode hooks
do_enable() {
  log_step "Enabling dev-mode hooks..."

  check_prereqs
  ensure_claude_dir
  backup_settings

  if is_dev_mode_enabled; then
    log_warn "Dev-mode hooks already enabled"
    return 0
  fi

  local settings
  settings=$(read_settings)

  # Use $CLAUDE_PROJECT_DIR in paths for Docker compatibility
  # The variable is expanded at runtime by Claude Code's shell
  local dev_hooks_path='$CLAUDE_PROJECT_DIR/scripts/dev-hooks'

  # Add dev-hooks using jq - merge with existing hooks
  settings=$(echo "${settings}" | jq \
    --arg session_start_cmd "${dev_hooks_path}/session-start" \
    --arg session_end_cmd "${dev_hooks_path}/session-end" \
    --arg prompt_cmd "${dev_hooks_path}/user-prompt-submit" \
    --arg pre_tool_cmd "${dev_hooks_path}/pre-tool-use" \
    --arg post_tool_cmd "${dev_hooks_path}/post-tool-use" \
    --arg stop_cmd "${dev_hooks_path}/stop" \
    --arg pre_compact_cmd "${dev_hooks_path}/pre-compact" \
    --arg statusline_cmd "${dev_hooks_path}/statusline" \
    '
    # Initialize hooks object if missing
    .hooks //= {} |

    # Add SessionStart
    .hooks.SessionStart = ((.hooks.SessionStart // []) + [{
      "hooks": [{
        "type": "command",
        "command": $session_start_cmd
      }]
    }] | unique_by(.hooks[0].command)) |

    # Add SessionEnd
    .hooks.SessionEnd = ((.hooks.SessionEnd // []) + [{
      "hooks": [{
        "type": "command",
        "command": $session_end_cmd
      }]
    }] | unique_by(.hooks[0].command)) |

    # Add UserPromptSubmit
    .hooks.UserPromptSubmit = ((.hooks.UserPromptSubmit // []) + [{
      "hooks": [{
        "type": "command",
        "command": $prompt_cmd
      }]
    }] | unique_by(.hooks[0].command)) |

    # Add PreToolUse
    .hooks.PreToolUse = ((.hooks.PreToolUse // []) + [{
      "hooks": [{
        "type": "command",
        "command": $pre_tool_cmd
      }]
    }] | unique_by(.hooks[0].command)) |

    # Add PostToolUse with wildcard matcher
    .hooks.PostToolUse = ((.hooks.PostToolUse // []) + [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": $post_tool_cmd
      }]
    }] | unique_by(.hooks[0].command)) |

    # Add Stop
    .hooks.Stop = ((.hooks.Stop // []) + [{
      "hooks": [{
        "type": "command",
        "command": $stop_cmd
      }]
    }] | unique_by(.hooks[0].command)) |

    # Add PreCompact
    .hooks.PreCompact = ((.hooks.PreCompact // []) + [{
      "hooks": [{
        "type": "command",
        "command": $pre_compact_cmd
      }]
    }] | unique_by(.hooks[0].command)) |

    # Set statusLine
    .statusLine = {
      "type": "command",
      "command": $statusline_cmd
    }
    ')

  # Write updated settings
  echo "${settings}" | jq '.' > "${SETTINGS_FILE}"

  log_info "Dev-mode hooks enabled in ${SETTINGS_FILE}"
  log_info ""
  log_info "Registered hooks:"
  log_info "  - SessionStart, SessionEnd, UserPromptSubmit"
  log_info "  - PreToolUse, PostToolUse, Stop, PreCompact"
  log_info "  - statusLine"
  log_info ""
  log_info "Next steps:"
  log_info "  1. Ensure CLI is built: pnpm build"
  log_info "  2. Restart Claude Code: claude --continue"
}

# Disable dev-mode hooks
do_disable() {
  log_step "Disabling dev-mode hooks..."

  if [[ ! -f "${SETTINGS_FILE}" ]]; then
    log_info "No settings.local.json found - nothing to disable"
    return 0
  fi

  if ! is_dev_mode_enabled; then
    log_info "Dev-mode hooks not currently enabled"
    return 0
  fi

  backup_settings

  local settings
  settings=$(cat "${SETTINGS_FILE}")

  # Remove hooks containing "dev-hooks" in command path
  settings=$(echo "${settings}" | jq '
    # Remove entries with dev-hooks from each hook type
    .hooks.SessionStart = ((.hooks.SessionStart // []) | map(select(.hooks[0].command | contains("dev-hooks") | not))) |
    .hooks.SessionEnd = ((.hooks.SessionEnd // []) | map(select(.hooks[0].command | contains("dev-hooks") | not))) |
    .hooks.UserPromptSubmit = ((.hooks.UserPromptSubmit // []) | map(select(.hooks[0].command | contains("dev-hooks") | not))) |
    .hooks.PreToolUse = ((.hooks.PreToolUse // []) | map(select(.hooks[0].command | contains("dev-hooks") | not))) |
    .hooks.PostToolUse = ((.hooks.PostToolUse // []) | map(select(.hooks[0].command | contains("dev-hooks") | not))) |
    .hooks.Stop = ((.hooks.Stop // []) | map(select(.hooks[0].command | contains("dev-hooks") | not))) |
    .hooks.PreCompact = ((.hooks.PreCompact // []) | map(select(.hooks[0].command | contains("dev-hooks") | not))) |

    # Remove statusLine if it points to dev-hooks
    if .statusLine.command then
      if (.statusLine.command | contains("dev-hooks")) then
        del(.statusLine)
      else . end
    else . end |

    # Clean up empty hook arrays
    if .hooks then
      .hooks |= with_entries(select(.value | length > 0))
    else . end |

    # Remove empty hooks object
    if (.hooks // {} | length) == 0 then
      del(.hooks)
    else . end
  ')

  # Check if settings only has empty objects left
  local has_content
  has_content=$(echo "${settings}" | jq '
    (. | keys | length) > 0 and
    (. | to_entries | any(.value |
      if type == "object" then length > 0
      elif type == "array" then length > 0
      else true
      end
    ))
  ')

  if [[ "${has_content}" == "false" ]]; then
    log_info "Settings now empty, removing ${SETTINGS_FILE}"
    rm -f "${SETTINGS_FILE}"
  else
    echo "${settings}" | jq '.' > "${SETTINGS_FILE}"
    log_info "Dev-mode hooks removed from ${SETTINGS_FILE}"
  fi

  log_info ""
  log_info "Dev-mode disabled. Restart Claude Code to apply changes."
}

# Show current status
do_status() {
  echo "Dev-Mode Status"
  echo "==============="
  echo ""

  if [[ ! -f "${SETTINGS_FILE}" ]]; then
    echo "Settings file: ${SETTINGS_FILE} (not found)"
    echo "Dev-mode: DISABLED"
  else
    echo "Settings file: ${SETTINGS_FILE}"

    if is_dev_mode_enabled; then
      echo -e "Dev-mode: ${GREEN}ENABLED${NC}"
      echo ""
      echo "Registered dev-hooks:"
      jq -r '.hooks | to_entries[] |
        select(.value[]?.hooks[]?.command | strings | contains("dev-hooks")) |
        "  - \(.key): \(.value[0].hooks[0].command)"' "${SETTINGS_FILE}" 2>/dev/null || true

      # Check statusLine
      if jq -e '.statusLine.command | strings | contains("dev-hooks")' "${SETTINGS_FILE}" >/dev/null 2>&1; then
        local statusline_cmd
        statusline_cmd=$(jq -r '.statusLine.command' "${SETTINGS_FILE}")
        echo "  - statusLine: ${statusline_cmd}"
      fi
    else
      echo -e "Dev-mode: ${YELLOW}DISABLED${NC}"
    fi
  fi

  echo ""

  # CLI build status
  local cli_bin="${PROJECT_ROOT}/packages/sidekick-cli/dist/bin.js"
  if [[ -f "${cli_bin}" ]]; then
    echo -e "CLI build: ${GREEN}OK${NC} (${cli_bin})"
  else
    echo -e "CLI build: ${RED}MISSING${NC} - run 'pnpm build'"
  fi

  echo ""
  echo "Hook scripts in ${DEV_HOOKS_DIR}:"
  for hook in "${HOOK_SCRIPTS[@]}"; do
    if [[ -x "${DEV_HOOKS_DIR}/${hook}" ]]; then
      echo -e "  ${GREEN}+${NC} ${hook}"
    else
      echo -e "  ${RED}-${NC} ${hook} (missing or not executable)"
    fi
  done
}

# Clean up logs, kill daemon, check for zombies
do_clean() {
  log_step "Cleaning up sidekick state..."

  local sidekick_dir="${PROJECT_ROOT}/.sidekick"
  local logs_dir="${sidekick_dir}/logs"
  local state_dir="${sidekick_dir}/state"
  local pid_file="${sidekick_dir}/sidekickd.pid"
  local token_file="${sidekick_dir}/sidekickd.token"
  local lock_file="${sidekick_dir}/sidekickd.lock"
  # Socket is in /tmp (or XDG_RUNTIME_DIR on Linux) with project hash
  local project_hash
  project_hash=$(echo -n "${PROJECT_ROOT}" | shasum -a 256 | cut -c1-16)
  local socket_file="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/sidekick-${project_hash}.sock"
  local user_daemons_dir="${HOME}/.sidekick/daemons"

  # 1. Kill project-local daemon if running
  if [[ -f "${pid_file}" ]]; then
    local pid
    pid=$(cat "${pid_file}" 2>/dev/null || echo "")
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      log_info "Killing project daemon (PID ${pid})..."
      kill "${pid}" 2>/dev/null || true
      sleep 0.5
      # Force kill if still alive
      if kill -0 "${pid}" 2>/dev/null; then
        log_warn "Daemon didn't stop gracefully, sending SIGKILL..."
        kill -9 "${pid}" 2>/dev/null || true
      fi
      log_info "Daemon killed"
    else
      log_info "No running daemon found for this project"
    fi
    rm -f "${pid_file}"
  else
    log_info "No daemon PID file found"
  fi

  # Clean up daemon files (socket, token, lock)
  rm -f "${socket_file}" "${token_file}" "${lock_file}" 2>/dev/null || true

  # 2. Truncate or delete log files
  if [[ -d "${logs_dir}" ]]; then
    log_info "Cleaning log files in ${logs_dir}..."
    for log_file in "${logs_dir}"/*.log; do
      if [[ -f "${log_file}" ]]; then
        local filename
        filename=$(basename "${log_file}")
        : > "${log_file}"  # Truncate
        log_info "  Truncated: ${filename}"
      fi
    done
  else
    log_info "No logs directory found"
  fi

  # 3. Clean project state folder
  if [[ -d "${state_dir}" ]]; then
    local project_state_files
    project_state_files=$(find "${state_dir}" -type f 2>/dev/null | wc -l | tr -d ' ')
    if [[ "${project_state_files}" -gt 0 ]]; then
      log_info "Cleaning project state folder (${project_state_files} files)..."
      rm -rf "${state_dir:?}"/*
      log_info "Project state cleaned"
    else
      log_info "Project state folder is empty"
    fi
  else
    log_info "No project state folder found"
  fi

  # 4. Clean global state folder
  local global_state_dir="${HOME}/.sidekick/state"
  if [[ -d "${global_state_dir}" ]]; then
    local global_state_files
    global_state_files=$(find "${global_state_dir}" -type f 2>/dev/null | wc -l | tr -d ' ')
    if [[ "${global_state_files}" -gt 0 ]]; then
      log_info "Cleaning global state folder (${global_state_files} files)..."
      rm -rf "${global_state_dir:?}"/*
      log_info "Global state cleaned"
    else
      log_info "Global state folder is empty"
    fi
  else
    log_info "No global state folder found"
  fi

  # 5. Check for zombie daemon processes
  echo ""
  log_step "Checking for zombie daemon processes..."

  local zombies=()
  local zombie_info=()

  # Method 1: Check user-level PID files
  if [[ -d "${user_daemons_dir}" ]]; then
    for pid_file in "${user_daemons_dir}"/*.pid; do
      [[ -f "${pid_file}" ]] || continue

      # Parse JSON pid file
      local pid project_dir
      pid=$(jq -r '.pid // empty' "${pid_file}" 2>/dev/null || echo "")
      project_dir=$(jq -r '.projectDir // empty' "${pid_file}" 2>/dev/null || echo "")

      if [[ -n "${pid}" ]] && [[ "${project_dir}" != "${PROJECT_ROOT}" ]]; then
        if kill -0 "${pid}" 2>/dev/null; then
          zombies+=("${pid}")
          zombie_info+=("PID ${pid}: ${project_dir}")
        else
          # Stale PID file, clean it up
          rm -f "${pid_file}" 2>/dev/null || true
        fi
      fi
    done
  fi

  # Method 2: Find any sidekickd processes via pgrep
  local pgrep_pids
  pgrep_pids=$(pgrep -f "sidekickd" 2>/dev/null || true)
  if [[ -n "${pgrep_pids}" ]]; then
    while IFS= read -r pid; do
      # Skip if already in our list
      local already_found=false
      for z in "${zombies[@]:-}"; do
        if [[ "${z}" == "${pid}" ]]; then
          already_found=true
          break
        fi
      done

      if [[ "${already_found}" == "false" ]]; then
        # Get command line to identify the project
        local cmdline
        cmdline=$(ps -p "${pid}" -o args= 2>/dev/null || echo "unknown")
        zombies+=("${pid}")
        zombie_info+=("PID ${pid}: ${cmdline}")
      fi
    done <<< "${pgrep_pids}"
  fi

  if [[ ${#zombies[@]} -eq 0 ]]; then
    log_info "No zombie daemon processes found"
  else
    echo ""
    echo -e "${YELLOW}Found ${#zombies[@]} potential zombie daemon process(es):${NC}"
    for info in "${zombie_info[@]}"; do
      echo "  - ${info}"
    done
    echo ""

    read -r -p "Kill these processes? [y/N] " response
    case "${response}" in
      [yY][eE][sS]|[yY])
        for pid in "${zombies[@]}"; do
          log_info "Killing PID ${pid}..."
          kill "${pid}" 2>/dev/null || true
          sleep 0.3
          if kill -0 "${pid}" 2>/dev/null; then
            kill -9 "${pid}" 2>/dev/null || true
          fi
        done
        log_info "Zombie processes killed"

        # Clean up user-level PID files
        if [[ -d "${user_daemons_dir}" ]]; then
          rm -f "${user_daemons_dir}"/*.pid 2>/dev/null || true
        fi
        ;;
      *)
        log_info "Skipping zombie cleanup"
        ;;
    esac
  fi

  echo ""
  log_info "Clean complete. Restart Claude Code with: claude --continue"
}

# Clean all sidekick state including session directories
do_clean_all() {
  # First run the standard clean
  do_clean

  local sidekick_dir="${PROJECT_ROOT}/.sidekick"
  local logs_dir="${sidekick_dir}/logs"
  local sessions_dir="${sidekick_dir}/sessions"
  local state_dir="${sidekick_dir}/state"

  echo ""
  log_step "Removing logs, sessions, and state directories..."

  # Delete logs directory
  if [[ -d "${logs_dir}" ]]; then
    rm -rf "${logs_dir:?}"
    log_info "Removed ${logs_dir}"
  else
    log_info "No logs directory found"
  fi

  # Delete sessions directory (with confirmation)
  if [[ -d "${sessions_dir}" ]]; then
    local session_count
    session_count=$(find "${sessions_dir}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')

    if [[ "${session_count}" -gt 0 ]]; then
      local sessions_size
      sessions_size=$(du -sh "${sessions_dir}" 2>/dev/null | cut -f1)
      log_info "Found ${session_count} session directories (${sessions_size})"

      read -r -p "Remove all session directories? [y/N] " response
      case "${response}" in
        [yY][eE][sS]|[yY])
          rm -rf "${sessions_dir:?}"
          log_info "Removed ${sessions_dir}"
          ;;
        *)
          log_info "Skipping session cleanup"
          ;;
      esac
    else
      rm -rf "${sessions_dir:?}"
      log_info "Removed empty ${sessions_dir}"
    fi
  else
    log_info "No sessions directory found"
  fi

  # Delete state directory
  if [[ -d "${state_dir}" ]]; then
    rm -rf "${state_dir:?}"
    log_info "Removed ${state_dir}"
  else
    log_info "No state directory found"
  fi

  # Clean /tmp sidekick sockets (stale sockets from crashed sessions)
  local tmp_sockets
  tmp_sockets=$(find /tmp -maxdepth 1 -name "sidekick-*.sock" -user "$(whoami)" 2>/dev/null || true)
  if [[ -n "${tmp_sockets}" ]]; then
    local socket_count
    socket_count=$(echo "${tmp_sockets}" | wc -l | tr -d ' ')
    log_info "Found ${socket_count} stale socket(s) in /tmp"
    echo "${tmp_sockets}" | xargs rm -f 2>/dev/null || true
    log_info "Stale sockets removed"
  fi

  echo ""
  log_info "Full clean complete. Restart Claude Code with: claude --continue"
}

# Show help
show_help() {
  cat <<EOF
Sidekick Dev-Mode Manager

Usage:
  dev-mode.sh <command>

Commands:
  enable     Add dev-hooks to .claude/settings.local.json
  disable    Remove dev-hooks from .claude/settings.local.json
  status     Show current dev-mode state
  clean      Truncate logs, kill daemon, clean state folders, check for zombies
  clean-all  Full cleanup: clean + remove logs/sessions/state dirs + stale sockets

The dev-mode hooks use \$CLAUDE_PROJECT_DIR paths for Docker compatibility.
They point to scripts/dev-hooks/ which call the workspace CLI at:
  packages/sidekick-cli/dist/bin.js

Registered hooks (all 7 Claude Code hooks):
  SessionStart, SessionEnd, UserPromptSubmit,
  PreToolUse, PostToolUse, Stop, PreCompact
  + statusLine

Note: After enabling/disabling, restart Claude Code with:
  claude --continue

EOF
}

# Main
main() {
  case "${1:-}" in
    enable)
      do_enable
      ;;
    disable)
      do_disable
      ;;
    status)
      do_status
      ;;
    clean)
      do_clean
      ;;
    clean-all)
      do_clean_all
      ;;
    -h|--help|help)
      show_help
      ;;
    *)
      log_error "Unknown command: ${1:-}"
      show_help
      exit 1
      ;;
  esac
}

main "$@"
