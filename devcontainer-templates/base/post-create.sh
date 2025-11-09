#!/bin/bash
set -e

echo "🔧 Setting up development environment..."

# Install project dependencies if package.json exists
if [ -f "package.json" ]; then
  echo "📚 Installing project dependencies..."
  npm install
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
