# Node AI Stack DevContainer Template

**The Kitchen Sink Edition** - Full-featured devcontainer for AI-powered Node.js development with optional Claude Code, LLM CLI tools, Python tooling, and PostgreSQL connectivity.

This is a **maximalist template** designed for developers building AI-assisted applications. It's portable and configurable - you control what gets installed via `.env` configuration.

## What's Included (Base)

- **Node.js 20**: Latest LTS version
- **TypeScript**: Global installation with ts-node and nodemon
- **Bun**: Alternative JavaScript runtime
- **Build Tools**: Comprehensive compilation toolchain (gcc, g++, make)
- **Python 3**: With pip, venv, dev headers
- **Database Client**: PostgreSQL client (psql)
- **Power Tools**: ripgrep, fzf, fd-find, jq, tree, tmux
- **Network Tools**: ping, dig, netcat, telnet, traceroute, tcpdump
- **Process Tools**: htop, ncdu, lsof, strace
- **Package Managers**: npm, bun, optional uv (Rust-based Python manager)
- **GitHub CLI**: gh for GitHub operations
- **PM2**: Production process manager
- **VS Code Extensions**: Prettier, ESLint, TypeScript, YAML, PostgreSQL
- **Sudo Access**: Passwordless sudo for node user

## What's Optional (Configure via .env)

- **AI CLI Tools**: Claude Code, Gemini CLI, OpenAI Codex CLI
- **Python Tooling**: uv package manager, specify-cli
- **Claude Config**: Mount your personal Claude configuration
- **OSS Projects**: Mount external project directories
- **Docker-in-Docker**: Access host Docker socket
- **PostgreSQL**: External database connection
- **API Keys**: Pass through AI service credentials

## Quick Start

1. **Create configuration:**

   ```bash
   cd .devcontainer
   cp .env.template .env
   ```

2. **Edit `.env` with your settings:**

   ```bash
   # Optional - enable what you need
   INSTALL_CLAUDE_CODE=true
   INSTALL_UV=true
   MOUNT_CLAUDE_CONFIG=true
   ```

3. **Customize mounts in `devcontainer.json`:**
   - Uncomment the mount configurations you need
   - Docker socket for Docker-in-Docker
   - Claude config for AI assistant integration
   - OSS projects for cross-project development

4. **Open in VS Code:**
   - Command Palette → "Dev Containers: Reopen in Container"
   - Wait for build and post-create setup

## Configuration Guide

### .env Configuration

The `.env` file controls all optional features. Copy `.env.template` and customize:

#### AI Tool Installation

```bash
INSTALL_CLAUDE_CODE=true     # Install Claude Code CLI
INSTALL_GEMINI_CLI=false     # Install Google Gemini CLI
INSTALL_CODEX_CLI=false      # Install OpenAI Codex CLI
INSTALL_UV=true              # Install uv (Rust Python package manager)
INSTALL_SPECIFY_CLI=false    # Install specify-cli from GitHub
PYTHON_VERSION=3.12.3        # Python version for uv
```

#### Mount Configuration

```bash
# Mount your Claude configuration (uses ${localEnv:HOME}/.claude)
MOUNT_CLAUDE_CONFIG=true

# Mount external OSS projects (path relative to HOME)
MOUNT_OSS_PROJECTS=true
OSS_PROJECTS_PATH=projects/oss
OSS_PROJECT_1=zen-mcp-server
OSS_PROJECT_2=claude-code-tamagotchi
```

#### Database Configuration

```bash
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=myapp_dev
POSTGRES_USER=myapp_user
POSTGRES_PASSWORD=your_password
DOCKER_NETWORK=postgres_default  # If using Docker container
```

### devcontainer.json Customization

After configuring `.env`, edit `devcontainer.json` to enable mounts:

```json
"mounts": [
  // Uncomment to enable Docker-in-Docker
  "source=/var/run/docker.sock,target=/var/run/docker.sock,type=bind",

  // Uncomment to mount Claude configuration
  "source=${localEnv:HOME}/.claude,target=/home/node/.claude,type=bind,consistency=cached",

  // Uncomment to mount OSS projects
  "source=${localEnv:HOME}/${localEnv:OSS_PROJECTS_PATH}/${localEnv:OSS_PROJECT_1},target=/workspace/oss/${localEnv:OSS_PROJECT_1},type=bind,consistency=cached"
]
```

## API Keys

Set API keys in your **host shell environment**, NOT in `.env`:

```bash
# Add to ~/.bashrc or ~/.zshrc on your host machine
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_API_KEY=...
export PERPLEXITY_API_KEY=...
export OPENROUTER_API_KEY=...
export MISTRAL_API_KEY=...
export GROQ_API_KEY=...
export XAI_API_KEY=...
```

These are automatically forwarded to the container via `devcontainer.json`.

## Usage Examples

### Minimal Setup (No AI Tools)

```bash
# .env
INSTALL_CLAUDE_CODE=false
INSTALL_UV=false
# Leave all mounts commented in devcontainer.json
```

### Claude Code Developer Setup

