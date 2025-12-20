# DevContainer Starter Templates

**Portable, tiered devcontainer templates for Node.js projects** - from minimal to kitchen-sink configurations.

These templates eliminate the "works on my machine" problem by providing reproducible development environments with exactly the tools you need.

## 🎯 Philosophy

- **Tiered Approach**: Start minimal, add complexity as needed
- **Portable by Design**: No hardcoded usernames or paths
- **Configuration-Driven**: Control features via `.env` files
- **Composable**: Mix and match features for your needs
- **Secure by Default**: Optional features documented with security implications
- **Isolated by Default**: Containers do not mount host configuration (see below)

### Host Configuration Isolation

By default, containers created from these templates **do not** include any of the host's configuration files (such as `~/.claude/`, installed plugins, registered marketplaces, or other user-specific settings). This is intentional for portability and security.

If you need host configuration inside the container, individual templates may provide optional mount configurations. For example, `node-ai-stack` supports mounting `~/.claude` via an opt-in setting in `devcontainer.json`. See each template's README for available mount options.

## 📦 Available Templates

### 1. **base** - Minimal Foundation

**What**: Node.js 20 + essential tools
**For**: Minimal projects, starting point for custom templates
**Size**: ~500 MB
**Build Time**: ~2 minutes

```
├── Node.js 20 LTS
├── git, vim, curl, jq, tree
└── Prettier + ESLint
```

**Use when**: You want bare-bones Node.js with zero opinions

---

### 2. **node-typescript** - TypeScript Ready

**What**: Base + TypeScript tooling
**For**: TypeScript projects without external dependencies
**Size**: ~600 MB
**Build Time**: ~2.5 minutes

```
├── Everything from base
├── TypeScript + ts-node + nodemon
├── Build tools (gcc, g++, make)
└── Automatic tsc checking on post-create
```

**Use when**: Building TypeScript libraries, CLI tools, or standalone apps

---

### 3. **node-typescript-postgres** - Full-Stack Ready

**What**: node-typescript + PostgreSQL client
**For**: Backend applications with database connectivity
**Size**: ~700 MB
**Build Time**: ~3 minutes

```
├── Everything from node-typescript
├── PostgreSQL client (psql)
├── Database connection testing
├── Port forwarding (5432)
└── .env.template for DB credentials
```

**Use when**: Building REST APIs, GraphQL servers, or database-backed apps

---

### 4. **node-ai-stack** - The Kitchen Sink

**What**: Full stack + AI tools + optional installs
**For**: AI-assisted development, multi-language projects, power users
**Size**: ~1.2 GB
**Build Time**: ~5 minutes (+ optional tool installs)

```
├── Everything from node-typescript-postgres
├── Bun runtime
├── Python 3 (with pip, venv, dev headers)
├── Optional: Claude Code, Gemini CLI, Codex CLI
├── Optional: uv (Rust Python package manager)
├── Optional: specify-cli
├── Optional: Claude config mounts
├── Optional: OSS project mounts
├── Optional: Docker-in-Docker
├── Power tools: ripgrep, fzf, fd, htop, tmux
├── Network tools: tcpdump, lsof, strace
└── PM2 process manager
```

**Use when**:

- Building AI-powered applications
- Cross-project development (with mounts)
- Python + Node.js hybrid projects
- Maximum flexibility and tooling needed

---

## 🚀 Quick Start

### Automated Installation (Recommended)

Use the `install.sh` script for guided setup:

```bash
# Interactive mode - guided setup with prompts
./install.sh --interactive

# Quick install with command-line options
./install.sh --template node-typescript --target ~/my-project

# AI stack with features
./install.sh --template node-ai-stack --claude-code --uv --mount-claude

# Preview before installing
./install.sh --template node-ai-stack --dry-run
```

**📖 See [INSTALL_GUIDE.md](INSTALL_GUIDE.md) for comprehensive installation documentation**

