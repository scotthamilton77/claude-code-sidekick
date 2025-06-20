# CLAUDE.md

IMPORTANT: These are my development preferences and guidelines. YOU MUST follow them when working on my projects.

## Dependencies

- Prefer latest stable versions of dependencies.
- Use context7 tools when you need the documentation on dependencies that your model wasn't trained on (E.g. upgrades since your training data cutoff date). This is especially important to resolve compatibility issues between dependencies or code that does not work right using dependencies that are versioned later than this date.

## Test-Driven Development (TDD) Process

For coding _when asked to use TDD_, follow a strict "Red-Green-Refactor" cycle:

1. **Red Phase**:

   - Write a failing test for the functionality you want to implement
   - Run the test to confirm it fails (shows "red" in the test runner)
   - This validates that your test is actually testing something

2. **Green Phase**:

   - Implement the simplest code that makes the test pass
   - Focus on making it work, not making it optimal
   - Run the test to confirm it now passes (shows "green")

3. **Refactor Phase**:

   - Clean up and optimize your implementation without changing its behavior
   - Run tests after each refactor to ensure you haven't broken anything
   - Improve both the implementation code AND the test code

4. **Finalization Phase**:
   - Run full test suite to ensure no regressions: `npm run test`
   - Validate test coverage to ensure >90% coverage: `npm run test:coverage`

## Code Style & Workflow

### Testing

- **ALWAYS** write clear, descriptive test names for better readability
- **ALWAYS** prefer running single tests over the whole test suite for performance

### Language & Framework Preferences

#### Web Development

Use [Deno Fresh](https://fresh.deno.dev/) with these practices:

- Built-in test runner: `Deno.test()`
- Organize tests: `/tests/unit/`, `/tests/component/`, `/tests/e2e/`
- Mock external dependencies for fast, reliable tests
- Use fresh-testing-library for component/handler testing

#### Frontend Lessons Learned

**Styling Strategy:**

- Tailwind plugin is unreliable - implement CSS fallbacks in `static/styles.css`
- Define key utilities manually: `.min-h-screen`, `.flex`, `.items-center`, `.justify-center`
- Use AppShell pattern for consistent layout wrapper

**ConnectRPC Integration:**

- Use API proxy routes in `routes/api/[...path].ts` for backend communication
- Set up transport with `baseUrl: "/api"` for client-side RPC calls
- Use buf.build packages via npm imports for type safety

**Critical Notes:**

- Always have CSS fallbacks when Tailwind plugin fails to generate utilities
- Island architecture: `islands/` for interactive, `components/` for static

## Modern Development Tools

### Output Format Preferences

**ALWAYS** prefer JSON output for parsing when available:

- Use `-o json` or `--json` flags when available (e.g., `kubectl get nodes -o json`)
- Parse structured JSON output instead of text formats for reliability

## Development Workflow

1. **ALWAYS** run type checking/linting after code changes
2. **ALWAYS** format code before committing using project's formatter
3. **ALWAYS** run relevant tests before pushing changes
4. **NEVER** commit without running pre-commit checks
5. **ALWAYS** use semantic commit messages (feat:, fix:, docs:, refactor:, test:, chore:)

### AI-Assisted Development Pattern

1. **WRITE** failing tests first (test-driven development)
2. **GENERATE** implementation with AI assistance
3. **VERIFY** code meets requirements and security standards
4. **TEST** edge cases and error handling thoroughly
5. **REFACTOR** at appropriate checkpoints, not continuously
6. **LOG** extensively for debugging AI-generated code, tagging AI logging with "AI" (either in a log context or as a prefix in the log output)

### Context Management

- **PROVIDE** clear, specific requirements to minimize context gaps
- **INCLUDE** relevant project context in prompts
- **DOCUMENT** assumptions and decisions in code comments

## Project Planning & Coordination

### PLAN.md Adherence

When a `PLAN.md` file exists in the project root, **YOU MUST**:

1. **READ** the PLAN.md file at the start of each session to understand current tasks and priorities
2. **FOLLOW** the task breakdown and execution strategy defined in the plan
3. **RESPECT** task dependencies and join points for multi-agent coordination
4. **UPDATE** task status in the plan as work progresses
5. **COORDINATE** with other agents at defined synchronization points
6. **USE** the TodoWrite tool to track individual tasks from the plan

### Multi-Agent Workflow

When working as part of a multi-agent team:

- **CHECK** `/tmp/{project-name}/project-status.md` or coordination files for shared state
- **WORK** only on assigned tasks to avoid conflicts
- **COMMUNICATE** progress through PR comments or status files
- **WAIT** at join points until all parallel work is complete
- **MERGE** work carefully following the plan's integration strategy
- **USE** git worktrees to work on separate branches without conflicts
- **CREATE** status files in `/tmp/{project-name}/claude-scratch/` for inter-agent communication
- **COORDINATE** using shared JSON status files for structured updates in project-specific directories

## Performance & Optimization

### Token Efficiency

- **OPTIMIZE** prompts for clarity and brevity
- **BATCH** related operations in single requests
- **USE** structured outputs (JSON) for parsing efficiency
- **CACHE** common patterns and solutions locally

### Parallel Development

- **USE** Docker containers for isolated AI agent environments
- **IMPLEMENT** clear synchronization points for multi-agent work
- **MAINTAIN** shared state files in `/tmp/{project-name}/`

## Task Management

Use the task management system for tracking work items:

- **Location**: Tasks are stored in `/tasks/` directory with `status.json` index
- **Commands**: Use `/task-create`, `/task-update`, `/task-list`, `/task-show`, `/task-log`, `/task-search`, `/task-archive`
- **Format**: Tasks are markdown files with structured metadata
- **Integration**: Active tasks sync with TodoWrite for session tracking

## File Organization

- `/src/` - Source code
- `/tests/` - Test files organized by type
- `/scripts/` - Deno automation scripts
- `/tasks/` - Task management files (markdown + status.json)

## Documentation Style

### README Files

**KEEP README FILES CONCISE AND SCANNABLE:**

- **Maximum 100 lines** for most projects
- **No excessive emojis** or decorative elements
- **Essential sections only**: Purpose, Quick Start, Key Commands
- **No verbose explanations** - let code and comments speak
- **Single quick start command** when possible
- **Brief feature lists** without detailed descriptions
- **Minimal project structure** - only if complex
- **Essential links only** - avoid resource dumps

## Claude Code Features

### Thinking Modes

- `think` - Standard mode (4,000 tokens)
- `think hard` - Enhanced analysis
- `think harder` - Deep computation
- `ultrathink` - Maximum analysis (31,999 tokens)

### Effective Usage

- **USE** thinking modes for complex architectural decisions
- **AVOID** over-thinking simple tasks
- **BALANCE** computation time with task complexity

## IMPORTANT Notes

- **YOU MUST** follow these guidelines exactly as written
- **ALWAYS** ask for clarification if requirements conflict
- **NEVER** use deprecated patterns or old import styles
- **ALWAYS** prioritize simplicity and type safety
