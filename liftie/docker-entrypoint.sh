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

# Function to check Claude Code status
check_claude_status() {
    echo "=== Claude Code Status ==="

    # Check if claude CLI exists
    if command -v claude &> /dev/null; then
        echo "✓ Claude CLI found at: $(which claude)"
        claude --version 2>&1 || echo "✗ Could not get version"
    else
        echo "✗ Claude CLI not found!"
        echo "  Install with: npm install -g @anthropic-ai/claude-code"
        return 1
    fi

    # Check authentication
    if [ -f /root/.claude/config.json ]; then
        echo "✓ Claude config found at /root/.claude/config.json"
    else
        echo "✗ Claude not authenticated!"
        echo "  Run: docker run -it -v liftie-claude-config:/root/.claude liftie claude login"
        return 1
    fi

    # Check SSH key
    if [ -f /root/.ssh/id_ed25519 ]; then
        echo "✓ SSH key found"
    else
        echo "✗ No SSH key found (needed for Hetzner access)"
        return 1
    fi

    # Check Hetzner connectivity
    if [ -n "$HETZNER_HOST" ]; then
        if ssh -o ConnectTimeout=5 -o BatchMode=yes scraper@$HETZNER_HOST "echo ok" 2>/dev/null; then
            echo "✓ Can SSH to Hetzner ($HETZNER_HOST)"
        else
            echo "✗ Cannot SSH to Hetzner ($HETZNER_HOST)"
            return 1
        fi
    fi

    echo "=== All checks passed ==="
    return 0
}

# If running with 'status' argument, show diagnostic info
if [ "$1" = "status" ]; then
    check_claude_status
    exit $?
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

# Check Claude Code status on startup
echo ""
check_claude_status || echo "⚠️ Some checks failed - agents may not work properly"
echo ""

# Start cron in foreground
echo "Starting cron scheduler (runs every 10 minutes)..."
echo "Logs: tail -f /var/log/liftie.log"
echo ""

# Run once immediately on startup
echo "Running initial health check..."
node /app/liftie/index.js || true

# Then start cron
cron -f
