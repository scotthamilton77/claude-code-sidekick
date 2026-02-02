#!/bin/bash
# Publish @scotthamilton77/sidekick to npm
# Usage: ./scripts/publish-dist.sh [patch|minor|major]
#
# Steps:
# 1. Check for uncommitted changes (fail if dirty)
# 2. Bump version in packages/sidekick-dist/package.json
# 3. Build all packages
# 4. Publish packages/sidekick-dist

set -e

VERSION_TYPE="${1:-patch}"

# Validate version type
if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
    echo "Error: Invalid version type '$VERSION_TYPE'. Use: patch, minor, or major"
    exit 1
fi

echo "==> Checking for uncommitted changes..."
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Error: You have uncommitted changes. Commit or stash them before publishing."
    echo ""
    git status --short
    exit 1
fi

# Check for untracked files that might be important
UNTRACKED=$(git ls-files --others --exclude-standard)
if [[ -n "$UNTRACKED" ]]; then
    echo "Warning: You have untracked files:"
    echo "$UNTRACKED"
    echo ""
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "==> Bumping $VERSION_TYPE version..."
cd packages/sidekick-dist
OLD_VERSION=$(node -p "require('./package.json').version")
npm version "$VERSION_TYPE" --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
cd ../..

echo "    $OLD_VERSION -> $NEW_VERSION"

echo "==> Building all packages..."
pnpm build

echo "==> Publishing @scotthamilton77/sidekick@$NEW_VERSION..."
cd packages/sidekick-dist
npm publish --access public

echo ""
echo "==> Published successfully!"
echo ""
echo "Don't forget to commit the version bump:"
echo "  git add packages/sidekick-dist/package.json"
echo "  git commit -m \"chore: release @scotthamilton77/sidekick@$NEW_VERSION\""
echo "  git tag v$NEW_VERSION"
echo "  git push && git push --tags"
