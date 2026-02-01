#!/bin/bash
# Smart commit script - only commits changed real-time data
# Real-time: lift wait times (data/*/lifts/*.ndjson) - commit every 5 min
# Batch: everything else (snow, terrain, etc.) - commit hourly

REPO_DIR="/home/scraper/ski-run-scraper"
LOG_FILE="/home/scraper/logs/commit.log"
LAST_FULL_COMMIT_FILE="/tmp/last-full-commit"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

cd "$REPO_DIR" || exit 1

# Check if we should do a full commit (every 60 minutes)
should_full_commit() {
  if [ ! -f "$LAST_FULL_COMMIT_FILE" ]; then
    return 0  # First time, do full commit
  fi

  last_commit=$(cat "$LAST_FULL_COMMIT_FILE")
  current_time=$(date +%s)
  diff=$((current_time - last_commit))

  if [ $diff -ge 3600 ]; then
    return 0  # 60+ minutes since last full commit
  fi
  return 1
}

# Stage and commit real-time lift data (always do this)
if git diff --quiet data/*/lifts/ 2>/dev/null; then
  log "No lift data changes"
else
  log "Committing lift data changes..."
  git add data/*/lifts/ 2>/dev/null || true

  if ! git diff-index --quiet --cached HEAD; then
    git commit -m "Update lift wait times - $(date -u '+%Y-%m-%d %H:%M UTC')" >> "$LOG_FILE" 2>&1
    log "Lift data committed"
  fi
fi

# Do full commit if 60+ minutes have passed
if should_full_commit; then
  log "Doing full data commit (hourly)..."
  git add data/ 2>/dev/null || true

  if ! git diff-index --quiet --cached HEAD; then
    git commit -m "Update ski data - $(date -u '+%Y-%m-%d %H:%M UTC')" >> "$LOG_FILE" 2>&1
    log "Full data committed"
    echo "$(date +%s)" > "$LAST_FULL_COMMIT_FILE"
  fi
fi

# Push all commits
if ! git diff --quiet origin/main; then
  log "Pushing to GitHub..."
  git push origin main >> "$LOG_FILE" 2>&1
  log "Push complete"
fi

log "Smart commit cycle done"
