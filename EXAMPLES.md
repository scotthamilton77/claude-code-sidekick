# Claude Command Examples

This document provides practical examples of how to use the Claude command framework.

## Core Commands

### `agent-start`

Start a new agent session:

```bash
claude agent-start --name "my-agent" --prompt "Refactor the authentication module."
```

### `agent-status`

Check the status of an agent:

```bash
claude agent-status --name "my-agent"
```

## Workflow Examples

### Project Initialization

1.  **Initialize the project structure:**

    ```bash
    claude init-project --name "new-web-app" --template "react-ts"
    ```

2.  **Analyze dependencies:**

    ```bash
    claude analyze-deps
    ```

3.  **Generate CI/CD pipeline:**

    ```bash
    claude ci-gen --platform "github-actions"
    ```
