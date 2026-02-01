#!/bin/bash
# Auto-deploy script for Hetzner ski scraper
# Pulls latest code while preserving local data changes
# Only restarts PM2 services when actual code files change (not data-only commits)
#
# Crontab entry:
#   */5 * * * * /home/scraper/ski-run-scraper/hetzner/deploy.sh >> /home/scraper/logs/deploy.log 2>&1

set -e

REPO_DIR="/home/scraper/ski-run-scraper"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

cd "$REPO_DIR" || exit 1

log "Starting auto-deploy check..."

# Fetch latest from GitHub
git fetch origin main 2>&1

# Check if there are changes to pull
if git diff --quiet origin/main HEAD; then
  log "No changes to deploy"
  exit 0
fi

# Record HEAD before pulling
OLD_HEAD=$(git rev-parse HEAD)

log "Changes detected, pulling..."

# Stash any uncommitted changes (preserves /data modifications)
git stash 2>&1 || true

# Pull latest
git pull origin main 2>&1

# Reapply local changes (restores /data to scrapers' current state)
git stash pop 2>&1 || true

NEW_HEAD=$(git rev-parse HEAD)

# Check if any non-data files changed (code, config, scripts, etc.)
CODE_CHANGES=$(git diff --name-only "$OLD_HEAD" "$NEW_HEAD" -- . ':!data/' ':!cache/' 2>/dev/null | head -1)

if [ -z "$CODE_CHANGES" ]; then
  log "Only data/cache changes - no restart needed"
  exit 0
fi

log "Code changes detected, restarting PM2 apps..."
log "Changed: $(git diff --name-only "$OLD_HEAD" "$NEW_HEAD" -- . ':!data/' ':!cache/' | tr '\n' ' ')"

# Restart affected services
pm2 restart lift-scraper snow-scraper terrain-scraper api-server 2>&1

log "Deploy complete"
