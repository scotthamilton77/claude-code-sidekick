# Base DevContainer Template

Minimal, opinionless devcontainer for Node.js projects.

## What's Included

- **Node.js 20**: Latest LTS version
- **Essential Tools**: git, curl, wget, vim, nano, jq, tree
- **VS Code Extensions**: Prettier, ESLint
- **Sudo Access**: Passwordless sudo for node user

## What's NOT Included

- No database connections
- No Docker-in-Docker
- No AI tools
- No custom mounts
- No port forwarding
- No API keys

## Usage

1. Copy contents to your project's `.devcontainer/` directory
2. Customize as needed:
   - Add mounts to `devcontainer.json`
   - Add ports to forward
   - Add environment variables
   - Add system packages to `Dockerfile`
   - Add tooling to `post-create.sh`
3. Open in VS Code and select "Reopen in Container"

## Customization Points

### Add System Packages

Edit `Dockerfile` and add to the apt-get install list:

```dockerfile
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
    your-package-here \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
```

### Add Port Forwarding

Edit `devcontainer.json`:

```json
"forwardPorts": [3000, 5432],
"portsAttributes": {
  "3000": { "label": "Web App", "onAutoForward": "notify" }
}
```

### Add Environment Variables

Edit `devcontainer.json`:

```json
"remoteEnv": {
  "API_KEY": "${localEnv:API_KEY}"
}
```

### Add Project-Specific Setup

Create `.devcontainer/project-setup.sh` for custom initialization that runs after `post-create.sh`.
