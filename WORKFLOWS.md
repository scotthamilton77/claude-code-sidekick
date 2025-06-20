# Command Workflows

This document outlines common workflows, demonstrating how to chain multiple commands together to accomplish complex tasks. These workflows are designed to streamline development, analysis, and deployment processes.

## 1. Project Initialization and Analysis

This workflow is ideal for starting a new project or analyzing an existing one. It initializes the agent, analyzes dependencies, and loads relevant context for the task at hand.

**Workflow:** `agent-init` -> `analyze-deps` -> `context-load-*`

1.  **`agent-init`**: Initializes the agent in the project directory, setting up the necessary configuration and context.
2.  **`analyze-deps`**: Scans the project to identify and analyze dependencies, providing insights into the project's structure and libraries.
3.  **`context-load-*`**: Loads specific context for the technology stack, such as `context-load-deno-fresh` for Deno/Fresh projects or `context-load-go-web` for Go web applications.

## 2. Iterative Development and Testing

A typical loop for feature development, involving writing code, running tests, and linting to ensure quality.

**Workflow:** `dev` -> `test` -> `lint`

1.  **`dev`**: Starts the development environment or task. This could involve generating boilerplate code, setting up a file watcher, or running a development server.
2.  **`test`**: Executes the test suite against the changes. The `--watch` flag can be used for continuous testing.
3.  **`lint`**: Runs the linter to check for code style and quality issues. The `--fix` flag can automatically correct problems.

## 3. Performance Optimization

When you need to identify and resolve performance bottlenecks in an application.

**Workflow:** `bottleneck` -> `refactor` -> `benchmark`

1.  **`bottleneck`**: Analyzes the codebase to identify performance-critical areas and potential bottlenecks.
2.  **`refactor`**: Applies automated refactoring to the identified areas to improve performance or readability.
3.  **`benchmark`**: Runs benchmarks to measure the impact of the changes and validate performance improvements.

## 4. Bug Investigation and Fixing

A structured approach to finding and fixing bugs.

**Workflow:** `search` -> `debug` -> `bug-fix`

1.  **`search`**: Use text or semantic search to locate relevant code sections related to the bug report.
2.  **`debug`**: Initiates a debugging session or provides debugging assistance for the located code.
3.  **`bug-fix`**: Engages the agent to automatically generate a fix for the identified bug.

## 5. Release and Deployment

A workflow for preparing and executing a new release and deployment.

**Workflow:** `changelog` -> `release` -> `deploy`

1.  **`changelog`**: Generates a changelog from commit history since the last release.
2.  **`release`**: Creates a new release, which may involve tagging, building artifacts, and publishing packages.
3.  **`deploy`**: Deploys the new release to a specified environment (e.g., staging, production).
