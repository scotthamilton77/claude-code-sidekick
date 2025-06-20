# Claude Commands Reference

This document provides a high-level overview of the available Claude commands, grouped by functional category. These commands are designed to assist with various stages of the software development lifecycle, from planning and research to coding and deployment.

## Agent Framework

This group of commands facilitates multi-agent workflows. They provide the foundation for coordinating multiple AI agents to work on a project collaboratively, managing task assignments, agent initialization, and status tracking to enable complex, parallelized development.

- **`agent-assign`**: Assigns a task to a specific agent.
- **`agent-complete`**: Marks the current task as complete.
- **`agent-init`**: Initializes a new agent with a specific role and goal.
- **`agent-start`**: Starts an agent working on a task.
- **`agent-status`**: Checks the status of active agents.
- **`coordinate`**: Coordinates tasks between multiple agents.

- **Researcher Notes:** This category is foundational for autonomous workflows. The `agent-init` and `agent-start` commands kick off the process, while `agent-assign` and `agent-status` are used for ongoing management. The `coordinate` command suggests a higher-level orchestration capability, likely for synchronizing multiple agents working on different sub-tasks of a larger goal. This category has strong connections to **Planning & Task Management**, as agents will be assigned tasks defined there.

## Planning & Task Management

Commands in this category are used for project planning and task management. They allow for the creation and management of hierarchical task structures, breaking down large epics into smaller, actionable items. This integrated system helps track progress and dependencies throughout the project.

- **`epic`**: Manages large-scale, cross-repository epics.
- **`issue`**: Creates a new issue or ticket.
- **`spec`**: Creates a technical specification for a feature.
- **`start`**: Begins work on a task.
- **`status`**: Displays the current project status.
- **`stop`**: Stops work on the current task.
- **`todo`**: Manages a local to-do list.

- **Researcher Notes:** This is the project management hub. `epic` is the top-level command for large initiatives, which can be broken down with `spec` and `issue`. The `todo` command seems to be for more granular, developer-level tasks. The `start`, `stop`, and `status` commands are the core execution loop for a task. This category is the primary input for the **Agent Framework** and the **Git Workflow Automation** categories.

## Git Workflow Automation

These commands streamline and automate common Git operations. They enforce best practices by generating conventional commit messages, creating detailed and well-structured pull requests, and assisting with the release process.

- **`commit`**: Creates a conventional commit message for staged changes.
- **`cpr`**: Creates a pull request with a detailed description.
- **`git-log`**: Displays a summarized Git log.
- **`pr`**: Creates a pull request with a detailed description.
- **`pull-request`**: Creates a pull request with a detailed description.
- **`release`**: Automates the software release process.
- **`version`**: Bumps the project version and creates a tag.

- **Researcher Notes:** This category automates the core developer workflow. `commit` and `pr` (or `cpr`/`pull-request`, which seem to be aliases) are the most common commands. `release` is a high-level command that likely uses the others to perform a release. The `git-log` and `version` commands are for information gathering. This category is often the final step in a task that was initiated in the **Planning & Task Management** category.

## Code & Project Generation

This set of commands helps bootstrap new projects, modules, or individual components. They use predefined templates and scaffolding to quickly generate boilerplate code, ensuring consistency and adherence to project standards.

- **`generate-code`**: Generates code based on a prompt.
- **`generate-diagram`**: Creates a diagram from a description.
- **`generate-docs`**: Generates documentation for a file or directory.
- **`generate-tests`**: Generates tests for a file or directory.
- **`github-actions-workflow`**: Creates a new GitHub Actions workflow.
- **`module`**: Creates a new module in the project.
- **`new-project`**: Creates a new project from a template.

- **Researcher Notes:** This category is for starting new work. `new-project` and `module` are for creating new projects and modules, respectively. The `generate-*` commands are for creating specific components like code, diagrams, docs, and tests. `github-actions-workflow` is a specialized generator for CI/CD. This category is often a precursor to work in the **Refactoring & Code Improvement** and **Testing & Validation** categories.

## Context & Knowledge Loading

These commands are used to load specific technical knowledge into the AI's working context. They can fetch documentation for frameworks, libraries, or specific domains, ensuring the AI has the necessary information to perform tasks accurately.

- **`context-load-*`**: Loads a specific, pre-defined context.
- **`load-context`**: Loads a context from a file.

- **Researcher Notes:** This is a critical category for providing the AI with the information it needs to do its job. The `context-load-*` commands are for loading specific, pre-defined contexts, while `load-context` is for loading from a file. This category is a dependency for almost all other categories, as the AI needs context to perform any task.

## Project Documentation

This category includes tools for creating, updating, and managing project documentation. There is a strong focus on generating and maintaining sites built with Docusaurus, automating the creation of guides, API references, and other content.

- **`api-docs`**: Generates API documentation.
- **`changelog`**: Generates a changelog from Git history.
- **`docusaurus`**: Manages a Docusaurus documentation site.
- **`readme`**: Generates a README file.

- **Researcher Notes:** This category is for keeping the project well-documented. `readme`, `changelog`, and `api-docs` are for generating specific documentation files. `docusaurus` is a specialized command for managing Docusaurus sites. This category is often used in conjunction with the **Git Workflow Automation** category to update documentation as part of a release.

