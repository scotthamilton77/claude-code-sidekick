# Node TypeScript DevContainer Template

TypeScript-ready devcontainer for Node.js projects with type checking and modern tooling.

## What's Included

- **Node.js 20**: Latest LTS version
- **TypeScript**: Global installation with ts-node and nodemon
- **Build Tools**: gcc, g++, make for native module compilation
- **Essential Tools**: git, curl, wget, vim, nano, jq, tree
- **VS Code Extensions**: Prettier, ESLint, TypeScript Next
- **Type Checking**: Automatic tsc check on post-create
- **Sudo Access**: Passwordless sudo for node user

## What's NOT Included

- No database connections
- No Docker-in-Docker
- No AI tools
- No custom mounts
- No port forwarding (configure per project)
- No API keys (configure per project)

## Usage

1. Copy contents to your project's `.devcontainer/` directory
2. Ensure you have `tsconfig.json` in your project root
3. Customize as needed (see Customization section)
4. Open in VS Code and select "Reopen in Container"

## TypeScript Configuration

This template works with any `tsconfig.json`. Example for strict mode:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## Customization Points

### Add System Packages

Edit `Dockerfile`:

```dockerfile
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
    postgresql-client \
    redis-tools \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
```

### Add Port Forwarding

Edit `devcontainer.json`:

```json
"forwardPorts": [3000],
"portsAttributes": {
  "3000": { "label": "API Server", "onAutoForward": "notify" }
}
```

### Add Environment Variables

Edit `devcontainer.json`:

```json
"remoteEnv": {
  "NODE_ENV": "development",
  "API_KEY": "${localEnv:API_KEY}"
}
```

### Add Global npm Packages

Edit `Dockerfile`:

```dockerfile
RUN npm install -g \
    typescript \
    ts-node \
    nodemon \
    your-package-here
```

### Add Project-Specific Setup

Create `.devcontainer/project-setup.sh` for custom initialization.

## Development Workflow

### Type Checking

```bash
npx tsc --noEmit              # Check all files
npx tsc --noEmit src/file.ts  # Check specific file
```

### Development Mode

```bash
npx ts-node src/index.ts      # Run TypeScript directly
npx nodemon src/index.ts      # Run with auto-reload
```

### Building

```bash
npm run build                 # Compile TypeScript to JavaScript
```

## Tips

- Use `unknown` instead of `any` for better type safety
- Enable `"strict": true` in tsconfig.json for maximum type checking
- Run `npx tsc --noEmit` before committing to catch type errors
- Use workspace TypeScript version (not global) for consistency
