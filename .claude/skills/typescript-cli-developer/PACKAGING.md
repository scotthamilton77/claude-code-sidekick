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

### Basic Setup

```json
{
  "name": "my-cli-tool",
  "version": "1.0.0",
  "description": "CLI tool for doing awesome things",
  "type": "module",
  "bin": {
    "mycli": "./dist/cli.js"
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.ts",
    "test": "vitest",
    "prepublishOnly": "npm run build && npm test"
  },
  "keywords": [
    "cli",
    "tool",
    "command-line"
  ],
  "author": "Your Name <you@example.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/username/my-cli-tool.git"
  },
  "bugs": {
    "url": "https://github.com/username/my-cli-tool/issues"
  },
  "homepage": "https://github.com/username/my-cli-tool#readme"
}
```

### Key Fields

#### `bin`

Maps command name to executable:

```json
{
  "bin": {
    "mycli": "./dist/cli.js"
  }
}
```

Multiple commands:

```json
{
  "bin": {
    "mycli": "./dist/cli.js",
    "mycli-admin": "./dist/admin.js"
  }
}
```

Single command (command name = package name):

```json
{
  "name": "mycli",
  "bin": "./dist/cli.js"
}
```

#### `files`

Whitelist files to include in published package:

```json
{
  "files": [
    "dist",
    "README.md",
    "LICENSE",
    "!dist/**/*.test.js",
    "!dist/**/*.map"
  ]
}
```

**Best practice:** Only include what users need
- ✅ `dist/` - Compiled code
- ✅ `README.md` - Documentation
- ✅ `LICENSE` - License file
- ❌ `src/` - Source code (unless needed)
- ❌ `test/` - Tests
- ❌ `.env` - Environment files

#### `type: "module"`

Enable ES modules:

```json
{
  "type": "module"
}
```

Use CommonJS instead:

```json
{
  "type": "commonjs"
}
```

#### `engines`

Specify Node.js version requirements:

```json
{
  "engines": {
    "node": ">=18.0.0"
  }
}
```

Strict enforcement:

```json
{
  "engines": {
    "node": ">=18.0.0"
  },
  "engineStrict": true
}
```

---

## TypeScript Configuration

### tsconfig.json for CLIs

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### Key Settings

- **`target`**: ES2022 for modern Node.js (v18+)
- **`module`**: ES2022 for ES modules
- **`outDir`**: Where compiled files go (usually `./dist`)
- **`rootDir`**: Source directory (usually `./src`)
- **`declaration`**: Generate `.d.ts` files (helpful for libraries)
- **`sourceMap`**: Generate source maps for debugging

### CommonJS Alternative

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

---

## Building for Distribution

### Build Scripts

```json
{
  "scripts": {
    "build": "tsc",
    "build:watch": "tsc --watch",
    "clean": "rm -rf dist",
    "rebuild": "npm run clean && npm run build"
  }
}
```

### Pre-publish Hook

Automatically build and test before publishing:

```json
{
  "scripts": {
    "prepublishOnly": "npm run build && npm test"
  }
}
```

**Lifecycle hooks:**
- `prepublishOnly` - Runs before `npm publish` (recommended)
- `prepare` - Runs on `npm install` (use for git installs)
- `prepack` - Runs before tarball is created

### Build Optimization

#### Minification with esbuild

**Install:** `npm install -D esbuild`

```json
{
  "scripts": {
    "build": "tsc && npm run minify",
    "minify": "esbuild dist/cli.js --bundle --platform=node --outfile=dist/cli.min.js"
  }
}
```

#### Bundle with esbuild

```typescript
// build.ts
import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'dist/cli.js',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    // Don't bundle these
    'inquirer',
    'chalk',
  ],
});
```

---

## Making CLI Executable

### Shebang Line

Add shebang to entry point:

```typescript
#!/usr/bin/env node

// src/cli.ts
import { run } from './index.js';

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
```

**Important:** Use `#!/usr/bin/env node`, not `#!/usr/bin/node`
- `env` finds node in PATH (more portable)
- Direct path breaks on systems where node is elsewhere

### File Permissions

Set executable permission after build:

```json
{
  "scripts": {
    "build": "tsc && chmod +x dist/cli.js"
  }
}
```

Or use a post-build script:

```json
{
  "scripts": {
    "build": "tsc",
    "postbuild": "chmod +x dist/cli.js"
  }
}
```

**Note:** npm automatically sets execute bit for `bin` files during install

---

## Local Development

### Using tsx for Development

**Install:** `npm install -D tsx`

```json
{
  "scripts": {
    "dev": "tsx src/cli.ts",
    "dev:watch": "tsx watch src/cli.ts"
  }
}
```

Run with args:

```bash
npm run dev -- build input.ts --output dist
```

### npm link for Local Testing

Link CLI globally:

```bash
npm link

# Now you can run it globally
mycli --help
mycli build input.ts
```

Unlink when done:

```bash
npm unlink -g my-cli-tool
```

Link to another project:

```bash
# In CLI project
npm link

# In project that uses the CLI
npm link my-cli-tool
```

### Testing Installed Behavior

Test what users will get:

