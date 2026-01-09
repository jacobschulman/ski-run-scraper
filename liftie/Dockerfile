# Liftie - Ski Scraper Monitor Agent
# Docker container for running on Unraid or any Docker host

FROM node:20-slim

# Install dependencies for Claude Code and SSH
RUN apt-get update && apt-get install -y \
    curl \
    git \
    openssh-client \
    cron \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (skip Puppeteer browser download - Liftie doesn't need it)
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Create directory for Claude Code config (will be mounted)
RUN mkdir -p /root/.claude

# Create the cron job (runs every 10 minutes)
RUN echo "*/10 * * * * cd /app && node liftie/index.js >> /var/log/liftie.log 2>&1" > /etc/cron.d/liftie \
    && chmod 0644 /etc/cron.d/liftie \
    && crontab /etc/cron.d/liftie

# Create log file
RUN touch /var/log/liftie.log

# Entrypoint script
COPY liftie/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Environment variables (set these when running)
ENV DISCORD_WEBHOOK_URL=""
ENV HETZNER_HOST=""
ENV SSH_PRIVATE_KEY=""

ENTRYPOINT ["/docker-entrypoint.sh"]
