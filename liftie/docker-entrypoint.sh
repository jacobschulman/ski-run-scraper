#!/bin/bash

# Liftie Docker Entrypoint
# Sets up SSH key and starts cron
# Runs as root initially to set up, then drops to liftie user for Claude Code

set -e

LIFTIE_HOME=/home/liftie

echo "🎿 Liftie starting up..."

# Ensure Claude config dir exists with correct ownership
# This is critical for auth persistence - the volume mount may create it as root
mkdir -p $LIFTIE_HOME/.claude
chown -R liftie:liftie $LIFTIE_HOME/.claude
chmod 755 $LIFTIE_HOME/.claude

# Show what's in the config dir for debugging
echo "Claude config dir contents:"
ls -la $LIFTIE_HOME/.claude/ 2>/dev/null || echo "  (empty)"

# Setup SSH key if provided (used for both GitHub and Hetzner)
SSH_KEY_B64="${SSH_PRIVATE_KEY:-$HETZNER_SSH_KEY}"
if [ -n "$SSH_KEY_B64" ]; then
    echo "Setting up SSH key..."
    mkdir -p $LIFTIE_HOME/.ssh
    echo "$SSH_KEY_B64" | base64 -d > $LIFTIE_HOME/.ssh/id_ed25519
    chmod 600 $LIFTIE_HOME/.ssh/id_ed25519
    chown -R liftie:liftie $LIFTIE_HOME/.ssh

    # Add GitHub to known hosts
    ssh-keyscan -H github.com >> $LIFTIE_HOME/.ssh/known_hosts 2>/dev/null || true

    # Add Hetzner to known hosts
    if [ -n "$HETZNER_HOST" ]; then
        HETZNER_PORT=${HETZNER_PORT:-22}
        ssh-keyscan -p "$HETZNER_PORT" -H "$HETZNER_HOST" >> $LIFTIE_HOME/.ssh/known_hosts 2>/dev/null || true
    fi

    chown liftie:liftie $LIFTIE_HOME/.ssh/known_hosts
fi

# Configure git user for commits (as liftie user)
gosu liftie git config --global url."git@github.com:".insteadOf "https://github.com/"
gosu liftie git config --global user.name "Liftie Bot"
gosu liftie git config --global user.email "liftie@ski-scraper.bot"

# Function to check Claude Code status
check_claude_status() {
    echo "=== Claude Code Status ==="

    # Check if claude CLI exists
    if command -v claude &> /dev/null; then
        echo "✓ Claude CLI found at: $(which claude)"
        gosu liftie claude --version 2>&1 || echo "✗ Could not get version"
    else
        echo "✗ Claude CLI not found!"
        echo "  Install with: npm install -g @anthropic-ai/claude-code"
        return 1
    fi

    # Check authentication - look for credentials file (OAuth tokens)
    if [ -f $LIFTIE_HOME/.claude/.credentials.json ]; then
        echo "✓ Claude credentials found at $LIFTIE_HOME/.claude/.credentials.json"
    elif [ -f $LIFTIE_HOME/.claude/config.json ]; then
        echo "✓ Claude config found at $LIFTIE_HOME/.claude/config.json"
    else
        echo "✗ Claude not authenticated!"
        echo "  Run: docker-compose run --rm -it liftie login"
        return 1
    fi

    # Check SSH key
    if [ -f $LIFTIE_HOME/.ssh/id_ed25519 ]; then
        echo "✓ SSH key found"
    else
        echo "✗ No SSH key found (needed for Hetzner access)"
        return 1
    fi

    # Check Hetzner connectivity
    if [ -n "$HETZNER_HOST" ]; then
        HETZNER_USER=${HETZNER_USER:-scraper}
        HETZNER_PORT=${HETZNER_PORT:-22}
        if gosu liftie ssh -p "$HETZNER_PORT" -o ConnectTimeout=5 -o BatchMode=yes "$HETZNER_USER@$HETZNER_HOST" "echo ok" 2>/dev/null; then
            echo "✓ Can SSH to Hetzner ($HETZNER_HOST:$HETZNER_PORT)"
        else
            echo "✗ Cannot SSH to Hetzner ($HETZNER_HOST:$HETZNER_PORT)"
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
    gosu liftie node /app/liftie/index.js
    exit $?
fi

# If running with 'login' argument, run claude login as liftie user
if [ "$1" = "login" ] || [ "$1" = "claude" ]; then
    shift
    exec gosu liftie claude "$@"
fi

# Check Claude Code status on startup
echo ""
check_claude_status || echo "⚠️ Some checks failed - agents may not work properly"
echo ""

# Fix log file permissions after volume mount
# The ./logs:/var/log mount creates /var/log owned by root, so liftie can't write.
# This must happen at runtime (after mount), not build time.
touch /var/log/liftie.log
chown liftie:liftie /var/log/liftie.log
# Cron/exim also need writable dirs under /var/log
mkdir -p /var/log/exim4
chown liftie:liftie /var/log/exim4

# Save runtime environment variables for cron
# Cron runs in a stripped-down env that doesn't inherit Docker's runtime env vars.
# Without this, DISCORD_WEBHOOK_URL is empty and all notifications silently fail.
ENV_FILE=$LIFTIE_HOME/.cron-env
echo "Saving environment variables for cron to $ENV_FILE..."
printenv | grep -E '^(DISCORD_|HETZNER_|SSH_|GITHUB_|CLAUDE_|LIFTIE_|HOME=|PATH=|NODE_|NPM_)' | while IFS='=' read -r key value; do
    echo "export ${key}=\"${value}\""
done > "$ENV_FILE"
chown liftie:liftie "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Install crontab dynamically so it sources the env file
# The Dockerfile's static crontab lacks runtime env vars and proper PATH
printf 'MAILTO=""\n*/10 * * * * . %s; cd /app && node liftie/index.js >> /var/log/liftie.log 2>&1\n' "$ENV_FILE" | crontab -u liftie -

echo "Starting cron scheduler (runs every 10 minutes)..."
echo "Logs: tail -f /var/log/liftie.log"
echo ""

# Run once immediately on startup (as liftie user)
echo "Running initial health check..."
gosu liftie node /app/liftie/index.js || true

# Then start cron (cron runs the job as liftie user via crontab -u)
cron -f
