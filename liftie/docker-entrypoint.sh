#!/bin/bash

# Liftie Docker Entrypoint
# Sets up SSH key and starts cron

set -e

echo "🎿 Liftie starting up..."

# Setup SSH key if provided (used for both GitHub and Hetzner)
if [ -n "$SSH_PRIVATE_KEY" ]; then
    echo "Setting up SSH key..."
    mkdir -p /root/.ssh
    echo "$SSH_PRIVATE_KEY" | base64 -d > /root/.ssh/id_ed25519
    chmod 600 /root/.ssh/id_ed25519

    # Add GitHub to known hosts
    ssh-keyscan -H github.com >> /root/.ssh/known_hosts 2>/dev/null || true

    # Add Hetzner to known hosts
    if [ -n "$HETZNER_HOST" ]; then
        ssh-keyscan -H "$HETZNER_HOST" >> /root/.ssh/known_hosts 2>/dev/null || true
    fi

    # Configure git to use SSH
    git config --global url."git@github.com:".insteadOf "https://github.com/"
fi

# Configure git user for commits
git config --global user.name "Liftie Bot"
git config --global user.email "liftie@ski-scraper.bot"

# Check if Claude Code is authenticated
if [ ! -f /root/.claude/config.json ]; then
    echo ""
    echo "⚠️  Claude Code is not authenticated!"
    echo ""
    echo "To authenticate, run this container interactively first:"
    echo "  docker run -it -v liftie-claude-config:/root/.claude liftie claude login"
    echo ""
    echo "Then restart the container normally."
    echo ""
fi

# If running with 'run-once' argument, just run liftie once and exit
if [ "$1" = "run-once" ]; then
    echo "Running Liftie once..."
    node /app/liftie/index.js
    exit $?
fi

# If running with 'login' argument, run claude login
if [ "$1" = "login" ] || [ "$1" = "claude" ]; then
    shift
    exec claude "$@"
fi

# Start cron in foreground
echo "Starting cron scheduler (runs every 10 minutes)..."
echo "Logs: tail -f /var/log/liftie.log"
echo ""

# Run once immediately on startup
echo "Running initial health check..."
node /app/liftie/index.js || true

# Then start cron
cron -f
