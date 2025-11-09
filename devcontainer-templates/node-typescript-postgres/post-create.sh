#!/bin/bash
set -e

echo "🔧 Setting up TypeScript + PostgreSQL development environment..."

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
