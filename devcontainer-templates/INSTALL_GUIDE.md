# DevContainer Template Installation Guide

Complete guide to using the `install.sh` script for automated devcontainer setup.

## Quick Start

```bash
# Interactive mode (recommended for first-time users)
./install.sh --interactive

# Quick install with defaults
./install.sh --template node-typescript

# Dry run to preview changes
./install.sh --template node-ai-stack --dry-run

# Install to specific directory
./install.sh --template node-typescript-postgres --target ~/my-project
```

## Installation Modes

### 1. Interactive Mode (Recommended)

Guided step-by-step configuration with prompts:

```bash
./install.sh --interactive
```

The script will:

- Present template options with descriptions
- Prompt for target directory
- Ask about optional features (based on template)
- Show configuration summary
- Request confirmation before proceeding

**Perfect for:**

- First-time users
- Exploring template options
- Projects with specific requirements

---

### 2. Command-Line Mode

Direct installation with command-line arguments:

```bash
./install.sh --template node-typescript --target ~/project
```

**Perfect for:**

- Quick installations
- Automation/scripting
- Users familiar with templates

---

### 3. Configuration File Mode

Pre-configure defaults in `install.conf`:

```bash
# Edit install.conf with your preferences
vim install.conf

# Run installer (uses config defaults)
./install.sh
```

**Perfect for:**

- Team standardization
- Repeated installations
- Enterprise deployments

---

### 4. Dry Run Mode

Preview actions without making changes:

```bash
./install.sh --template node-ai-stack --claude-code --dry-run
```

Shows:

- Files that would be copied
- Configuration changes
- Mount points that would be enabled
- .gitignore modifications

**Perfect for:**

- Verifying configuration
- Testing before actual install
- Understanding what the script does

## Command-Line Reference

### General Options

```bash
-h, --help              Show help message
-i, --interactive       Interactive mode (guided setup)
-d, --dry-run          Preview actions without changes
-v, --verbose          Verbose output
-c, --config FILE      Custom configuration file
```

### Target Configuration

```bash
-t, --target DIR       Target directory (default: current directory)
--template NAME        Template to install
                      (base, node-typescript, node-typescript-postgres, node-ai-stack)
```

### AI Stack Features

```bash
--host-username NAME   Host username for mounts
--host-home PATH       Host home directory
--claude-code         Install Claude Code CLI
--gemini-cli          Install Gemini CLI
--codex-cli           Install OpenAI Codex CLI
--uv                  Install uv (Python package manager)
--specify-cli         Install specify-cli
--mount-claude        Mount Claude configuration
--mount-oss           Mount OSS projects
--mount-docker        Mount Docker socket (SECURITY WARNING)
```

### Database Configuration

```bash
--db-host HOST        PostgreSQL host
--db-port PORT        PostgreSQL port
--db-name NAME        Database name
--db-user USER        Database user
--db-password PASS    Database password
--db-network NET      Docker network name
```

### Installation Options

```bash
--no-env              Don't create .env file
--no-gitignore        Don't update .gitignore
--no-backup           Don't backup existing .devcontainer
--skip-validation     Skip validation checks
```

## Usage Examples

### Example 1: Minimal TypeScript Project

```bash
./install.sh --template node-typescript --target ~/my-library
```

Result:

- TypeScript-ready devcontainer
- No database, no AI tools
- Clean and simple

---

### Example 2: Full-Stack API with PostgreSQL

```bash
./install.sh \
  --template node-typescript-postgres \
  --target ~/my-api \
  --db-name myapp_dev \
  --db-user myapp_user \
  --db-password secretpass \
  --db-host localhost
```

Result:

- TypeScript + PostgreSQL client
- .env file with database credentials
- Ready for REST/GraphQL development

---

### Example 3: AI-Powered Application (Full Setup)

```bash
./install.sh \
  --template node-ai-stack \
  --target ~/ai-project \
  --host-username scott \
  --claude-code \
  --uv \
  --mount-claude \
  --mount-docker
```

Result:

- Full AI stack with Claude Code CLI
- Python via uv
- Claude config mounted
- Docker socket access
- All AI tools ready

---

### Example 4: Team Standardization

Create `team-config.conf`:

```bash
# Team standard configuration
TEMPLATE="node-typescript-postgres"
POSTGRES_HOST="db.company.com"
POSTGRES_PORT="5432"
INSTALL_CLAUDE_CODE="true"
CREATE_ENV_FILE="true"
ADD_TO_GITIGNORE="true"
BACKUP_EXISTING="true"
```

Install with team config:

```bash
./install.sh --config team-config.conf --target ~/project
```

