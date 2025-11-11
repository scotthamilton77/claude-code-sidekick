# Dependency Management

## Table of Contents

- [Training Cutoff Strategy](#training-cutoff-strategy)
- [Version Pinning Decision Matrix](#version-pinning-decision-matrix)
- [context7 Integration](#context7-integration)
- [Security Practices](#security-practices)
- [Monorepo Dependencies](#monorepo-dependencies)
- [Lock Files](#lock-files)

---

## Training Cutoff Strategy

### Philosophy

Use stable versions from **before your training cutoff** whenever possible to leverage built-in knowledge. For post-cutoff versions, document exceptions clearly.

### Decision Matrix

| Scenario | Strategy | Action |
|----------|----------|--------|
| **Library within cutoff** | ✅ Use freely | Install and use standard patterns |
| **Minor update post-cutoff** | ⚠️ Document | Annotate in CLAUDE.md with context7 |
| **Major version post-cutoff** | ⚠️⚠️ Document extensively | Full context7 lookup, migration guide |
| **New library post-cutoff** | 🔍 Evaluate | Consider pre-cutoff alternatives first |

### CLAUDE.md Documentation Template

**Always document post-cutoff dependencies:**

```markdown
## Dependencies Beyond Training Cutoff

### package-name@version

**context7 lookup:** Link to release notes or migration guide

**Breaking changes:**
- List specific breaking changes
- Impact on existing code

**Migration notes:**
- Code changes required
- New patterns to adopt

**Example:**
[Brief code example showing new API if truly necessary]
```

---

## Version Pinning Decision Matrix

### Semantic Versioning: MAJOR.MINOR.PATCH

### Pinning Strategies

| Symbol | Allows | Use For | Rationale |
|--------|--------|---------|-----------|
| `~5.7.0` | 5.7.x only | TypeScript, frameworks, build tools | Breaking changes in minors historically |
| `^3.24.0` | 3.x | Well-maintained libs following semver | Safe minor updates |
| `5.7.0` | Exact only | Pre-1.0, unstable, problematic deps | Known issues, temporary workarounds |

### By Category

**Core language tooling:** `~` patch only
- typescript, @swc/core, esbuild

**Framework core:** `~` patch only
- react, vue, angular, next

**Stable libraries:** `^` minor updates
- zod, date-fns, lodash

**Type definitions:** Match runtime version constraints
- `@types/node: ~20.18.0` if `node: >=20.18.0`
- `@types/react: ~18.3.0` if `react: ~18.3.0`

**Development tools:** More flexible
- vitest, eslint, prettier (can use `^`)

### Version Ranges to NEVER Use

- `*` - Unpredictable
- `latest` - Not reproducible
- `>1.0.0` - Too broad
- `>=1.0.0` - Unbounded

---

## context7 Integration

### When to Use context7

1. Installing package version newer than training cutoff
2. Encountering surprising behavior in known libraries
3. Researching migration paths for major version bumps
4. Investigating breaking changes in post-cutoff versions

### Workflow

**1. Check published date:**
```bash
npm view <package> time
# Compare dates to your training cutoff
```

**2. If post-cutoff, use context7 BEFORE implementing:**
- Request official changelog/release notes
- Review breaking changes documentation
- Check migration guides

**3. Document findings in project's CLAUDE.md** (see template above)

### Common Post-Cutoff Packages to Check

Frequently updated packages that may be post-cutoff:
- TypeScript (rapid release cycle)
- React/Next.js (major versions)
- Build tools (Vite, esbuild)
- ESLint (annual majors)
- Testing frameworks (Vitest, Jest)

---

## Security Practices

### Regular Audits

**Frequency:** Weekly or before major releases

```bash
npm audit              # Check vulnerabilities
npm audit --json       # Detailed JSON output
npm audit fix          # Auto-fix (review changes!)
npm audit fix --force  # ⚠️ Breaking changes - test first
```

### Vulnerability Response Priority

1. **Critical/High in production deps:** Immediate action
2. **Critical/High in dev deps:** Fix in next sprint
3. **Moderate:** Schedule for update cycle
4. **Low:** Fix when touching related code

### Response Actions

1. Check if newer version fixes issue (`npm outdated`)
2. Update specific package (`npm update <package>`)
3. If no fix available:
   - Check for alternative library
   - Vendor and patch (document extensively)
   - Implement mitigation (explain in CLAUDE.md)

### CI/CD Integration

Add to pipeline:
```bash
npm audit --audit-level=moderate  # Fail on moderate+
```

---

## Monorepo Dependencies

### Workspace Dependencies

**Three-tier strategy:**

1. **Root level:** Shared dev tools (TypeScript, ESLint, Prettier, Vitest)
2. **Common package:** Shared runtime utilities (zod, date-fns)
3. **Individual packages:** Package-specific dependencies

### Workspace Protocol (pnpm)

```json
{
  "dependencies": {
    "@org/common": "workspace:*",     // Any version
    "@org/utils": "workspace:^",      // Compatible version
    "@org/types": "workspace:~"       // Exact version
  }
}
```

### Version Synchronization

**Problem:** Same package at different versions across workspaces

**Solution:** Use syncpack

```bash
npx syncpack list-mismatches  # Find issues
npx syncpack fix-mismatches   # Auto-fix
```

**package.json scripts:**
```json
{
  "deps:check": "syncpack list-mismatches",
  "deps:fix": "syncpack fix-mismatches"
}
```

---

## Lock Files

### Purpose

**Guarantee reproducible installs** across machines and CI/CD.

| Package Manager | Lock File | Key Feature |
|----------------|-----------|-------------|
| npm | `package-lock.json` | Standard |
| pnpm | `pnpm-lock.yaml` | Strict peer deps |
| yarn | `yarn.lock` | Berry or Classic |

### Critical Rules

**✅ DO:**
- Always commit lock files
- Update lock file when changing dependencies
- Use `npm ci` in CI/CD (not `npm install`)
- Resolve lock file merge conflicts by running install

**❌ DON'T:**
- Add lock files to .gitignore
- Manually edit lock files
- Mix package managers (causes conflicts)

### CI/CD Commands

**Use these for reproducibility:**

```bash
# npm
npm ci  # Clean install from lock (fails if out of sync)

# pnpm
pnpm install --frozen-lockfile  # Fail if lockfile needs update

# yarn
yarn install --immutable  # Fail if lockfile changes
```

### Lock File Maintenance

**Periodic updates:**

```bash
npm update      # Update within package.json constraints
npm outdated    # Check what would be updated
npm install     # Regenerate lock file
```

---

## Quick Reference

### Check Package Dates

```bash
npm view <package> time
npm view typescript time  # See all version dates
```

### Audit Commands

```bash
npm audit                 # Check vulnerabilities
npm audit fix             # Safe fixes
npm audit fix --force     # Breaking fixes (careful!)
npm audit --json          # Detailed report
```

### Monorepo Commands

```bash
# Run in all workspaces
npm run build -ws
npm run test --workspaces

# Run in specific workspace
npm run build -w packages/api

# Add dep to workspace
npm install express -w packages/api
```

### Version Update Commands

```bash
npm outdated              # Check outdated packages
npm update                # Update within ranges
npm update <package>      # Update specific package
npm install <package>@latest  # Install latest (updates package.json)
```

---

**Back to:** [TypeScript Developer Skill](SKILL.md)