---

### Manual Installation

If you prefer manual setup:

#### 1. Choose Your Template

```bash
# Minimal
cp -r devcontainer-templates/base/.devcontainer .

# TypeScript
cp -r devcontainer-templates/node-typescript/.devcontainer .

# TypeScript + PostgreSQL
cp -r devcontainer-templates/node-typescript-postgres/.devcontainer .

# AI Stack (Kitchen Sink)
cp -r devcontainer-templates/node-ai-stack/.devcontainer .
```

#### 2. Configure (if using node-typescript-postgres or node-ai-stack)

```bash
cd .devcontainer
cp .env.template .env
# Edit .env with your settings
```

#### 3. Customize

Edit `.devcontainer/devcontainer.json` to:

- Uncomment mounts you need (node-ai-stack)
- Add/remove ports
- Adjust VS Code extensions
- Configure environment variables

#### 4. Open in VS Code

```
Command Palette → "Dev Containers: Reopen in Container"
```

## 📋 Template Comparison

| Feature                          | base    | node-typescript | node-typescript-postgres | node-ai-stack |
| -------------------------------- | ------- | --------------- | ------------------------ | ------------- |
| Node.js 20                       | ✅      | ✅              | ✅                       | ✅            |
| TypeScript                       | ❌      | ✅              | ✅                       | ✅            |
| PostgreSQL Client                | ❌      | ❌              | ✅                       | ✅            |
| Python                           | ❌      | ❌              | ❌                       | ✅            |
| Bun                              | ❌      | ❌              | ❌                       | ✅            |
| AI CLI Tools                     | ❌      | ❌              | ❌                       | ⚙️ Optional   |
| Claude Config Mount              | ❌      | ❌              | ❌                       | ⚙️ Optional   |
| OSS Project Mounts               | ❌      | ❌              | ❌                       | ⚙️ Optional   |
| Docker-in-Docker                 | ❌      | ❌              | ❌                       | ⚙️ Optional   |
| Power Tools (ripgrep, fzf, etc.) | ❌      | ❌              | ❌                       | ✅            |
| PM2 Process Manager              | ❌      | ❌              | ❌                       | ✅            |
| Build Time                       | ~2 min  | ~2.5 min        | ~3 min                   | ~5 min        |
| Container Size                   | ~500 MB | ~600 MB         | ~700 MB                  | ~1.2 GB       |

⚙️ = Configurable via `.env` file

## 🔧 Common Customizations

### Add System Packages

Edit `.devcontainer/Dockerfile`:

```dockerfile
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
    redis-tools \
    your-package-here \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
```

### Add Port Forwarding

Edit `.devcontainer/devcontainer.json`:

```json
"forwardPorts": [3000, 5432, 6379],
"portsAttributes": {
  "3000": { "label": "API Server", "onAutoForward": "notify" },
  "5432": { "label": "PostgreSQL", "onAutoForward": "silent" },
  "6379": { "label": "Redis", "onAutoForward": "silent" }
}
```

### Add Environment Variables

Edit `.devcontainer/devcontainer.json`:

```json
"remoteEnv": {
  "NODE_ENV": "development",
  "API_KEY": "${localEnv:API_KEY}",
  "DATABASE_URL": "${localEnv:DATABASE_URL}"
}
```

### Add VS Code Extensions

Edit `.devcontainer/devcontainer.json`:

```json
"customizations": {
  "vscode": {
    "extensions": [
      "esbenp.prettier-vscode",
      "dbaeumer.vscode-eslint",
      "your-extension-here"
    ]
  }
}
```

### Add Project-Specific Setup

Create `.devcontainer/project-setup.sh` - this runs automatically after `post-create.sh`:

```bash
#!/bin/bash
set -e

echo "🔧 Running project-specific setup..."

# Your custom initialization here
npm run setup-database
npm run seed-data

echo "✅ Project-specific setup complete!"
```