Each team member uses the same base configuration, customizing only what's needed.

---

### Example 5: Dry Run Before Installing

```bash
./install.sh \
  --template node-ai-stack \
  --claude-code \
  --mount-claude \
  --mount-oss \
  --dry-run \
  --verbose
```

Output shows:

```
[DRY RUN] Would copy: /path/to/templates/node-ai-stack -> /path/to/project/.devcontainer
→ Files to be copied:
  - Dockerfile
  - devcontainer.json
  - post-create.sh
  - .env.template
  - README.md
[DRY RUN] Would create: /path/to/project/.devcontainer/.env
→ Configuration values:
  INSTALL_CLAUDE_CODE=true
  MOUNT_CLAUDE_CONFIG=true
```

Remove `--dry-run` to actually install.

## Configuration File Reference

The `install.conf` file provides defaults for all options. Command-line arguments override these values.

### Structure

```bash
# Comments start with #
KEY=value

# Boolean values
INSTALL_CLAUDE_CODE="true"

# Empty values (use defaults)
POSTGRES_DB=""
```

### Key Sections

1. **Target Configuration** - Where to install, which template
2. **Optional Features** - AI tools, Python, etc.
3. **Mounts** - File system mounts (Claude config, OSS projects)
4. **Database Configuration** - PostgreSQL connection
5. **Installation Options** - .env creation, backups, .gitignore

See `install.conf` for complete reference with inline documentation.

## Interactive Mode Walkthrough

Full example of interactive mode session:

```bash
$ ./install.sh --interactive

════════════════════════════════════════════════════════════════
     DevContainer Template Installer - Interactive Mode
════════════════════════════════════════════════════════════════

Available Templates:
  1) base                      - Minimal Node.js setup
  2) node-typescript           - TypeScript ready
  3) node-typescript-postgres  - TypeScript + PostgreSQL
  4) node-ai-stack            - Full AI stack (kitchen sink)

Select template [1-4, default: 1]: 4
ℹ Selected template: node-ai-stack

Target directory [.]: ~/my-ai-project

Database Configuration:
Configure PostgreSQL connection? [y/N]: y
PostgreSQL host [localhost]: localhost
PostgreSQL port [5432]: 5432
Database name []: myapp_dev
Database user []: myapp_user
Database password (hidden): ********
Docker network (leave empty if not using): postgres_default

AI Stack Configuration:
Host username [scott]: scott
Host home directory [/home/scott]: /home/scott

AI Tools Installation:
Install Claude Code CLI? [y/N]: y
Install Gemini CLI? [y/N]: n
Install OpenAI Codex CLI? [y/N]: n
Install uv (Python package manager)? [y/N]: y
Python version [3.12.3]: 3.12.3
Install specify-cli? [y/N]: y

File System Mounts:
Mount Claude configuration? [y/N]: y
Claude config path [/home/scott/.claude]: /home/scott/.claude
Mount OSS projects? [y/N]: n

⚠  SECURITY WARNING
Docker socket mount gives container full access to host Docker daemon.
Only enable for trusted personal projects.
Mount Docker socket? [y/N]: n

Installation Options:
Create .env file from template? [Y/n]: y
Add .devcontainer/.env to .gitignore? [Y/n]: y
Backup existing .devcontainer directory? [Y/n]: y

════════════════════════════════════════════════════════════════
Configuration Summary
════════════════════════════════════════════════════════════════
Template:        node-ai-stack
Target:          /home/scott/my-ai-project
Host User:       scott
AI Tools:        Claude=true Gemini=false Codex=false
Python (uv):     true
Mounts:          Claude=true OSS=false Docker=false
Database:        myapp_user@localhost:5432/myapp_dev
Create .env:     true
Update .gitignore: true
Backup existing: true
════════════════════════════════════════════════════════════════

Proceed with installation? [Y/n]: y
```

## Advanced Usage

### Custom Configuration Files

Create project-specific config files:

```bash
# Backend API config
cp install.conf backend-api.conf
# Edit for API-specific settings

# Frontend app config
cp install.conf frontend-app.conf
# Edit for frontend-specific settings

# Install using custom config
./install.sh --config backend-api.conf --target ~/backend
./install.sh --config frontend-app.conf --target ~/frontend
```

### Scripting Installations

Automate multiple project setups:

```bash
#!/bin/bash
# setup-microservices.sh

PROJECTS=("auth-service" "user-service" "payment-service")

for project in "${PROJECTS[@]}"; do
  echo "Setting up $project..."
  ./install.sh \
    --template node-typescript-postgres \
    --target ~/microservices/$project \
    --db-name ${project}_dev \
    --db-user ${project}_user
done
```

