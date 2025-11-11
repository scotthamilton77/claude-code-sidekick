---
name: typescript-developer
description: TypeScript development best practices covering dependency management with training-cutoff awareness, repository structure for single-project and monorepos, ESLint and Prettier configuration, TypeScript compiler issue resolution, SOLID principles in TypeScript, type safety patterns, generics, discriminated unions, error handling, and testing strategies. Includes context7 annotations for post-cutoff dependencies.
---

# TypeScript Developer

## Purpose

Build type-safe, maintainable, and architecturally sound TypeScript applications following industry best practices. Focus on dependency management, repository structure, tooling configuration, SOLID principles, and advanced TypeScript patterns.

## When to Use

- Setting up TypeScript projects (single or monorepo)
- Managing dependencies with training cutoff awareness
- Resolving TypeScript compiler or lint errors
- Implementing SOLID principles
- Configuring tsconfig.json, ESLint, Prettier
- Applying advanced type patterns
- Architecting scalable applications

---

## Training Cutoff Awareness

**Check your system prompt for your knowledge cutoff date.**

**Strategy:** Use stable versions from **before your cutoff** to leverage built-in knowledge. For post-cutoff versions, document in project's `CLAUDE.md` with context7 lookups.

**CLAUDE.md annotation format:**

```markdown
## Dependencies Beyond Training Cutoff

### package-name@version

**context7 lookup:** Link or search term

**Breaking changes:**
- List key changes

**Migration notes:**
- How to adapt existing code
```

**See [DEPENDENCIES.md](DEPENDENCIES.md) for complete version strategy and context7 workflow.**

---

## Dependency Management

### Version Pinning Philosophy

| Symbol | Behavior | Use For |
|--------|----------|---------|
| `~5.7.0` | Patch only (5.7.x) | Critical infrastructure (TypeScript, frameworks) |
| `^3.24.0` | Minor updates (3.x) | Stable libraries following semver |
| `5.7.0` | Exact version | Unstable libs, known problematic deps |

**Match type versions to runtime:**
- `@types/node: ~20.18.0` with `node: >=20.18.0`
- `@types/react: ~18.3.0` with `react: ~18.3.0`

**Audit regularly:** `npm audit`, `npm outdated`, `npm update` (test thoroughly)

**See [DEPENDENCIES.md](DEPENDENCIES.md) for:**
- Security practices
- Monorepo dependency coordination
- Lock file management

---

## Repository Structure

### Single vs Monorepo Decision

**Use single-project when:**
- One deployable artifact
- Simple dependency graph
- Small team

**Use monorepo when:**
- Multiple packages/services
- Shared code libraries
- Coordinated releases

### Monorepo Tool Selection

| Tool | Best For | Complexity | Key Feature |
|------|----------|------------|-------------|
| **npm workspaces** | Simple monorepos | Low | Built-in, zero config |
| **pnpm workspaces** | Disk efficiency | Low-Medium | Symlinked node_modules |
| **Nx** | Large-scale | High | Computation caching, generators |
| **Turborepo** | Build performance | Medium | Incremental builds |

**See [REPO_STRUCTURE.md](REPO_STRUCTURE.md) for:**
- TypeScript project references setup
- Path mapping configuration
- Module resolution troubleshooting

---

## Linting & Formatting

### Modern Stack (ESLint 9+)

**Key packages:**
- `eslint@^9.17.0` + `@eslint/js`
- `typescript-eslint` (for strict type-checked rules)
- `eslint-config-prettier` (disable conflicting rules)
- `prettier` (formatting)

**Pre-commit hooks:**
- `husky` (git hooks)
- `lint-staged` (run linters on staged files)

**Essential npm scripts:**
```json
{
  "lint": "eslint . --max-warnings 0",
  "lint:fix": "eslint . --fix",
  "format": "prettier --write .",
  "typecheck": "tsc --noEmit"
}
```

**See [LINT_AND_FORMAT.md](LINT_AND_FORMAT.md) for:**
- Complete ESLint 9 flat config patterns
- Rule customization
- Monorepo lint coordination
- Migration from ESLint 8

---

## TypeScript Compiler

### Essential tsconfig.json Flags

