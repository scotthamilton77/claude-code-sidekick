FROM mcr.microsoft.com/devcontainers/javascript-node:20

# Install comprehensive system dependencies
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
    postgresql-client \
    tree \
    jq \
    git \
    curl \
    wget \
    vim \
    nano \
    tmux \
    unzip \
    zip \
    findutils \
    build-essential \
    gcc \
    g++ \
    make \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    libssl-dev \
    zlib1g-dev \
    htop \
    ncdu \
    ripgrep \
    fd-find \
    fzf \
    gh \
    gawk \
    coreutils \
    diffutils \
    less \
    patch \
    rsync \
    net-tools \
    iputils-ping \
    dnsutils \
    netcat-openbsd \
    telnet \
    traceroute \
    tcpdump \
    lsof \
    strace \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install bun as node user
USER node
RUN curl -fsSL https://bun.sh/install | bash
USER root

# Install global npm packages for development
RUN npm install -g \
    typescript \
    ts-node \
    nodemon \
    pm2

# Ensure node user has passwordless sudo
RUN echo "node ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers.d/node

# Create directory structure for optional external mounts with proper permissions
RUN mkdir -p /home/node/.claude && chown -R node:node /home/node/.claude

# Docker CLI is already installed in the base image
# The workspace directory will be created by VS Code during mount
