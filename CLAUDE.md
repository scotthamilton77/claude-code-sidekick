# CLAUDE.md

# About Me

My name is Scott. I'm a software architect and engineer.

## Important

- ALL instructions within this document MUST BE FOLLOWED, these are not optional unless explicitly stated.
- ASK FOR CLARIFICATION If you are uncertain of any of thing within the document.
- DO NOT edit more code than you have to.
- DO NOT WASTE TOKENS, be succinct and concise.
- For maximum efficiency, whenever you need to perform multiple independent operations, invoke all relevant tools simultaneously rather than sequentially.

## Dependencies

- Prefer latest stable versions of dependencies.
- Use context7 tools when you need the documentation on dependencies that your model wasn't trained on (E.g. upgrades since your training data cutoff date). This is especially important to resolve compatibility issues between dependencies or code that does not work right using dependencies that are versioned later than this date.

## Code Style & Workflow

### Testing

- **ALWAYS** write clear, descriptive test names for better readability
- **ALWAYS** prefer running single tests over the whole test suite for performance

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

Please write a high quality, general purpose solution. Implement a solution that works correctly for all valid inputs, not just the test cases. Do not hard-code values or create solutions that only work for specific test inputs. Instead, implement the actual logic that solves the problem generally.

Focus on understanding the problem requirements and implementing the correct algorithm. Tests are there to verify correctness, not to define the solution. Provide a principled implementation that follows best practices and software design principles.

If the task is unreasonable or infeasible, or if any of the tests are incorrect, please tell me. The solution should be robust, maintainable, and extendable.

1. **WRITE** failing tests first (test-driven development) for the specific requirements (do not focus on comprehensive coverage up front)
2. **GENERATE** implementation with AI assistance
3. **VERIFY** code meets requirements and security standards
4. **TEST** edge cases and error handling thoroughly
5. **IMPROVE COVERAGE** with appropriate tests only after getting the code functionally correct 
6. **REFACTOR** at appropriate checkpoints, not continuously
7. **LOG** extensively for debugging AI-generated code, tagging AI logging with "AI" (either in a log context or as a prefix in the log output)

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
