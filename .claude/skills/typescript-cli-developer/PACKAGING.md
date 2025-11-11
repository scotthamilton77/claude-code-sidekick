# Packaging and Distribution

Complete guide to packaging TypeScript CLI tools for npm distribution.

## Table of Contents

- [package.json Configuration](#packagejson-configuration)
- [TypeScript Configuration](#typescript-configuration)
- [Building for Distribution](#building-for-distribution)
- [Making CLI Executable](#making-cli-executable)
- [Local Development](#local-development)
- [Publishing to npm](#publishing-to-npm)
- [Version Management](#version-management)
- [Binary Wrappers](#binary-wrappers)

---

## package.json Configuration

### Essential Fields
- **name**: Package name (use scoped `@org/name` for orgs)
- **version**: Semver version
- **type**: `"module"` for ESM, `"commonjs"` for CJS
- **bin**: `{ "cmdname": "./dist/cli.js" }` or string for single command
- **files**: Whitelist (`["dist", "README.md", "LICENSE"]`) - only ship what users need
- **scripts**: `build`, `dev`, `test`, `prepublishOnly` (runs before publish)
- **engines**: `{ "node": ">=18.0.0" }` to specify Node.js requirement

### Configuration Details
**bin formats:**
- Object: Multiple commands `{ "cmd1": "dist/cli1.js", "cmd2": "dist/cli2.js" }`
- String: Single command (name matches package name)

**files whitelist:** Include dist, docs, exclude src/tests. Use `!pattern` for negation.

**engines:** Add `engineStrict: true` for strict enforcement (fails install on mismatch)

---

## TypeScript Configuration

### tsconfig.json Essentials
Target `ES2022` + module `ES2022` for modern Node.js ESM. Set `outDir: "./dist"` and `rootDir: "./src"`. Enable `strict: true`, `declaration: true` (for `.d.ts`), `sourceMap: true` (for debugging).

### Key Settings (Why)
- **ES2022**: Top-level await, modern syntax
- **outDir/rootDir**: Separate compiled from source
- **declaration**: Type definitions for consumers
- **sourceMap**: Debug with TS line numbers
- **strict**: Catch type errors early
- **skipLibCheck**: Faster builds

For CommonJS: Set `module: "CommonJS"` and `moduleResolution: "node"`

---

## Building for Distribution

### Scripts
- **build**: `tsc` to compile
- **dev**: `tsx src/cli.ts` for development
- **prepublishOnly**: `npm run build && npm test` (runs before publish)

### Lifecycle Hooks
- `prepublishOnly`: Before `npm publish` (use for validation)
- `prepare`: After install (for git dependencies)
- `prepack`: Before tarball creation

### Optimization (Optional)
Use esbuild for bundling: `esbuild src/cli.ts --bundle --platform=node --target=node18`. Mark large deps as `external` to avoid bundling.

---

## Making CLI Executable

### Shebang
Add `#!/usr/bin/env node` as first line of entry file. Use `env` (not `#!/usr/bin/node`) for portability - finds node in PATH regardless of installation location.

### Permissions
npm automatically sets execute bit for `bin` files on install. For local dev, optionally add `chmod +x dist/cli.js` to build script.

---

## Local Development

### Development
Use `tsx` for dev: `tsx src/cli.ts [args]`. Pass args after `--`: `npm run dev -- build file.ts`.

### Local Testing
- **npm link**: Makes CLI available globally for testing (`npm link`, then run command)
- **npm pack**: Creates tarball to test actual install (`npm install -g ./package.tgz`)
- **Unlink**: `npm unlink -g package-name` when done

Test with pack before publishing to verify contents.

---

## Publishing to npm

### Setup
Run `npm login` (create account at npmjs.com if needed). Verify with `npm whoami`.

### Publish
- **Dry run**: `npm publish --dry-run` to preview
- **Public**: `npm publish` for unscoped packages
- **Scoped**: `npm publish --access public` for `@org/name` packages (private by default)

### Pre-Publish Checklist
1. Version bump (`npm version [patch|minor|major]`)
2. Run tests and build
3. Test locally (`npm link` or `npm pack`)
4. Verify contents (`npm pack --dry-run`)
5. Update changelog/readme
6. Commit and tag

---

## Version Management

### Semantic Versioning
- **MAJOR**: Breaking changes (1.0.0 → 2.0.0)
- **MINOR**: New features, backward compatible (1.0.0 → 1.1.0)
- **PATCH**: Bug fixes (1.0.0 → 1.0.1)

### npm version
Run `npm version [patch|minor|major]` to bump, commit, and tag. Add `-m "Release v%s"` for custom commit message.

### Automation
Use `version` and `postversion` hooks to auto-build, push, and publish:
```json
"scripts": {
  "version": "npm run build && git add dist",
  "postversion": "git push && git push --tags && npm publish"
}
```

---

## Binary Wrappers (Optional)

For standalone executables without Node.js requirement:
- **pkg**: Creates platform-specific binaries (`node18-linux-x64`, etc.)
- **ncc**: Bundles to single file

Most CLIs don't need this - npm install is standard for Node.js tools.

---

## Best Practices

### ✅ DO
1. Include only dist in `files` whitelist
2. Use `prepublishOnly` hook for build + test
3. Test with `npm pack` before publishing
4. Version correctly (patch/minor/major)
5. Add keywords for discoverability
6. Specify Node.js version in `engines`
7. Include README with examples

### ❌ DON'T
1. Include source files (unless needed)
2. Forget shebang (`#!/usr/bin/env node`)
3. Publish secrets (use `.npmignore`)
4. Skip testing install before publish
5. Use `latest` tag carelessly

### .npmignore
If `.npmignore` exists, `.gitignore` is ignored - list everything to exclude (src/, test/, tsconfig.json, .env).

---

**Related Files:**
- [SKILL.md](SKILL.md) - Main skill overview
- [ARGUMENT_PARSING.md](ARGUMENT_PARSING.md) - Argument parsing
- [TERMINAL_UI.md](TERMINAL_UI.md) - Terminal UI components
- [TESTING.md](TESTING.md) - Testing CLI applications
