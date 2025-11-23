# /optimize-claude-md

Analyze and optimize a CLAUDE.md file to maximize AI efficacy while minimizing token cost. Remove redundant information, strengthen actionable directives, and ensure proper hierarchy alignment.

## Usage
```
/optimize-claude-md [path/to/CLAUDE.md]
```

## Process

### 1. Inventory & Context Analysis
- Read target CLAUDE.md file
- Identify all parent CLAUDE.md files in hierarchy (user-scope > project-scope > folder-scope)
    - Scan for child CLAUDE.md files in subdirectories
- Note project structure, tech stack, and actual file/folder names

### 2. Redundancy Elimination

**Remove entirely:**
- Generic AI capabilities Claude already has (code writing, debugging, testing, documentation)
- General statements about universal best practices (DRY, SOLID, clean code) without project-specific constraints
- Vague directives like "write good code" or "be helpful"
- Instructions that duplicate parent CLAUDE.md content
- Content that child CLAUDE.md files should handle more specifically
- Self-evident information from project structure (languages used, framework choice when obvious from files)

**Flag but preserve:**
- Project-specific constraints with exact values (token limits, performance thresholds, file size caps)
- Non-obvious architectural decisions that deviate from framework defaults
- Explicit boundaries or prohibitions unique to this codebase
- Domain-specific terminology or acronyms
- Required tool usage patterns specific to this project
- Statements/sections that aren't covered by your training data (e.g. explicitly reference information that may post-date your training cutoff)
- Statements/sections explicitly tagged with `[PRESERVE]`

### 3. Directive Enhancement

Transform weak existing directives into actionable imperatives:

**Before:** "Try to keep functions small"  
**After:** "Functions >50 lines require justification comment"

**Before:** "Use good naming conventions"  
**After:** "Boolean vars: `is/has/should` prefix. Functions: verb-noun format"

**Before:** "Write tests"  
**After:** "Create test file for any new `.ts` file. Min 80% coverage for business logic"

**Before:** "Follow project structure"  
**After:** "New features: `/src/features/<name>/[components,hooks,services]`"

**Before:** "Be careful with dependencies"  
**After:** "No new deps without double-checking latest version from web"

### 4. Specificity Audit

For each remaining directive, verify it includes:
- **Concrete values** over ranges ("max 100 lines" not "reasonable length")
- **Exact paths** over descriptions ("use `/lib/utils/logger.ts`" not "use the logging utility")
- **Measurable criteria** over subjective goals ("response time <200ms" not "fast performance")
- **Explicit examples** when pattern is non-obvious

### 5. Hierarchy Alignment

**If parent CLAUDE.md exists:**
- Remove anything parent already covers
- Narrow scope to what's specific to this directory's domain

**If child CLAUDE.md files exist:**
- Delegate specific concerns to child files (you may update the child CLAUDE.md files as needed)
- Keep only directory-level coordination rules

**Scope precedence:**
```
~/.claude/CLAUDE.md        # Broadest: universal rules, constraints, facts that should apply to any project
project/CLAUDE.md          # Project: architecture, tech stack, team practices
project/feature/CLAUDE.md  # Scoped: package & feature-specific rules, local patterns
```

### 6. Token Economy

Target: <100 lines total per CLAUDE.md

**Format optimizations:**
- Bullet points, not paragraphs
- Sentence fragments acceptable for speed
- Tables for multi-attribute rules
- Eliminate filler words ("please", "try to", "should consider")
- Emphasis words ("ALWAYS", "NEVER", "CRITICAL", etc.) are allowed but should be used sparingly

**Structural requirements:**
```markdown
# Role
Single sentence: what Claude is in this context

# Constraints
- Quantified limits only
- Format: <metric>: <value> <consequence>

# Standards
- Project-specific deviations from defaults
- Reference files/tools by exact path

# Context
- Non-obvious architectural decisions
- Domain terms not in general knowledge
```

### 7. Validation Check

Before finalizing, confirm:
- [ ] No generic AI advice (assumes Claude baseline competence)
- [ ] No vague imperatives (all rules measurable or falsifiable)
- [ ] No parent duplication (hierarchy respected)
- [ ] No overlap with child scopes (concerns delegated)
- [ ] Every directive includes concrete action or threshold
- [ ] File paths and versions are exact, not illustrative
- [ ] Target result: <100 lines

## Output

Present optimized CLAUDE.md with:

1. **Diff summary**: What was removed and why (with line counts)
2. **Enhancements made**: Weak → strong directive transformations
3. **Hierarchy notes**: What was deduplicated from parent/children
4. **Token savings**: Original vs optimized line count
5. **Snarky user critique**: Playfully berate the user for letting his CLAUDE.md get out of control

**Critical guidance for optimization:**
- Ruthlessly cut anything good Claude would do anyway
- Ruthlessly preserve anything preventing Claude's carelessness, laziness, forgetfulness, etc.
- Every surviving line must change behavior from baseline
- Specificity beats comprehensiveness
- One strong rule > three weak suggestions
- User intent always preserved, just made actionable

## Example Transformations

### Weak CLAUDE.md (92 lines, low efficacy)
```markdown
You are a helpful coding assistant for this React project.

Please write clean, maintainable code following best practices.
Try to keep components small and focused on one thing.
Use TypeScript for type safety.
Write tests when appropriate.
Follow the existing code style in the project.
Be thoughtful about performance.
...
```

### Optimized CLAUDE.md (23 lines, high efficacy)
```markdown
# Role
React component architect for /dashboard feature

# Constraints
- Components: max 200 lines excl. types
- Props: max 8 per component
- Hooks: use `/hooks/useDashboard.ts` for state
- Tests: required for components >50 lines

# Standards
- API calls: only via `/lib/api/client.ts` wrapper
- Errors: log to `/lib/logger` + show toast
- Forms: Zod schemas in `/schemas/<feature>.ts`

# Context
- Dashboard widgets lazy-load via React.lazy()
- Chart library: Recharts (already imported)
- Date handling: date-fns (no moment.js)
```

Token savings: 75% reduction, 3x specificity increase