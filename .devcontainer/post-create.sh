#!/bin/bash
set -e

echo "Setting up Sidekick development environment..."

# Source secrets if mounted (needed for non-interactive post-create context)
[ -r ~/.secrets/api-keys ] && . ~/.secrets/api-keys

# Read installation flags from environment
INSTALL_UV=${INSTALL_UV:-false}
INSTALL_CLAUDE_CODE=${INSTALL_CLAUDE_CODE:-false}
INSTALL_GEMINI_CLI=${INSTALL_GEMINI_CLI:-false}
INSTALL_CODEX_CLI=${INSTALL_CODEX_CLI:-false}
PYTHON_VERSION=${PYTHON_VERSION:-latest}

ensure_pnpm() {
  if command -v corepack >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1; then
      sudo corepack enable pnpm 2>/dev/null || true
    else
      corepack enable pnpm 2>/dev/null || true
    fi
  else
    npm install -g pnpm
  fi
}

echo "Ensuring pnpm is available..."
ensure_pnpm

# Install uv if requested
if [ "$INSTALL_UV" = "true" ]; then
  echo "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh

  # Add uv to PATH for current and future sessions
  echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.bashrc
  export PATH="$HOME/.cargo/bin:$PATH"

  # Install Python
  if [ "$PYTHON_VERSION" = "latest" ]; then
    echo "Installing latest stable Python..."
    uv python install
  else
    echo "Installing Python $PYTHON_VERSION..."
    uv python install "$PYTHON_VERSION"

    # Create symlink for system-wide access
    PYTHON_MINOR=$(echo "$PYTHON_VERSION" | cut -d. -f1,2)
    sudo ln -sf "$HOME/.local/bin/python$PYTHON_MINOR" "/usr/bin/python$PYTHON_MINOR" 2>/dev/null || true
  fi
fi

# Install Claude Code if requested
if [ "$INSTALL_CLAUDE_CODE" = "true" ]; then
  echo "Installing Claude Code..."
  curl -fsSL https://claude.ai/install.sh | bash || echo "WARNING: Claude Code installation failed"

  # Ensure claude is on PATH for future sessions
  if [ -d "$HOME/.claude/bin" ] && ! grep -q '\.claude/bin' ~/.bashrc; then
    echo 'export PATH="$HOME/.claude/bin:$PATH"' >> ~/.bashrc
  fi
  export PATH="$HOME/.claude/bin:$PATH"
fi

# Install Homebrew (needed for beads and other tools)
if ! command -v brew >/dev/null 2>&1; then
  echo "Installing Homebrew..."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  # Add brew to PATH for current and future sessions
  if [ -d "/home/linuxbrew/.linuxbrew" ]; then
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
    echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> ~/.bashrc
  fi
fi

# Clone and install agents-config (sibling to workspace)
# Note: /workspaces is owned by root, so we need sudo to clone there
WORKSPACE_PARENT="$(dirname "$PWD")"
if [ ! -d "$WORKSPACE_PARENT/agents-config" ]; then
  echo "Cloning agents-config..."
  sudo git clone https://github.com/scotthamilton77/agents-config.git "$WORKSPACE_PARENT/agents-config"
  sudo chown -R "$(id -u):$(id -g)" "$WORKSPACE_PARENT/agents-config"
fi
echo "Running agents-config install..."
bash "$WORKSPACE_PARENT/agents-config/scripts/install.sh" --yes

# Install and configure beads
if ! command -v bd >/dev/null 2>&1; then
  echo "Installing beads..."
  brew install beads
fi

# echo "Setting up beads..."
# bd setup claude
# bd setup codex

echo "Installing Claude plugins..."
claude plugin marketplace add https://github.com/anthropics/claude-plugins-official.git
claude plugin install code-review@claude-plugins-official
claude plugin install code-simplifier@claude-plugins-official
claude plugin install context7@claude-plugins-official
claude plugin install frontend-design@claude-plugins-official
claude plugin install playwright@claude-plugins-official
claude plugin install superpowers@claude-plugins-official
claude plugin install typescript-lsp@claude-plugins-official
claude plugin marketplace add steveyegge/beads
claude plugin install beads

# Install Gemini CLI if requested
if [ "$INSTALL_GEMINI_CLI" = "true" ]; then
  echo "Installing Gemini CLI..."
  npm install -g @google/gemini-cli || echo "WARNING: Gemini CLI installation failed"
fi

# Install OpenAI Codex CLI if requested
if [ "$INSTALL_CODEX_CLI" = "true" ]; then
  echo "Installing OpenAI Codex CLI..."
  npm install -g @openai/codex || echo "WARNING: Codex CLI installation failed"
fi

# Install project dependencies if package.json exists
if [ -f "package.json" ]; then
  echo "Installing project dependencies with pnpm..."
  CI=${CI:-true} pnpm install --force
fi

# Run TypeScript compiler check if tsconfig.json exists
if [ -f "tsconfig.json" ]; then
  echo "Running TypeScript compiler check..."
  pnpm exec tsc --noEmit || echo "WARNING: TypeScript errors found - fix before committing"
fi

# Make all scripts executable if scripts directory exists
if [ -d "scripts" ]; then
  echo "Making scripts executable..."
  chmod +x scripts/*.sh 2>/dev/null || true
fi

# Run project-specific setup if it exists
if [ -f ".devcontainer/project-setup.sh" ]; then
  echo "Running project-specific setup..."
  bash .devcontainer/project-setup.sh
fi

echo ""
echo "Development environment setup complete!"
echo ""
echo "Always-Installed Tools:"
echo "  - Homebrew (package manager)"
echo "  - agents-config (Claude configuration)"
echo "  - beads (AI-native issue tracking)"
echo ""
echo "Optional AI Tools:"
[ "$INSTALL_CLAUDE_CODE" = "true" ] && echo "  - Claude Code CLI"
[ "$INSTALL_GEMINI_CLI" = "true" ] && echo "  - Gemini CLI"
[ "$INSTALL_CODEX_CLI" = "true" ] && echo "  - OpenAI Codex CLI"
[ "$INSTALL_UV" = "true" ] && echo "  - uv (Python package manager)"
echo ""
