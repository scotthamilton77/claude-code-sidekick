#!/bin/bash
# Publish @scotthamilton77/sidekick to npm
# Usage: ./scripts/publish-dist.sh [patch|minor|major]
#
# Default (no args) bumps patch: 0.1.0 -> 0.1.1 -> 0.1.2
# Minor and major bumps are available but intended for manual use.
#
# Steps:
# 1. Check for uncommitted changes (fail if dirty, tolerating leftover version-bump files)
# 2. Bump version in packages/sidekick-dist/package.json
# 3. Build all packages
# 4. Publish packages/sidekick-dist
# 5. Commit version bump and tag

set -e

VERSION_TYPE="${1:-patch}"

# Validate version type
if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
    echo "Error: Invalid version type '$VERSION_TYPE'. Use: patch, minor, or major"
    exit 1
fi

echo "==> Checking for uncommitted changes..."
# These files get version-bumped during publish; leftover changes from a
# previous failed run are safe to ignore (they'll be overwritten).
VERSION_BUMP_FILES=(
    "packages/sidekick-dist/package.json"
    "packages/sidekick-plugin/.claude-plugin/plugin.json"
    ".claude-plugin/marketplace.json"
)

if ! git diff --quiet || ! git diff --cached --quiet; then
    # Get changed files (staged + unstaged, deduplicated)
    DIRTY_FILES=$({ git diff --name-only; git diff --cached --name-only; } | sort -u)

    # Filter out known version-bump files; anything remaining is unexpected
    NON_VERSION_FILES=$(grep -vxFf <(printf '%s\n' "${VERSION_BUMP_FILES[@]}") \
        <<< "$DIRTY_FILES" || true)

    if [[ -n "$NON_VERSION_FILES" ]]; then
        echo "Error: You have uncommitted changes. Commit or stash them before publishing."
        echo ""
        git status --short
        exit 1
    fi

    echo "    (ignoring leftover version-bump changes from previous run)"
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

echo "==> Bumping version ($VERSION_TYPE)..."
cd packages/sidekick-dist

OLD_VERSION=$(node -p "require('./package.json').version")

# Parse version: x.y.z
if [[ "$OLD_VERSION" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    MAJOR="${BASH_REMATCH[1]}"
    MINOR="${BASH_REMATCH[2]}"
    PATCH="${BASH_REMATCH[3]}"
else
    echo "Error: Could not parse version '$OLD_VERSION' (expected x.y.z)"
    exit 1
fi

# Compute new version
case "$VERSION_TYPE" in
    patch)
        PATCH=$((PATCH + 1))
        ;;
    minor)
        MINOR=$((MINOR + 1))
        PATCH=0
        ;;
    major)
        MAJOR=$((MAJOR + 1))
        MINOR=0
        PATCH=0
        ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

# Update package.json
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
pkg.version = '$NEW_VERSION';
fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
"

cd ../..

# Sync version to plugin metadata files
node -e "
const fs = require('fs');
const files = [
  'packages/sidekick-plugin/.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
];
for (const file of files) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (json.version) json.version = '$NEW_VERSION';
  if (json.plugins) json.plugins.forEach(p => { if (p.version) p.version = '$NEW_VERSION'; });
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}
console.log('    Synced version to plugin.json and marketplace.json');
"

echo "    $OLD_VERSION -> $NEW_VERSION"

echo "==> Building all packages..."
pnpm build

echo "==> Publishing @scotthamilton77/sidekick@$NEW_VERSION..."
cd packages/sidekick-dist

npm publish --access public --tag latest

cd ../..

echo ""
echo "==> Published successfully! Committing version bump..."

git add "${VERSION_BUMP_FILES[@]}"
git commit -m "chore: release @scotthamilton77/sidekick@$NEW_VERSION"
git tag "v$NEW_VERSION"

echo "==> Committed and tagged v$NEW_VERSION"
echo ""
echo "Don't forget to push:"
echo "  git push && git push --tags"