## Code Analysis & Quality

These commands perform deep, static analysis of the codebase. They can be used to audit dependencies for security vulnerabilities, identify performance bottlenecks, check for outdated packages, measure test coverage, and assess overall technical debt.

- **`analyze-deps`**: Analyzes project dependencies.
- **`audit`**: Audits the codebase for issues.
- **`benchmark`**: Runs benchmarks on the code.
- **`bottleneck`**: Identifies performance bottlenecks.
- **`coverage`**: Measures test coverage.
- **`dependencies`**: Manages project dependencies.
- **`lint`**: Lints the codebase.
- **`security-audit`**: Audits the codebase for security vulnerabilities.
- **`tech-debt`**: Analyzes the codebase for technical debt.
- **`test-plan`**: Creates a test plan for a feature.

- **Researcher Notes:** This is the quality assurance hub. `audit`, `security-audit`, and `dependencies` are for managing dependencies and security. `benchmark`, `bottleneck`, and `coverage` are for performance and testing. `lint` and `tech-debt` are for code quality. `test-plan` is for planning testing efforts. This category is often used before a release to ensure the quality of the code.

## Research & Information Gathering

This group of commands allows the AI to perform web research. Capabilities range from quick, targeted searches to deep, multi-source investigations, enabling the AI to gather information, compare solutions, and make informed recommendations.

- **`api`**: Queries an API.
- **`deep-dive`**: Performs a deep-dive research on a topic.
- **`deep-web-research`**: Performs a deep-web research on a topic.
- **`github-issues`**: Searches for GitHub issues.
- **`quick-search`**: Performs a quick web search.
- **`research`**: Performs a research on a topic.
- **`search`**: Searches for information.

- **Researcher Notes:** This category gives the AI the ability to learn. `quick-search` and `search` are for general-purpose searching. `deep-dive` and `deep-web-research` are for more in-depth research. `github-issues` and `api` are for searching specific sources. This category is often used at the beginning of a task to gather information.

## Testing & Validation

These commands focus on software quality and testing. They can intelligently generate comprehensive test suites based on code analysis, help fix flaky tests, and support a test-driven development (TDD) workflow.

- **`fix-flaky-tests`**: Fixes flaky tests.
- **`http-stress-test`**: Runs a stress test on an HTTP endpoint.
- **`tdd`**: Starts a test-driven development session.
- **`test`**: Runs tests.

- **Researcher Notes:** This category is for ensuring the code works as expected. `test` is the core command for running tests. `generate-tests` is for creating new tests. `fix-flaky-tests` is for maintaining existing tests. `tdd` is for a specific development workflow. `http-stress-test` is for performance testing. This category is closely related to the **Code Analysis & Quality** category.

## Refactoring & Code Improvement

This suite of commands is designed to improve the quality of existing code. They assist with refactoring complex code into simpler forms, optimizing performance, standardizing code style, and migrating code to new patterns or technologies.

- **`clean`**: Cleans up the codebase.
- **`db-optimize`**: Optimizes the database.
- **`deno-ify`**: Converts a project to Deno.
- **`improve`**: Improves the codebase.
- **`migrate`**: Migrates the codebase.
- **`refactor`**: Refactors the codebase.
- **`style`**: Applies a style guide to the codebase.
- **`translate`**: Translates code from one language to another.
- **`update-deps`**: Updates project dependencies.
- **`upgrade`**: Upgrades the project to a new version.

- **Researcher Notes:** This category is for improving existing code. `refactor`, `improve`, and `clean` are for general-purpose code improvement. `db-optimize` is for database optimization. `deno-ify`, `migrate`, and `translate` are for migrating code. `style` and `upgrade` are for code style and dependency upgrades. This category is often used to address issues found in the **Code Analysis & Quality** category.

## Miscellaneous

This category contains a variety of commands for general-purpose development tasks. It includes tools for debugging, explaining code, generating diagrams, translating between languages, and interacting with various parts of the development environment.

- **`debug`**: Starts a debugging session.
- **`explain`**: Explains a concept or a piece of code.
- **`feedback`**: Provides feedback on the AI's performance.
- **`file-tree`**: Displays the file tree of the project.
- **`grep`**: Searches for a pattern in the codebase.
- **`install`**: Installs project dependencies.
- **`interview`**: Starts an interview session.
- **`locate-code`**: Locates a piece of code.
- **`locate-file`**: Locates a file.
- **`ls`**: Lists files in a directory.
- **`man`**: Displays the manual for a command.
- **`pwd`**: Displays the current working directory.
- **`query`**: Queries the codebase.
- **`repl`**: Starts a read-eval-print loop.
- **`requirements`**: Manages project requirements.
- **`review`**: Reviews a piece of code.
- **`run`**: Runs a command.
- **`run-book`**: Runs a runbook.
- **`setup`**: Sets up the project.
- **`shell`**: Starts a shell session.
- **`tree`**: Displays the file tree of the project.
- **`update`**: Updates the project.
- **`view-file`**: Displays the content of a file.
- **`watch`**: Watches for file changes.

- **Researcher Notes:** This is a catch-all category for commands that don't fit neatly into the other categories. It includes a wide variety of useful commands for debugging, understanding code, and interacting with the development environment.
