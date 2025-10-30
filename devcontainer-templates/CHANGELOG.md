# Changelog

All notable changes to the DevContainer Templates project.

## [1.0.0] - 2025-10-30

### Added

#### Core Templates

- **base** template: Minimal Node.js 20 setup with essential tools
- **node-typescript** template: TypeScript-ready environment with build tools
- **node-typescript-postgres** template: Full-stack with PostgreSQL client
- **node-ai-stack** template: Kitchen sink with AI tools, Python, and optional features

#### Installation System

- `install.sh` - Automated installation script with 600+ lines of features
- `install.conf` - Configuration file with sensible defaults
- Interactive mode with guided prompts and confirmation
- Command-line mode with 30+ configuration flags
- Dry-run mode for previewing changes
- Comprehensive validation and error handling
- Automatic backup of existing `.devcontainer` directories
- `.gitignore` integration for `.env` files

#### Documentation

- `README.md` - Comprehensive template overview with comparison table
- `INSTALL_GUIDE.md` - 15KB installation guide with examples
- `QUICKREF.md` - Quick reference card for fast lookups
- Template-specific READMEs for each template
- `.gitignore.template` - Recommended .gitignore additions

#### Features

**Configuration Management**

- `.env.template` files for database and AI stack templates
- Environment-based configuration with host path support
- Automatic `.env` file generation with user values
- Configuration file support for team standardization

**Security**

- Warnings for Docker socket mounting
- API key management via host environment
- Database credential protection
- Mount path validation

**Validation & Safety**

- Template existence checking
- Mount path verification
- Configuration conflict detection
- Backup before overwrite (optional)

**Developer Experience**

- Color-coded output (info, success, warning, error)
- Verbose mode for debugging
- Progress indicators
- Clear next-steps guidance

### Changed

#### Portability Improvements

- Removed hardcoded `/home/scott` paths
- Made Claude config mounts optional
- Made OSS project mounts optional
- Made AI tool installation configurable
- Username and home directory now configurable

#### Template Structure

- All templates follow consistent structure
- Post-create scripts made executable
- Standardized naming conventions
- Consistent VS Code extension sets

### Technical Details

**File Count**: 17 files across 4 templates + installation system
**Total Size**: ~45KB documentation + installation scripts
**Lines of Code**:

- install.sh: 600+ lines
- INSTALL_GUIDE.md: 640+ lines
- READMEs combined: 1000+ lines

**Supported Platforms**: Linux, macOS (with minor adjustments), WSL2

**Testing**:

- Dry run tested with all templates
- Actual installation tested with node-typescript
- Validation system tested with various configurations

### Migration Path

From existing devcontainer to templates:

1. Choose appropriate template based on needs
2. Run `./install.sh --interactive` for guided setup
3. Review generated `.devcontainer/` directory
4. Customize as needed
5. Existing `.devcontainer` automatically backed up

### Known Limitations

- Windows native support not tested (WSL2 recommended)
- Some AI CLI tools may not be publicly available yet
- Docker socket mounting requires careful security consideration
- Large templates (node-ai-stack) take 5+ minutes to build

### Future Enhancements (Potential)

- [ ] Windows native support
- [ ] More template variations (React, Vue, Next.js)
- [ ] Database migration templates
- [ ] CI/CD integration examples
- [ ] Template testing framework
- [ ] Template registry/marketplace
- [ ] Auto-update mechanism

## Version History

### Version Numbering

Following semantic versioning:

- MAJOR: Breaking changes to template structure or install script
- MINOR: New templates or major features
- PATCH: Bug fixes, documentation updates, minor tweaks

---

**Built with ❤️ for developers who value reproducible environments**
