# install-commands.ps1
# Copy Claude Code planning commands to user's ~/.claude/commands/ or project's ./.claude/commands/ directory
# Usage: .\install-commands.ps1 user|project [-Target path] [-Backup] [-Help]

param(
    [Parameter(Position=0, Mandatory=$true)]
    [ValidateSet("user", "project")]
    [string]$Mode,
    
    [string]$Target,
    [switch]$Backup,
    [switch]$Help
)

# Color functions for better output
function Write-ColorOutput([string]$Message, [string]$ForegroundColor = "White") {
    Write-Host $Message -ForegroundColor $ForegroundColor
}

function Write-Success([string]$Message) {
    Write-ColorOutput "✅ $Message" "Green"
}

function Write-Info([string]$Message) {
    Write-ColorOutput "ℹ️  $Message" "Blue"
}

function Write-Warning([string]$Message) {
    Write-ColorOutput "⚠️  $Message" "Yellow"
}

function Write-Error([string]$Message) {
    Write-ColorOutput "❌ $Message" "Red"
}

# Show help
if ($Help) {
    @"
🚀 Claude Code Commands Installation Script (PowerShell)

USAGE:
    .\scripts\install-commands.ps1 user|project [OPTIONS]

ARGUMENTS:
    user       Install to user's ~/.claude/commands/ directory
    project    Install to current project's ./.claude/commands/ directory

OPTIONS:
    -Target path   For 'project' mode, specify target project directory
    -Backup        Create backup of existing commands before installation
    -Help          Show this help message

EXAMPLES:
    .\scripts\install-commands.ps1 user             # Install to user directory
    .\scripts\install-commands.ps1 user -Backup     # Install with backup
    .\scripts\install-commands.ps1 project          # Install to current project
    .\scripts\install-commands.ps1 project -Target "C:\path\to\project"

DESCRIPTION:
    Copies all command files (*.md) from ./commands/** to the specified target
    directory, preserving directory structure. Existing files will be overwritten.

"@
    exit 0
}

# Configuration
$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$CommandsSourceDir = Join-Path $ProjectDir "commands"

# Set target directory based on install mode
if ($Mode -eq "user") {
    $CommandsTargetDir = Join-Path $env:USERPROFILE ".claude\commands"
    $InstallTitle = "🚀 Claude Code Commands User-Level Installation"
    $InstallSeparator = "==============================================="
} elseif ($Mode -eq "project") {
    if ($Target) {
        $TargetProjectDir = Resolve-Path $Target
    } else {
        $TargetProjectDir = Get-Location
    }
    $CommandsTargetDir = Join-Path $TargetProjectDir ".claude\commands"
    $InstallTitle = "🏗️  Claude Code Commands Project-Level Installation"
    $InstallSeparator = "===================================================="
}

Write-Info $InstallTitle
Write-Info $InstallSeparator

Write-Info "📁 Source: $CommandsSourceDir"
if ($Mode -eq "project") {
    Write-Info "📁 Target Project: $TargetProjectDir"
}
Write-Info "📁 Target: $CommandsTargetDir"

# Validate source directory exists
if (-not (Test-Path $CommandsSourceDir)) {
    Write-Error "Commands source directory not found: $CommandsSourceDir"
    exit 1
}

# Check for commands in source directory
$CommandFiles = Get-ChildItem -Path $CommandsSourceDir -Filter "*.md" -Recurse -File
$CommandCount = $CommandFiles.Count

if ($CommandCount -eq 0) {
    Write-Error "No command files (*.md) found in $CommandsSourceDir"
    exit 1
}

Write-Info "📋 Found $CommandCount command files to install"

# Warn if installing to same project in project mode
if ($Mode -eq "project" -and $TargetProjectDir -eq $ProjectDir) {
    Write-Warning "⚠️  Installing commands to the same project they came from"
    Write-Warning "   This will create .\.claude\commands\ in this project"
}

# Create target directory if it doesn't exist
if (-not (Test-Path $CommandsTargetDir)) {
    if ($Mode -eq "user") {
        Write-Warning "📂 Creating user commands directory: $CommandsTargetDir"
    } else {
        Write-Warning "📂 Creating project commands directory: $CommandsTargetDir"
    }
    New-Item -ItemType Directory -Path $CommandsTargetDir -Force | Out-Null
}

# Backup existing commands if requested
if ($Backup -and (Test-Path $CommandsTargetDir)) {
    $BackupDir = "$CommandsTargetDir.backup.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
    Write-Warning "💾 Creating backup: $BackupDir"
    Copy-Item -Path $CommandsTargetDir -Destination $BackupDir -Recurse -Force
}

# Function to copy commands recursively
function Copy-Commands {
    param(
        [string]$SourceDir,
        [string]$TargetDir,
        [string]$RelativePath = ""
    )
    
    $Items = Get-ChildItem -Path $SourceDir -ErrorAction SilentlyContinue
    
    foreach ($Item in $Items) {
        $TargetItem = Join-Path $TargetDir $Item.Name
        $DisplayPath = if ($RelativePath) { "$RelativePath/$($Item.Name)" } else { $Item.Name }
        
        if ($Item.PSIsContainer) {
            # Create directory in target
            if (-not (Test-Path $TargetItem)) {
                New-Item -ItemType Directory -Path $TargetItem -Force | Out-Null
                Write-Info "📁 Created directory: $DisplayPath"
            }
            
            # Recursively copy contents
            Copy-Commands -SourceDir $Item.FullName -TargetDir $TargetItem -RelativePath $DisplayPath
        }
        elseif ($Item.Extension -eq ".md") {
            # Copy markdown files (commands)
            if (Test-Path $TargetItem) {
                Write-Warning "🔄 Overwriting: $DisplayPath"
            } else {
                Write-Success "📄 Installing: $DisplayPath"
            }
            Copy-Item -Path $Item.FullName -Destination $TargetItem -Force
        }
    }
}

# Copy all commands
if ($Mode -eq "user") {
    Write-Info "🔄 Installing user-level commands..."
} else {
    Write-Info "🔄 Installing project-level commands..."
}

try {
    Copy-Commands -SourceDir $CommandsSourceDir -TargetDir $CommandsTargetDir
    
    # Count installed files
    $InstalledFiles = Get-ChildItem -Path $CommandsTargetDir -Filter "*.md" -Recurse -File
    $InstalledCount = $InstalledFiles.Count
    
    if ($Mode -eq "user") {
        Write-Success "User-level installation completed successfully!"
    } else {
        Write-Success "Project-level installation completed successfully!"
    }
    Write-Success "📊 Installed $InstalledCount command files"
    
    # List installed planning commands
    if ($Mode -eq "user") {
        Write-Info "📋 Installed Planning Commands (User-Level):"
        $CmdPrefix = "   /"
        $ExampleCmd = "/plan-create `"your project idea`""
    } else {
        Write-Info "📋 Installed Planning Commands (Project-Level):"
        $CmdPrefix = "   /project:"
        $ExampleCmd = "/project:plan-create `"your project idea`""
    }
    
    $PlanDir = Join-Path $CommandsTargetDir "plan"
    
    if (Test-Path $PlanDir) {
        $PlanCommands = Get-ChildItem -Path $PlanDir -Filter "*.md" -File
        foreach ($Command in $PlanCommands) {
            $CommandName = [System.IO.Path]::GetFileNameWithoutExtension($Command.Name)
            Write-Success "$CmdPrefix$CommandName"
        }
    } else {
        $PlanCommands = Get-ChildItem -Path $CommandsTargetDir -Filter "plan-*.md" -File
        foreach ($Command in $PlanCommands) {
            $CommandName = [System.IO.Path]::GetFileNameWithoutExtension($Command.Name)
            Write-Success "$CmdPrefix$CommandName"
        }
    }
    
    Write-Info "✨ Commands are now available in Claude Code!"
    Write-Info "   Try: $ExampleCmd"
    
    # Add .gitignore entry for project mode
    if ($Mode -eq "project") {
        $GitignoreFile = Join-Path $TargetProjectDir ".gitignore"
        if (Test-Path $GitignoreFile) {
            $Content = Get-Content $GitignoreFile -Raw
            if ($Content -notmatch "^\.claude/") {
                Write-Warning "📝 Adding .claude/ to .gitignore"
                Add-Content -Path $GitignoreFile -Value "`n# Claude Code project commands`n.claude/"
            }
        } else {
            Write-Warning "📝 Creating .gitignore with .claude/ entry"
            Set-Content -Path $GitignoreFile -Value "# Claude Code project commands`n.claude/"
        }
    }

    # Show usage information
    if ($Mode -eq "user") {
        @"

🔧 Usage:
   .\scripts\install-commands.ps1 user             # Install to user directory
   .\scripts\install-commands.ps1 user -Backup    # Install with backup

📚 Next Steps:
   1. Ensure Atlas MCP is configured (see mcp.json)
   2. Start with: /plan-create "your project description"  
   3. Follow the workflow: create → decompose → execution-init → status

"@
    } else {
        @"

🔧 Usage:
   .\scripts\install-commands.ps1 project                    # Install to current directory
   .\scripts\install-commands.ps1 project -Target "C:\path" # Install to specific project
   .\scripts\install-commands.ps1 project -Backup           # Install with backup

📚 Project-Level Commands:
   /project:plan-create "description"    # Use project-level command explicitly
   /plan-create "description"            # May use project or user level (precedence varies)

🔍 Command Precedence:
   - User-level: ~/.claude/commands/ 
   - Project-level: ./.claude/commands/ (prefix: /project:)

💡 Next Steps:
   1. Ensure Atlas MCP is configured (see mcp.json)
   2. Start with: /project:plan-create "your project description"
   3. Follow workflow: create → decompose → execution-init → status

"@
    }

} catch {
    Write-Error "Installation failed: $($_.Exception.Message)"
    exit 1
}