**Always enable:**
- `strict: true` (enables all strict checks)
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noImplicitReturns: true`
- `noFallthroughCasesInSwitch: true`
- `noUncheckedIndexedAccess: true` (safer array access)

### Module Resolution Strategy

| Strategy | Use Case | Import Extensions |
|----------|----------|-------------------|
| `Node16`/`NodeNext` | Modern Node.js ESM | Required (`.js`) |
| `Bundler` | Vite, webpack, esbuild | Optional |
| `Node` | Legacy CommonJS | Not required |

**ESM requirement:** Import paths must use `.js` extension even when importing `.ts` files.

### Common Errors Quick Reference

- **TS2307 (Cannot find module):** Check extensions (Node16) or path mappings
- **TS2345 (Type not assignable):** Handle null/undefined with `?.` or type guards
- **TS2564 (No initializer):** Initialize in declaration or constructor
- **TS2339 (Property does not exist):** Add to interface or use index signature

**See [COMPILER_CONFIG.md](COMPILER_CONFIG.md) for:**
- Complete error solutions
- Build optimization
- Project references

---

## SOLID Principles

Apply these patterns rigorously:

- **SRP (Single Responsibility):** One class, one reason to change
- **OCP (Open/Closed):** Extend via interfaces/composition, not modification
- **LSP (Liskov Substitution):** Subtypes must be substitutable for base types
- **ISP (Interface Segregation):** Many small interfaces > one fat interface
- **DIP (Dependency Inversion):** Depend on abstractions, inject dependencies

**Red flags to challenge:**
- God objects with multiple responsibilities
- Switch statements on type discriminators (use polymorphism)
- Direct instantiation with `new` in business logic (use DI)
- Fat interfaces forcing unused method implementations
- High-level modules depending on low-level modules

**See [SOLID_PRINCIPLES.md](SOLID_PRINCIPLES.md) for:**
- Refactoring strategies
- Real-world case studies
- TypeScript-specific patterns

---

## Type Safety Patterns

**Key patterns to apply:**

- **Discriminated Unions:** Type-safe state machines with literal discriminants
- **Type Guards:** Runtime checks with compile-time narrowing (`is` predicates)
- **Generic Constraints:** `T extends HasId` for enforcing interfaces
- **Utility Types:** `Pick`, `Omit`, `Partial`, `Required`, `Record`, `Readonly`
- **Branded Types:** Nominal typing for primitives (UserId vs string)

**Prefer:**
- `unknown` over `any` (requires type narrowing)
- `interface` over `type` for objects (better error messages)
- Explicit return types (self-documenting, catches inference bugs)

**See [TYPE_PATTERNS.md](TYPE_PATTERNS.md) for:**
- Mapped types
- Conditional types
- Template literal types
- Advanced generic patterns

---

## Error Suppression: Last Resort Only

**CRITICAL: Suppressing TypeScript/ESLint errors is LAST RESORT. Try in order:**

1. **Fix the root cause** - Refactor to satisfy checker
2. **Improve types** - Add proper type definitions
3. **Refactor architecture** - Follow SOLID principles
4. **Only then suppress** - With mandatory documentation

### Suppression Format (MANDATORY)

```typescript
// ❌ REJECTED in code review
// @ts-ignore
const data = api.getData();

// ✅ REQUIRED format
// @ts-expect-error - Third-party @types/legacy-lib incorrect definition
// Issue: https://github.com/legacy-lib/issues/123
// TODO: Remove when @types/legacy-lib@2.0.0 released (Q2 2025)
// Attempted fix: Forking types failed due to complex generics
const data = legacyLib.getData();
```

**Every suppression MUST include:**
- **WHY** (not just what is being suppressed)
- **Context** (link to issue/PR/docs)
- **Timeline** (when can this be removed)
- **Why fix isn't possible now**

**Code review: Automatically reject PRs with:**
- `@ts-ignore` / `@ts-expect-error` without detailed comments
- `eslint-disable` without justification
- `any` without proof `unknown` won't work
- `!` (non-null assertion) without safety proof

---

## Mandatory Pre-Commit Workflow

**ALWAYS run before claiming work complete:**

```bash
npm run lint:fix  # Auto-fix issues
npm run format    # Format code
tsc --noEmit      # Type check (MUST PASS)
npm test          # Tests (MUST PASS)
```

**If these fail, you're not done.** Fix all issues before completion.

---

## Best Practices Checklist

### ✅ DO
- Enable strict mode + additional safety flags
- Use explicit return types on functions
- Prefer interfaces over types for objects
- Use discriminated unions for state
- Follow SOLID principles
- Keep dependencies current (security)
- Use ESLint + Prettier consistently
- Document post-cutoff deps with context7
- Use path aliases for clean imports

### ❌ DON'T
- Use `any` (use `unknown`)
- Disable strict checks
- Suppress without detailed justification
- Use `!` carelessly (runtime errors)
- Create god objects (violates SRP)
- Skip pre-commit validation
- Mix ESM and CommonJS

---

## Reference Files

- **[DEPENDENCIES.md](DEPENDENCIES.md)** - Version management, context7, security
- **[REPO_STRUCTURE.md](REPO_STRUCTURE.md)** - Single & monorepo patterns
- **[LINT_AND_FORMAT.md](LINT_AND_FORMAT.md)** - ESLint, Prettier, hooks
- **[COMPILER_CONFIG.md](COMPILER_CONFIG.md)** - tsconfig, errors, optimization
- **[SOLID_PRINCIPLES.md](SOLID_PRINCIPLES.md)** - Refactoring strategies
- **[TYPE_PATTERNS.md](TYPE_PATTERNS.md)** - Advanced type patterns