```bash
# Create tarball
npm pack

# Install tarball locally
npm install -g ./my-cli-tool-1.0.0.tgz

# Test it
mycli --help

# Uninstall
npm uninstall -g my-cli-tool
```

---

## Publishing to npm

### First-Time Setup

```bash
# Create npm account (if needed)
# Visit https://www.npmjs.com/signup

# Login
npm login

# Verify login
npm whoami
```

### Publishing

```bash
# Dry run (see what will be published)
npm publish --dry-run

# Publish public package
npm publish

# Publish scoped package as public
npm publish --access public
```

### Scoped Packages

```json
{
  "name": "@username/my-cli-tool"
}
```

Scoped packages are private by default. Make public:

```bash
npm publish --access public
```

### Pre-publish Checklist

- [ ] Update version number
- [ ] Update CHANGELOG.md
- [ ] Run tests (`npm test`)
- [ ] Build (`npm run build`)
- [ ] Test locally (`npm link`)
- [ ] Check package contents (`npm pack --dry-run`)
- [ ] Update README.md
- [ ] Commit changes
- [ ] Create git tag

---

## Version Management

### Semantic Versioning

Format: `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes

### npm version Command

```bash
# Patch release (1.0.0 -> 1.0.1)
npm version patch

# Minor release (1.0.0 -> 1.1.0)
npm version minor

# Major release (1.0.0 -> 2.0.0)
npm version major

# Pre-release (1.0.0 -> 1.0.1-beta.0)
npm version prerelease --preid=beta
```

Auto-commits and tags:

```bash
npm version patch -m "Release v%s"
```

### Version Script Hook

```json
{
  "scripts": {
    "version": "npm run build && git add dist",
    "postversion": "git push && git push --tags && npm publish"
  }
}
```

Workflow:

```bash
npm version patch
# Automatically:
# 1. Bumps version
# 2. Runs build
# 3. Commits
# 4. Creates git tag
# 5. Pushes to git
# 6. Publishes to npm
```

---

## Binary Wrappers

For distributing standalone binaries (without requiring Node.js):

### pkg

**Install:** `npm install -D pkg`

```json
{
  "scripts": {
    "package": "pkg ."
  },
  "pkg": {
    "targets": ["node18-linux-x64", "node18-macos-x64", "node18-win-x64"],
    "outputPath": "binaries"
  }
}
```

Creates standalone executables for each platform.

### ncc (Single File Bundle)

**Install:** `npm install -D @vercel/ncc`

```json
{
  "scripts": {
    "bundle": "ncc build src/cli.ts -o dist"
  }
}
```

Bundles everything into a single file.

---

## Distribution Best Practices

### ✅ DO

1. **Include only necessary files**
   ```json
   { "files": ["dist", "README.md", "LICENSE"] }
   ```

2. **Use prepublishOnly hook**
   ```json
   { "scripts": { "prepublishOnly": "npm run build && npm test" } }
   ```

3. **Test before publishing**
   ```bash
   npm pack && npm install -g ./package.tgz
   ```

4. **Version properly**
   ```bash
   npm version patch  # Bug fixes
   npm version minor  # New features
   npm version major  # Breaking changes
   ```

5. **Include README with examples**
   - Installation instructions
   - Usage examples
   - API documentation

6. **Add keywords for discoverability**
   ```json
   { "keywords": ["cli", "tool", "typescript"] }
   ```

7. **Specify Node.js version**
   ```json
   { "engines": { "node": ">=18.0.0" } }
   ```

### ❌ DON'T

1. **Don't include source files** (unless needed)
2. **Don't forget shebang** - CLI won't be executable
3. **Don't publish secrets** - Check `.npmignore`
4. **Don't skip testing** - Test install before publishing
5. **Don't use `latest` tag carelessly** - Reserve for stable releases

---

## .npmignore

Control what gets excluded:

```
# .npmignore
src/
test/
*.test.js
*.spec.js
tsconfig.json
.env
.env.*
.DS_Store
node_modules/
```

**Note:** If `.npmignore` exists, `.gitignore` is ignored. List everything!

---

## Example Package Structure

```
my-cli-tool/
├── src/
│   ├── cli.ts           # Entry point
│   ├── index.ts         # Main logic
│   └── utils.ts
├── test/
│   └── integration.test.ts
├── dist/                # Build output (gitignored)
│   ├── cli.js
│   ├── index.js
│   └── utils.js
├── .gitignore
├── .npmignore
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE
└── CHANGELOG.md
```

---

## Quick Start Template

```json
{
  "name": "my-cli-tool",
  "version": "1.0.0",
  "type": "module",
  "bin": "./dist/cli.js",
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.ts",
    "test": "vitest",
    "prepublishOnly": "npm run build && npm test",
    "version": "npm run build",
    "postversion": "git push && git push --tags"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "tsx": "^4.7.0",
    "vitest": "^1.0.4",
    "@types/node": "^20.10.0"
  }
}
```

---

**Related Files:**
- [SKILL.md](SKILL.md) - Main skill overview
- [ARGUMENT_PARSING.md](ARGUMENT_PARSING.md) - Argument parsing
- [TERMINAL_UI.md](TERMINAL_UI.md) - Terminal UI components
- [TESTING.md](TESTING.md) - Testing CLI applications
