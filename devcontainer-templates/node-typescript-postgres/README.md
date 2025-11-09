# Node TypeScript PostgreSQL DevContainer Template

Full-stack devcontainer for Node.js + TypeScript + PostgreSQL projects.

## What's Included

- **Node.js 20**: Latest LTS version
- **TypeScript**: Global installation with ts-node and nodemon
- **PostgreSQL Client**: psql command-line tool for database access
- **Build Tools**: gcc, g++, make for native module compilation
- **Essential Tools**: git, curl, wget, vim, nano, jq, tree
- **VS Code Extensions**: Prettier, ESLint, TypeScript, PostgreSQL
- **Port Forwarding**: PostgreSQL (5432) pre-configured
- **Environment Variables**: Database connection variables configured
- **Sudo Access**: Passwordless sudo for node user

## Connection Modes

This template supports two PostgreSQL connection modes:

### Mode 1: External PostgreSQL (Recommended)

Connect to PostgreSQL running on host or in separate Docker container.

**Setup:**

1. Copy `.env.template` to `.env`
2. Configure database connection:
   ```bash
   POSTGRES_HOST=localhost
   POSTGRES_PORT=5432
   POSTGRES_DB=myapp_dev
   POSTGRES_USER=myapp_user
   POSTGRES_PASSWORD=your_password
   ```
3. If connecting to Docker container, uncomment `runArgs` in `devcontainer.json`:
   ```json
   "runArgs": ["--network=${localEnv:DOCKER_NETWORK}"]
   ```
   And set `DOCKER_NETWORK=your_network_name` in `.env`

### Mode 2: Embedded PostgreSQL (Optional)

Add PostgreSQL service to devcontainer using `docker-compose.yml` (not included - create as needed).

## Usage

1. Copy contents to your project's `.devcontainer/` directory
2. Copy `.env.template` to `.env` and configure database connection
3. Ensure you have `tsconfig.json` in your project root
4. Customize as needed (see Customization section)
5. Open in VS Code and select "Reopen in Container"

## Database Connection Testing

Post-create script automatically tests database connection. Check output for:

```
✅ PostgreSQL connection successful
```

If connection fails, verify `.env` configuration and ensure PostgreSQL is accessible.

## Manual Database Connection

```bash
# Using environment variables from .env
psql -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -d $POSTGRES_DB

# Or specify directly
psql -h localhost -p 5432 -U myapp_user -d myapp_dev
```

## Recommended ORMs/Query Builders

This template works with any PostgreSQL library:

- **Prisma**: Type-safe ORM with migrations

  ```bash
  npm install prisma @prisma/client
  npx prisma init
  ```

- **TypeORM**: Decorator-based ORM

  ```bash
  npm install typeorm pg reflect-metadata
  ```

- **pg**: Raw SQL with connection pooling

  ```bash
  npm install pg @types/pg
  ```

- **Knex.js**: SQL query builder
  ```bash
  npm install knex pg
  ```

## Customization Points

### Add System Packages

Edit `Dockerfile`:

```dockerfile
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
    redis-tools \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
```

### Add Additional Ports

Edit `devcontainer.json`:

```json
"forwardPorts": [5432, 3000, 6379],
"portsAttributes": {
  "5432": { "label": "PostgreSQL", "onAutoForward": "silent" },
  "3000": { "label": "API Server", "onAutoForward": "notify" },
  "6379": { "label": "Redis", "onAutoForward": "silent" }
}
```

### Add Environment Variables

Edit `devcontainer.json`:

```json
"remoteEnv": {
  "NODE_ENV": "development",
  "POSTGRES_HOST": "${localEnv:POSTGRES_HOST:localhost}",
  "API_KEY": "${localEnv:API_KEY}"
}
```

### Add Migration Scripts

Create database connection scripts in `scripts/`:

```bash
#!/bin/bash
# scripts/db-connect.sh
psql -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -d $POSTGRES_DB
```

## Development Workflow

### Database Migrations

```bash
# Prisma
npx prisma migrate dev
npx prisma migrate deploy

# TypeORM
npx typeorm migration:generate
npx typeorm migration:run
```

### Type Checking

```bash
npx tsc --noEmit
```

### Development Mode

```bash
npx ts-node src/index.ts
npx nodemon src/index.ts
```

## Tips

- Store database credentials in `.env` (never commit to git)
- Add `.env` to `.gitignore`
- Use connection pooling for better performance
- Enable SSL for production database connections
- Use transactions for multi-step database operations
- Create database indexes for frequently queried fields
