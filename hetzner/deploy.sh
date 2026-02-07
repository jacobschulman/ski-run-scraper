#!/bin/bash
# Auto-deploy script for Hetzner ski scraper
# Pulls latest code while preserving local data changes
# Only restarts PM2 when code files change (not data-only commits)
# Safe to run frequently (cron job)

set -e

REPO_DIR="/home/scraper/ski-run-scraper"
LOG_FILE="/home/scraper/logs/deploy.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

cd "$REPO_DIR" || exit 1

log "Starting auto-deploy check..."

# Fetch latest from GitHub
git fetch origin main >> "$LOG_FILE" 2>&1

# Check if there are changes to pull
if git diff --quiet origin/main HEAD; then
  log "No changes to deploy"
  exit 0
fi

# Check if changes include code files (not just data/)
CODE_CHANGES=$(git diff --name-only HEAD origin/main -- ':!data/' ':!cache/')

# Stash any uncommitted changes (preserves /data modifications)
git stash >> "$LOG_FILE" 2>&1

# Pull latest
git pull origin main >> "$LOG_FILE" 2>&1

# Reapply local changes (restores /data to scrapers' current state)
git stash pop >> "$LOG_FILE" 2>&1 || true

if [ -z "$CODE_CHANGES" ]; then
  log "Data-only changes pulled, no PM2 restart needed"
  exit 0
fi

log "Code changes detected: $CODE_CHANGES"
log "Restarting PM2 apps..."

# Restart affected services
pm2 restart lift-scraper-others lift-scraper-vail snow-scraper terrain-scraper api-server >> "$LOG_FILE" 2>&1

log "Deploy complete"
