#!/bin/bash
set -e

echo "🔧 Setting up AI Stack development environment..."

# Read installation flags from environment
# Note: install.sh bakes these into devcontainer.json, so defaults shouldn't be needed
# Conservative fallbacks provided for manual devcontainer builds
INSTALL_UV=${INSTALL_UV:-false}
INSTALL_CLAUDE_CODE=${INSTALL_CLAUDE_CODE:-false}
INSTALL_GEMINI_CLI=${INSTALL_GEMINI_CLI:-false}
INSTALL_CODEX_CLI=${INSTALL_CODEX_CLI:-false}
INSTALL_SPECIFY_CLI=${INSTALL_SPECIFY_CLI:-false}
PYTHON_VERSION=${PYTHON_VERSION:-3.12.3}

# Install uv if requested
if [ "$INSTALL_UV" = "true" ]; then
  echo "📦 Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh

  # Add uv to PATH for current and future sessions
  echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.bashrc
  export PATH="$HOME/.cargo/bin:$PATH"

  # Install Python if version specified
  if [ -n "$PYTHON_VERSION" ]; then
    if [ "$PYTHON_VERSION" = "latest" ]; then
      echo "🐍 Installing latest stable Python..."
      uv python install
    else
      echo "🐍 Installing Python $PYTHON_VERSION..."
      uv python install "$PYTHON_VERSION"
    fi

    # Create symlink for system-wide access (only if specific version installed)
    if [ "$PYTHON_VERSION" != "latest" ]; then
      PYTHON_MINOR=$(echo "$PYTHON_VERSION" | cut -d. -f1,2)
      sudo ln -sf "$HOME/.local/bin/python$PYTHON_MINOR" "/usr/bin/python$PYTHON_MINOR" 2>/dev/null || true
    fi
  fi
fi

# Install Claude Code if requested
if [ "$INSTALL_CLAUDE_CODE" = "true" ]; then
  echo "🤖 Installing Claude Code..."
  npm install -g @anthropic-ai/claude-code || echo "⚠️  Claude Code installation failed - may not be publicly available yet"
fi

# Install Gemini CLI if requested
if [ "$INSTALL_GEMINI_CLI" = "true" ]; then
  echo "🤖 Installing Gemini CLI..."
  npm install -g @google/gemini-cli || echo "⚠️  Gemini CLI installation failed"
fi

# Install OpenAI Codex CLI if requested
if [ "$INSTALL_CODEX_CLI" = "true" ]; then
  echo "🤖 Installing OpenAI Codex CLI..."
  npm install -g @openai/codex || echo "⚠️  Codex CLI installation failed"
fi

# Install specify-cli if requested
if [ "$INSTALL_SPECIFY_CLI" = "true" ] && [ "$INSTALL_UV" = "true" ]; then
  echo "🛠️ Installing specify-cli from GitHub..."
  uv tool install specify-cli --from git+https://github.com/github/spec-kit.git || echo "⚠️  specify-cli installation failed"
fi

# Install project dependencies if package.json exists
if [ -f "package.json" ]; then
  echo "📚 Installing project dependencies..."
  npm install
fi

# Run TypeScript compiler check if tsconfig.json exists
if [ -f "tsconfig.json" ]; then
  echo "🔍 Running TypeScript compiler check..."
  npx tsc --noEmit || echo "⚠️  TypeScript errors found - fix before committing"
fi

# Test database connection if credentials are provided
if [ -n "$POSTGRES_HOST" ] && [ -n "$POSTGRES_USER" ]; then
  echo "🔌 Testing PostgreSQL connection..."
  if PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" -d "${POSTGRES_DB:-postgres}" -c "SELECT version();" > /dev/null 2>&1; then
    echo "✅ PostgreSQL connection successful"
  else
    echo "⚠️  PostgreSQL connection failed - check your .env configuration"
  fi
fi

# Make all scripts executable if scripts directory exists
if [ -d "scripts" ]; then
  echo "🔐 Making scripts executable..."
  chmod +x scripts/*.sh 2>/dev/null || true
fi

# Run project-specific setup if it exists
if [ -f ".devcontainer/project-setup.sh" ]; then
  echo "🔧 Running project-specific setup..."
  bash .devcontainer/project-setup.sh
fi

echo "✅ Development environment setup complete!"
echo ""
echo "📝 Installed AI Tools:"
[ "$INSTALL_CLAUDE_CODE" = "true" ] && echo "  ✓ Claude Code CLI"
[ "$INSTALL_GEMINI_CLI" = "true" ] && echo "  ✓ Gemini CLI"
[ "$INSTALL_CODEX_CLI" = "true" ] && echo "  ✓ OpenAI Codex CLI"
[ "$INSTALL_UV" = "true" ] && echo "  ✓ uv (Python package manager)"
[ "$INSTALL_SPECIFY_CLI" = "true" ] && echo "  ✓ specify-cli"
echo ""
