#!/bin/bash
# End-of-day publish script
# Commits all scraped data and pushes to both GitHub repos once daily
# Intended to run via cron at ~11 PM UTC (after all US resorts close)
#
# Crontab entry:
#   0 23 * * * /home/scraper/ski-run-scraper/hetzner/end-of-day-publish.sh >> /home/scraper/logs/publish.log 2>&1

REPO_DIR="/home/scraper/ski-run-scraper"
DATA_REPO="git@github.com:jacobschulman/ski-run-scraper-data.git"
LOG_PREFIX="[PUBLISH]"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $LOG_PREFIX $1"
}

cd "$REPO_DIR" || { log "ERROR: Cannot cd to $REPO_DIR"; exit 1; }

DATE=$(date -u '+%Y-%m-%d')
log "Starting end-of-day publish for $DATE"

# Stage all data files
git add data/ cache/ 2>/dev/null || true

# Check if there's anything to commit
if git diff-index --quiet --cached HEAD 2>/dev/null; then
  log "No new data to publish"
  exit 0
fi

# Commit
git commit -m "Update ski data - $DATE" || { log "ERROR: Commit failed"; exit 1; }
log "Data committed"

# Pull with rebase to incorporate any upstream changes (from GH Actions)
if ! git pull --rebase --autostash origin main; then
  log "ERROR: Rebase failed, aborting"
  git rebase --abort 2>/dev/null || true
  exit 1
fi

# Push to public repo (origin)
if git push origin main; then
  log "Pushed to public repo"
else
  log "ERROR: Push to public repo failed"
  exit 1
fi

# Sync data to backup data repo
# Uses a temporary clone to avoid needing a second remote configured
TEMP_DIR=$(mktemp -d)
log "Syncing to data repo..."

if git clone --depth 1 "$DATA_REPO" "$TEMP_DIR/data-repo" 2>/dev/null; then
  rsync -a --delete data/ "$TEMP_DIR/data-repo/data/"

  cd "$TEMP_DIR/data-repo"
  git add data/

  if ! git diff-index --quiet --cached HEAD 2>/dev/null; then
    git config user.name "hetzner-scraper"
    git config user.email "scraper@hetzner"
    git commit -m "Update ski data - $DATE"

    if git push origin main; then
      log "Pushed to data repo"
    else
      log "ERROR: Push to data repo failed"
    fi
  else
    log "Data repo already up to date"
  fi

  cd "$REPO_DIR"
  rm -rf "$TEMP_DIR"
else
  log "ERROR: Could not clone data repo - check SSH keys"
  rm -rf "$TEMP_DIR"
  exit 1
fi

log "End-of-day publish complete"
