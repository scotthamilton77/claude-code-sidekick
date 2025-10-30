FROM mcr.microsoft.com/devcontainers/javascript-node:20

# Install essential system dependencies
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
    git \
    curl \
    wget \
    vim \
    nano \
    jq \
    tree \
    build-essential \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install global TypeScript tooling
RUN npm install -g \
    typescript \
    ts-node \
    nodemon

# Ensure node user has passwordless sudo
RUN echo "node ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers.d/node

# The workspace directory will be created by VS Code during mount