Make it executable: `chmod +x .devcontainer/project-setup.sh`

## 🔒 Security Best Practices

### API Keys

- ✅ Set in host environment, pass through via `remoteEnv`
- ❌ Never commit API keys to `.env` files
- ✅ Add `.env` to `.gitignore`

### Docker Socket Mount

```json
// DANGER: Full access to host Docker daemon
"source=/var/run/docker.sock,target=/var/run/docker.sock,type=bind"
```

**Only use for:**

- Personal trusted projects
- Development environments (never production)

**Do NOT use for:**

- Untrusted code
- Projects with unaudited dependencies
- Shared/multi-tenant environments

### Database Credentials

- ✅ Use `.env` file (not committed)
- ✅ Different credentials for dev/staging/prod
- ✅ Use read-only database users when possible
- ❌ Never hardcode credentials in `devcontainer.json`

### File Mounts

- Only mount what you need
- Be aware that mounted directories have host file permissions
- Avoid mounting entire home directory

## 🎓 Template Selection Guide

### Choose **base** if:

- Building a simple Node.js project
- Want maximum control over dependencies
- Creating a custom template for specific needs
- Minimal resource usage is priority

### Choose **node-typescript** if:

- Building TypeScript libraries or CLI tools
- Don't need database connectivity
- Want type safety without extra bloat
- Standard TypeScript project structure

### Choose **node-typescript-postgres** if:

- Building REST APIs or GraphQL servers
- Need database connectivity out of the box
- Want PostgreSQL client tools available
- Standard full-stack web application

### Choose **node-ai-stack** if:

- Building AI-powered applications
- Need multiple language runtimes (Node + Python)
- Want AI assistant integration (Claude, Gemini, etc.)
- Working across multiple projects simultaneously
- Need maximum flexibility and tooling
- Power user development workflow

## 🛠️ Maintenance

### Updating Node.js Version

Edit `Dockerfile` first line:

```dockerfile
# From
FROM mcr.microsoft.com/devcontainers/javascript-node:20

# To
FROM mcr.microsoft.com/devcontainers/javascript-node:22
```

### Updating Global Packages

Edit `Dockerfile`:

```dockerfile
RUN npm install -g \
    typescript@latest \
    ts-node@latest \
    nodemon@latest
```

### Rebuilding After Changes

```
Command Palette → "Dev Containers: Rebuild Container"
```

Or rebuild without cache:

```
Command Palette → "Dev Containers: Rebuild Container Without Cache"
```

## 📚 Additional Resources

### Official Documentation

- [VS Code DevContainers](https://code.visualstudio.com/docs/devcontainers/containers)
- [DevContainer Spec](https://containers.dev/)
- [Base Images](https://github.com/devcontainers/images)

### Each Template's README

- `base/README.md` - Minimal setup guide
- `node-typescript/README.md` - TypeScript configuration
- `node-typescript-postgres/README.md` - Database connection modes
- `node-ai-stack/README.md` - Comprehensive AI stack guide

## 🤝 Contributing

Found these templates useful? Consider:

1. Sharing improvements back
2. Creating specialized templates for your stack
3. Documenting your customizations
4. Reporting issues or suggesting enhancements

## 🚦 Getting Started Checklist

- [ ] Choose appropriate template for your project
- [ ] Copy template to `.devcontainer/` directory
- [ ] Create `.env` from `.env.template` (if applicable)
- [ ] Customize mounts, ports, environment variables
- [ ] Add `.env` to `.gitignore`
- [ ] Set API keys in host environment
- [ ] Open in VS Code devcontainer
- [ ] Verify environment works correctly
- [ ] Add project-specific setup if needed
- [ ] Document customizations for your team

## 📝 License

These templates are provided as-is for personal and commercial use. Modify freely to suit your needs.

---

**Built with ❤️ for developers who value reproducible environments**

From "works on my machine" to "works in any container" - start your next project right.
