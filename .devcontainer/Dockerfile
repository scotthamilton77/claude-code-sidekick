FROM mcr.microsoft.com/devcontainers/javascript-node:24

# Install system dependencies
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
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
    bc \
    coreutils \
    diffutils \
    less \
    patch \
    rsync \
    lsof \
    net-tools \
    iputils-ping \
    dnsutils \
    netcat-openbsd \
    telnet \
    traceroute \
    tcpdump \
    strace \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install yq (YAML processor, companion to jq)
RUN curl -fsSL https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64 -o /usr/local/bin/yq \
    && chmod +x /usr/local/bin/yq

# Ensure node user has passwordless sudo
RUN echo "node ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers.d/node

# Create directory structure for mounts with proper permissions
RUN mkdir -p /home/node/.claude \
    && chown -R node:node /home/node/.claude

# Source secrets file if mounted
RUN echo '\n# Source API keys from mounted secrets\n[ -r ~/.secrets ] && . ~/.secrets' >> /home/node/.bashrc
