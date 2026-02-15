# Sidekick DevContainer

Development container for the Claude Code Sidekick project.

## Quick Start

1. **Set up secrets on host** (see [API Keys](#api-keys) below)

2. **Open in VS Code:**
   - Command Palette → "Dev Containers: Reopen in Container"
   - Wait for build and post-create setup

## What's Included

- **Node.js 24**: Matches host version
- **Python 3**: With pip, venv, dev headers
- **Power Tools**: ripgrep, fzf, fd-find, jq, yq, tree, tmux, htop, ncdu
- **Editors**: vim, nano
- **Network Tools**: ping, dig, netcat, telnet, traceroute, tcpdump, net-tools
- **Process Tools**: lsof, strace
- **Utilities**: gawk, bc, rsync, patch, curl, wget, zip/unzip
- **GitHub CLI**: gh for GitHub operations
- **VS Code Extensions**: Prettier, ESLint, TypeScript, YAML
- **Sudo Access**: Passwordless sudo for node user
- **Homebrew**: Linux package manager (for beads and other tools)
- **[agents-config](https://github.com/scotthamilton77/agents-config)**: Claude configuration and scripts, cloned to `/workspaces/agents-config`
- **[beads](https://github.com/steveyegge/beads)**: AI-native issue tracking (`bd` CLI), installed via Homebrew with Claude plugin

## Optional Tools

Controlled via `remoteEnv` in `devcontainer.json`:

| Flag | Default | Tool |
|------|---------|------|
| `INSTALL_CLAUDE_CODE` | `true` | Claude Code CLI |
| `INSTALL_GEMINI_CLI` | `true` | Gemini CLI |
| `INSTALL_CODEX_CLI` | `true` | OpenAI Codex CLI |
| `INSTALL_UV` | `true` | uv (Python package manager) |
| `PYTHON_VERSION` | `latest` | Python version for uv to install |

Set any flag to `"false"` in `devcontainer.json` to skip that tool.

## API Keys

API keys are provided via a `~/.secrets` bind mount (read-only) rather than individual environment variables.

### Setup

1. **Create a secrets file on your host:**

   ```bash
   # ~/.secrets
   export ANTHROPIC_API_KEY=sk-ant-...
   export OPENAI_API_KEY=sk-...
   export GOOGLE_API_KEY=...
   ```

2. **The container sources `~/.secrets` automatically** at shell startup and during post-create setup.

### Why not `remoteEnv`?

- Secrets stay in one place (`~/.secrets`) instead of scattered across shell rc files
- Read-only mount prevents accidental writes from inside the container
- Same pattern works across all devcontainers without per-key configuration

## Customization

### Add More Mounts

Edit `devcontainer.json`:

```json
"mounts": [
  "source=${localEnv:HOME}/.secrets,target=/home/node/.secrets,type=bind,readonly",
  "source=${localEnv:HOME}/.claude,target=/home/node/.claude,type=bind,consistency=cached"
]
```

### Add System Packages

Edit `Dockerfile`:

```dockerfile
RUN apt-get update && apt-get -y install --no-install-recommends \
    your-package-here
```

### Project-Specific Setup

Create `.devcontainer/project-setup.sh` — it runs automatically at the end of post-create if present.

## Troubleshooting

### AI Tool Installation Fails

Claude Code is installed via its official installer (`curl -fsSL https://claude.ai/install.sh | bash`), not npm. Other AI CLI tools use npm global installs. Check installation logs in post-create output.

### Secrets Not Available

1. Verify `~/.secrets` exists on your host
2. Ensure it uses `export VAR=value` syntax
3. Rebuild container after adding the mount

### pnpm Issues

The container uses `corepack enable pnpm` which respects the `packageManager` field in `package.json`. If pnpm isn't found, check that corepack is available in the base image.
