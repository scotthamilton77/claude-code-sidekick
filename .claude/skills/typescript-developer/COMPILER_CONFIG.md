# TypeScript Compiler Configuration

## Table of Contents

- [Essential Flags](#essential-flags)
- [Module Resolution Decision Matrix](#module-resolution-decision-matrix)
- [Common Compiler Errors](#common-compiler-errors)
- [Build Optimization](#build-optimization)
- [Project References](#project-references)

---

## Essential Flags

### Strict Mode (Always Enable)

**Enable `strict: true` which activates:**
- `noImplicitAny`
- `strictNullChecks`
- `strictFunctionTypes`
- `strictBindCallApply`
- `strictPropertyInitialization`
- `noImplicitThis`
- `alwaysStrict`

### Additional Recommended Flags

**Beyond strict mode, always enable:**
- `noUnusedLocals: true` - Catch unused variables
- `noUnusedParameters: true` - Catch unused function parameters
- `noImplicitReturns: true` - All code paths must return
- `noFallthroughCasesInSwitch: true` - Prevent switch fallthrough bugs
- `noUncheckedIndexedAccess: true` - Array access returns `T | undefined`
- `exactOptionalPropertyTypes: true` - Stricter optional properties
- `noImplicitOverride: true` - Require explicit `override` keyword
- `allowUnreachableCode: false` - Detect dead code
- `allowUnusedLabels: false` - Detect unused labels

### Performance Flags

- `skipLibCheck: true` - Don't type-check node_modules (recommended)
- `incremental: true` - Enable incremental compilation
- `tsBuildInfoFile: "./.tsbuildinfo"` - Cache location

---

## Module Resolution Decision Matrix

### Resolution Strategies

| Strategy | Use When | Import Extensions | package.json type |
|----------|----------|-------------------|-------------------|
| `Node16` / `NodeNext` | Modern Node.js ESM | **Required** (.js) | `"type": "module"` |
| `Bundler` | Vite, webpack, esbuild, Rollup | Optional | Any |
| `Node` | Legacy CommonJS | Not required | Omit or `"type": "commonjs"` |

### Target Selection

| Target | Use When | Supported Features |
|--------|----------|-------------------|
| `ES2022` | Node 18+, modern browsers | Top-level await, class fields |
| `ES2021` | Node 16+, recent browsers | Logical assignment |
| `ES2020` | Node 14+, wider compatibility | Optional chaining, nullish coalescing |
| `ES2019` | Node 12+, broad compatibility | Flat, flatMap |

**Rule:** Match target to minimum supported runtime.

### Module System

| Module | Use When | Output |
|--------|----------|--------|
| `Node16` / `NodeNext` | Modern Node.js | ESM (respects package.json type) |
| `ESNext` | Bundlers (no emit) | Modern import/export |
| `CommonJS` | Legacy Node.js | require/exports |

### Critical ESM Rule

**When using `Node16`/`NodeNext`:** Import paths **must** include `.js` extension, even for `.ts` files.

```typescript
// ✅ Correct (Node16)
import { fn } from './utils.js';  // TypeScript finds utils.ts

// ❌ Wrong (Node16)
import { fn } from './utils';  // Error: Cannot find module
```

---

## Common Compiler Errors

### TS2307: Cannot find module

**Causes:**
1. Missing `.js` extension (Node16 mode)
2. Incorrect path mapping
3. Missing type declarations

**Solutions:**
```typescript
// Problem: Node16 requires extensions
import { x } from './file';  // ❌

// Solution: Add .js extension
import { x } from './file.js';  // ✅

// Problem: Path mapping not configured
import { x } from '@/utils';  // ❌

// Solution: Configure paths in tsconfig.json
{
  "baseUrl": ".",
  "paths": { "@/*": ["./src/*"] }
}

// Problem: Missing type declarations
import express from 'express';  // ❌

// Solution: Install types
npm install -D @types/express  // ✅
```

### TS2345: Type 'X' is not assignable to type 'Y'

**Causes:**
1. Null/undefined not handled (`strictNullChecks`)
2. Wrong type shape
3. Missing type narrowing

**Solutions:**
```typescript
// Problem: Null not handled
function getLength(str: string): number {
  return str.length;
}
const len = getLength(maybeNull);  // ❌

// Solution: Handle null
function getLength(str: string | null): number {
  return str?.length ?? 0;  // ✅
}

// Problem: Type mismatch
const user: User = { id: 1, name: 'Alice' };  // ❌ id should be string

// Solution: Correct type
const user: User = { id: '1', name: 'Alice' };  // ✅
```

### TS2564: Property has no initializer

**Causes:**
`strictPropertyInitialization` requires properties initialized.

**Solutions:**
```typescript
class User {
  // Problem: No initializer
  name: string;  // ❌

  // Solution 1: Initialize in declaration
  name: string = '';  // ✅

  // Solution 2: Initialize in constructor
  constructor(name: string) {
    this.name = name;  // ✅
  }

  // Solution 3: Make optional
  name?: string;  // ✅

  // Solution 4: Definite assignment (use carefully!)
  name!: string;  // ✅ (you guarantee assignment before use)
}
```

### TS2339: Property does not exist on type

**Causes:**
1. Property not in interface
2. Typo in property name
3. Wrong object type

**Solutions:**
```typescript
// Problem: Property missing from interface
interface User {
  id: string;
  name: string;
}
console.log(user.email);  // ❌

// Solution 1: Add to interface
interface User {
  id: string;
  name: string;
  email?: string;  // ✅
}

// Solution 2: Index signature for dynamic properties
interface User {
  id: string;
  name: string;
  [key: string]: unknown;  // ✅
}
```

### TS2322: Type is not assignable (Array)

**Cause:**
`noUncheckedIndexedAccess` makes array access return `T | undefined`.

**Solutions:**
```typescript
// Problem: Array access returns T | undefined
const arr: string[] = ['a', 'b'];
const first: string = arr[0];  // ❌

// Solution 1: Handle undefined
const first: string | undefined = arr[0];  // ✅

// Solution 2: Non-null assertion (if certain)
const first = arr[0]!;  // ✅

// Solution 3: Runtime check
const first = arr[0];
if (first !== undefined) {
  // first is string here
}

// Solution 4: Use .at() method
const first = arr.at(0);  // string | undefined  ✅
```

---

## Build Optimization

### Incremental Builds

**Enable caching:**
```json
{
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": "./.tsbuildinfo"
  }
}
```

**Add to .gitignore:**
```
.tsbuildinfo
*.tsbuildinfo
```

### Skip Library Checks

```json
{
  "compilerOptions": {
    "skipLibCheck": true
  }
}
```

**Benefits:**
- Faster compilation
- Avoid errors in third-party types
- Focus on your code

**Trade-off:** May miss library usage errors (usually acceptable).

### Watch Mode Optimization

```json
{
  "compilerOptions": {
    "assumeChangesOnlyAffectDirectDependencies": true
  },
  "watchOptions": {
    "excludeDirectories": ["**/node_modules", "dist"]
  }
}
```

---

## Project References

### Purpose

Split large codebases into independently buildable units.

### When to Use

- Monorepos with multiple packages
- Large projects with distinct modules
- Need for incremental builds across packages

### Key Benefits

- Faster incremental builds (only rebuild changed projects)
- Better IDE performance
- Enforced dependencies (no circular references)
- Independent compilation

### Setup Pattern

**Root tsconfig.json:**
```json
{
  "files": [],
  "references": [
    { "path": "./packages/common" },
    { "path": "./packages/api" }
  ]
}
```

**Package tsconfig.json:**
```json
{
  "compilerOptions": {
    "composite": true,       // Required for references
    "declaration": true,     // Required for references
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "references": [
    { "path": "../common" }  // Dependencies
  ]
}
```

### Build Commands

```bash
tsc --build              # Build all referenced projects
tsc --build --watch      # Watch mode
tsc --build --clean      # Clean build
tsc --build --force      # Force rebuild all
```

---

## Configuration Decision Tree

### Choosing Module Resolution

```
Modern Node.js ESM?
├─ Yes → moduleResolution: "Node16", module: "Node16", type: "module"
└─ No → Bundler?
    ├─ Yes → moduleResolution: "Bundler", module: "ESNext"
    └─ No → Legacy CommonJS
        └─ moduleResolution: "Node", module: "CommonJS"
```

### Choosing Target

```
Minimum Node version?
├─ Node 18+ → target: "ES2022"
├─ Node 16+ → target: "ES2021"
├─ Node 14+ → target: "ES2020"
└─ Node 12+ → target: "ES2019"
```

### Choosing Lib

**Match your target + environment:**
```json
{
  "lib": [
    "ES2022",           // Match target
    "DOM",              // If browser code
    "DOM.Iterable"      // If browser code
  ]
}
```

---

## Quick Commands

### Type Check Only

```bash
tsc --noEmit           # No output files, just check types
```

### Show Configuration

```bash
tsc --showConfig       # View resolved config
tsc --explainFiles     # Show which files are included/excluded
```

### Build Modes

```bash
tsc                    # Regular build
tsc --watch            # Watch mode
tsc --build            # Project references mode
```

---

**Back to:** [TypeScript Developer Skill](SKILL.md)