### Environment-Specific Installations

```bash
# Development
./install.sh --config dev.conf --target ~/project

# Staging
./install.sh --config staging.conf --target ~/project-staging

# Production (minimal, no dev tools)
./install.sh --config prod.conf --target ~/project-prod
```

## Validation and Safety

### What Gets Validated

1. **Template Exists** - Checks if template directory is present
2. **Target Directory** - Warns if doesn't exist (will be created)
3. **Mount Paths** - Warns if mount directories don't exist
4. **Configuration Conflicts** - Detects incompatible settings

### Backup Strategy

By default, existing `.devcontainer` directories are backed up:

```
.devcontainer/          → .devcontainer.backup/
.devcontainer.backup/   → .devcontainer.backup.20250130_143022/
```

Disable with: `--no-backup`

### Security Warnings

The script warns about:

- Docker socket mounting (full host access)
- Missing mount directories
- Database credentials in .env

## Troubleshooting

### "Template directory not found"

**Cause**: Invalid template name or wrong script directory

**Fix**:

```bash
# List available templates
ls -d devcontainer-templates/*/

# Use exact template name
./install.sh --template node-typescript
```

---

### ".env file not created"

**Cause**: Template doesn't have `.env.template` or creation disabled

**Fix**:

```bash
# Check if template has .env.template
ls devcontainer-templates/node-ai-stack/.env.template

# Ensure creation is enabled
./install.sh --template node-ai-stack  # (without --no-env)
```

---

### "Mounts not working in devcontainer"

**Cause**: Mounts commented in `devcontainer.json` or paths incorrect

**Fix**:

1. Check `.env` has correct paths
2. Uncomment mount lines in `devcontainer.json`
3. Rebuild container: "Dev Containers: Rebuild Container"

---

### "Permission denied" errors

**Cause**: Script not executable

**Fix**:

```bash
chmod +x install.sh
./install.sh --help
```

---

### "Validation failed"

**Cause**: Configuration issues (usually mount paths)

**Fix**:

```bash
# Run with verbose to see details
./install.sh --verbose --template node-ai-stack

# Skip validation if needed (not recommended)
./install.sh --skip-validation
```

## Best Practices

### ✅ Do

- Use `--dry-run` first to preview changes
- Start with minimal template, add complexity as needed
- Use `--interactive` mode for first-time setup
- Review generated `.env` file before committing
- Test devcontainer after installation
- Document team-specific `install.conf` settings

### ❌ Don't

- Skip validation without good reason
- Commit `.env` files with secrets
- Enable Docker socket mount for untrusted projects
- Use `--skip-validation` in production
- Forget to backup existing devcontainer (disable only if certain)

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Setup DevContainer

on: [push]

jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install DevContainer
        run: |
          cd devcontainer-templates
          ./install.sh \
            --template node-typescript \
            --target .. \
            --no-backup \
            --skip-validation
```

### Docker Build Example

```dockerfile
# Dockerfile for pre-configured devcontainer
FROM ubuntu:22.04

COPY devcontainer-templates /tmp/templates
RUN cd /tmp/templates && \
    ./install.sh --template node-ai-stack --target /workspace
```

## Next Steps After Installation

1. **Review Configuration**

   ```bash
   cat .devcontainer/.env
   cat .devcontainer/devcontainer.json
   ```

2. **Set API Keys** (in host environment, not .env)

   ```bash
   export ANTHROPIC_API_KEY=your_key
   export OPENAI_API_KEY=your_key
   ```

3. **Open in VS Code**
   - Command Palette → "Dev Containers: Reopen in Container"

4. **Verify Installation**
   - Check post-create script output
   - Test type checking: `npx tsc --noEmit`
   - Test database connection (if applicable)

5. **Customize**
   - Add project-specific setup to `.devcontainer/project-setup.sh`
   - Adjust VS Code extensions in `devcontainer.json`
   - Configure ports as needed

## Support

### Getting Help

1. Check template-specific README:

   ```bash
   cat devcontainer-templates/node-ai-stack/README.md
   ```

2. Run with verbose output:

   ```bash
   ./install.sh --verbose --dry-run
   ```

3. Review configuration:
   ```bash
   cat install.conf
   ```

### Common Issues

See [Troubleshooting](#troubleshooting) section above.

## Contributing

Improvements welcome:

- Additional validation checks
- New configuration options
- Better error messages
- Platform-specific support (macOS, Windows)

---

**Built with ❤️ for developers who value automation and reproducibility**