```bash
# .env
INSTALL_CLAUDE_CODE=true
MOUNT_CLAUDE_CONFIG=true

# devcontainer.json - uncomment:
"mounts": [
  "source=${localEnv:HOME}/.claude,target=/home/node/.claude,type=bind,consistency=cached"
]
```

### Full AI Stack Setup

```bash
# .env
INSTALL_CLAUDE_CODE=true
INSTALL_GEMINI_CLI=true
INSTALL_UV=true
INSTALL_SPECIFY_CLI=true
MOUNT_CLAUDE_CONFIG=true
POSTGRES_HOST=localhost
POSTGRES_DB=myapp_dev

# devcontainer.json - uncomment Claude config mount + database runArgs
```

### Cross-Project Development

```bash
# .env
MOUNT_OSS_PROJECTS=true
OSS_PROJECTS_PATH=projects/oss  # Relative to HOME
OSS_PROJECT_1=shared-library
OSS_PROJECT_2=common-utils

# devcontainer.json - uncomment OSS project mounts
# Access at /workspace/oss/shared-library and /workspace/oss/common-utils
```

## Security Considerations

### Docker Socket Mount

```json
"source=/var/run/docker.sock,target=/var/run/docker.sock,type=bind"
```

**WARNING**: This gives the container full access to your host Docker daemon. Only use for:

- Trusted personal projects
- Development environments (never production)
- When you need Docker-in-Docker capabilities

**DO NOT USE** for:

- Untrusted code
- Projects with external dependencies you haven't audited
- Shared development environments

### API Keys

- Never commit API keys to `.env` file
- Always set keys in host environment
- Add `.env` to `.gitignore`
- Use separate keys for development vs. production

## Development Workflow

### AI-Assisted Development

```bash
# If Claude Code installed
claude-code

# If Gemini CLI installed
gemini chat

# If using mounted Claude config
# Your commands, plugins, and preferences are automatically available
```

### TypeScript Development

```bash
npx tsc --noEmit              # Type checking
npx ts-node src/index.ts      # Run TypeScript directly
npx nodemon src/index.ts      # Watch mode
npm run build                 # Compile to JavaScript
```

### Database Operations

```bash
psql -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -d $POSTGRES_DB
```

### Python Development (if uv installed)

```bash
uv python install 3.12.3      # Install Python version
uv pip install requests       # Install packages
uv run script.py              # Run scripts
```

### Process Management

```bash
pm2 start src/index.js        # Start process
pm2 list                      # List processes
pm2 logs                      # View logs
pm2 stop all                  # Stop all processes
```

## Troubleshooting

### AI Tool Installation Fails

Some AI CLI tools may not be publicly available yet. Check installation logs in post-create output.

### Claude Config Not Loading

1. Verify `CLAUDE_CONFIG_PATH` in `.env` points to correct directory
2. Ensure mount is uncommented in `devcontainer.json`
3. Check file permissions on host (should be readable by your user)

### Database Connection Fails

1. Verify PostgreSQL is running (`docker ps` or `systemctl status postgresql`)
2. Check `.env` credentials match your database
3. If using Docker network, ensure `DOCKER_NETWORK` is correct
4. Uncomment `runArgs` in `devcontainer.json` for Docker networking

### OSS Project Mounts Empty

1. Verify `OSS_PROJECTS_PATH` exists on host
2. Check `OSS_PROJECT_1` directory exists in that path
3. Ensure mount syntax in `devcontainer.json` is correct
4. Rebuild container after changing mounts

## Customization

### Add More AI Tools

Edit `post-create.sh`:

```bash
if [ "$INSTALL_YOUR_TOOL" = "true" ]; then
  npm install -g your-ai-tool
fi
```

Add flag to `.env.template` and `devcontainer.json` remoteEnv.

### Add System Packages

Edit `Dockerfile`:

```dockerfile
RUN apt-get update && apt-get -y install --no-install-recommends \
    your-package-here
```

### Add More Mounts

Edit `devcontainer.json`:

```json
"mounts": [
  "source=${localEnv:YOUR_PATH},target=/workspace/mount,type=bind"
]
```

### Change Ports

Edit `devcontainer.json`:

```json
"forwardPorts": [3000, 5432, 6379],
"portsAttributes": {
  "6379": { "label": "Redis", "onAutoForward": "silent" }
}
```

## Comparison to Other Templates

**vs. base**: Adds massive tooling, AI integration, mounts, Python
**vs. node-typescript**: Adds AI tools, Python, advanced system tools, mounts
**vs. node-typescript-postgres**: Adds AI tools, Python, mounts, optional installs

Choose this template when you need:

- AI-assisted development (Claude, Gemini, etc.)
- Cross-project development with mounts
- Python + Node.js hybrid projects
- Maximum tooling and flexibility
- Power user development environment

## Contributing

This template is designed to be a starting point. Fork and customize for your needs:

- Remove tools you don't use (trim Dockerfile)
- Add your preferred AI tools
- Adjust mount patterns for your workflow
- Share improvements back to the community

## License

This template is provided as-is for personal and commercial use. Modify freely.
