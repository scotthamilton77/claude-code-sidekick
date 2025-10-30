# Quick Reference Card

## Installation Methods

| Method          | Command                                  | Use When                  |
| --------------- | ---------------------------------------- | ------------------------- |
| **Interactive** | `./install.sh -i`                        | First time, need guidance |
| **Quick**       | `./install.sh --template NAME`           | Know what you want        |
| **Dry Run**     | `./install.sh --template NAME --dry-run` | Preview before install    |
| **Manual**      | `cp -r base/.devcontainer .`             | Full control needed       |

## Template Quick Comparison

| Feature        | base  | ts     | ts+pg | ai-stack |
| -------------- | ----- | ------ | ----- | -------- |
| **Size**       | 500MB | 600MB  | 700MB | 1.2GB    |
| **Build**      | 2min  | 2.5min | 3min  | 5min+    |
| **TypeScript** | ❌    | ✅     | ✅    | ✅       |
| **Database**   | ❌    | ❌     | ✅    | ✅       |
| **AI Tools**   | ❌    | ❌     | ❌    | ⚙️       |
| **Python**     | ❌    | ❌     | ❌    | ✅       |

## Common Command Patterns

```bash
# Minimal project
./install.sh --template base

# TypeScript library
./install.sh --template node-typescript --target ~/my-lib

# Full-stack API
./install.sh --template node-typescript-postgres \
  --db-name myapp --db-user myapp

# AI development (full setup)
./install.sh --template node-ai-stack \
  --claude-code --uv --mount-claude

# Team standard (use config)
./install.sh --config team.conf --target ~/project
```

## Key Flags

| Flag                      | Purpose             |
| ------------------------- | ------------------- |
| `-i` / `--interactive`    | Guided setup        |
| `-d` / `--dry-run`        | Preview only        |
| `-t DIR` / `--target DIR` | Install location    |
| `--template NAME`         | Which template      |
| `--claude-code`           | Install Claude CLI  |
| `--mount-claude`          | Mount Claude config |
| `--db-name NAME`          | Database name       |
| `--no-backup`             | Skip backup         |

## File Locations

```
devcontainer-templates/
├── install.sh           # Main installer
├── install.conf         # Default config
├── INSTALL_GUIDE.md     # Full documentation
├── README.md            # Template overview
├── QUICKREF.md          # This file
│
├── base/                # Minimal template
├── node-typescript/     # TypeScript template
├── node-typescript-postgres/  # With database
└── node-ai-stack/       # Kitchen sink
```

## Post-Install Checklist

- [ ] Review `.devcontainer/.env` (if created)
- [ ] Set API keys in host environment
- [ ] Uncomment mounts in `devcontainer.json` (ai-stack)
- [ ] Open in VS Code
- [ ] Command Palette → "Reopen in Container"
- [ ] Verify environment works

## Troubleshooting

| Problem            | Solution                               |
| ------------------ | -------------------------------------- |
| Permission denied  | `chmod +x install.sh`                  |
| Template not found | Check spelling, run from templates dir |
| Validation failed  | Check paths, use `--verbose`           |
| Mounts not working | Uncomment in devcontainer.json         |

## Documentation

- **Full Install Guide**: `INSTALL_GUIDE.md` (15KB, comprehensive)
- **Template Overview**: `README.md` (12KB, all templates)
- **Template Specific**: `<template>/README.md` (per-template docs)
- **This File**: Quick reference (2KB, fast lookup)

## Template Decision Tree

```
Do you need AI tools?
├─ YES → node-ai-stack
└─ NO
   ├─ Do you need database?
   │  ├─ YES → node-typescript-postgres
   │  └─ NO → Do you need TypeScript?
   │     ├─ YES → node-typescript
   │     └─ NO → base
```

## Examples by Use Case

| Use Case     | Template                 | Command                                                          |
| ------------ | ------------------------ | ---------------------------------------------------------------- |
| CLI tool     | node-typescript          | `./install.sh --template node-typescript`                        |
| REST API     | node-typescript-postgres | `./install.sh --template node-typescript-postgres --db-name api` |
| Library      | base or node-typescript  | `./install.sh --template node-typescript`                        |
| AI app       | node-ai-stack            | `./install.sh --template node-ai-stack --claude-code`            |
| Microservice | node-typescript-postgres | `./install.sh --template node-typescript-postgres`               |
| Frontend     | node-typescript          | `./install.sh --template node-typescript`                        |

## Support

- Run with `--help` for full usage
- Use `--verbose` to see detailed output
- Use `--dry-run` to preview changes
- Check template README for specific docs

---

**Pro Tip**: Start with `--interactive` mode if unsure which options you need!
