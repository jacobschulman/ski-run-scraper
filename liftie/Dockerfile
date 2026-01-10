# Liftie - Ski Scraper Monitor Agent
# Docker container for running on Unraid or any Docker host

FROM node:20-slim

# Install dependencies for Claude Code, SSH, and GitHub CLI
RUN apt-get update && apt-get install -y \
    curl \
    git \
    openssh-client \
    cron \
    gosu \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (for investigating GitHub Actions issues)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user for running Claude Code
# (Claude Code blocks --dangerously-skip-permissions when running as root)
RUN useradd -m -s /bin/bash liftie \
    && mkdir -p /home/liftie/.claude /home/liftie/.ssh \
    && chown -R liftie:liftie /home/liftie

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (skip Puppeteer browser download - Liftie doesn't need it)
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Set ownership so liftie user can access
RUN chown -R liftie:liftie /app

# Create log file accessible by liftie user
RUN touch /var/log/liftie.log && chown liftie:liftie /var/log/liftie.log

# Create the cron job for liftie user (runs every 10 minutes)
RUN echo "*/10 * * * * cd /app && node liftie/index.js >> /var/log/liftie.log 2>&1" > /etc/cron.d/liftie \
    && chmod 0644 /etc/cron.d/liftie \
    && crontab -u liftie /etc/cron.d/liftie

# Entrypoint script
COPY liftie/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Environment variables (set these when running)
ENV DISCORD_WEBHOOK_URL=""
ENV HETZNER_HOST=""
ENV SSH_PRIVATE_KEY=""
ENV HOME=/home/liftie

ENTRYPOINT ["/docker-entrypoint.sh"]
