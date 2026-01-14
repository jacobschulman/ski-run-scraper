# Git History Cleanup Guide

This guide explains how to clean up your 1.9GB git repository to reduce it to ~400-500MB by removing old data file versions while preserving the actual current data and code history.

## Pre-Cleanup Status
- **Current repo size:** 1.9GB (git objects)
- **Working directory size:** 925MB
- **Git objects:** 456,947
- **Problem:** Frequent data commits (lift every 10 min, snow every hour) created massive history

## Post-Cleanup Expected Results
- **New repo size:** ~400-500MB (75% reduction)
- **Git objects:** ~100,000
- **Clone time:** 30-60 seconds (vs 10-15 minutes)
- **Data preserved:** All current data files intact
- **Code history:** All code commits preserved

## What Gets Removed
- **Old NDJSON versions** - Lift/snow time-series files that were appended to hundreds of times
- **Duplicate aggregates** - latest-lifts.json, latest-snow.json versions from old commits
- **Old terrain snapshots** - Older versions of trail/grooming data

## What Gets Kept
- **Current data files** - All latest versions of data files stay
- **Code commits** - All .js, .yml, config changes preserved
- **Recent data commits** - Last 30 days of data history (for reference)

## Cleanup Steps

### Step 1: Backup Current Repo (Already in progress)
```bash
cd /tmp
git clone --mirror https://github.com/jacobschulman/ski-run-scraper.git ski-run-scraper.git.backup
# This creates a full backup mirror - takes 5-10 minutes for 1.9GB
```

### Step 2: Create Fresh Filter Repo Clone
```bash
# Clone a fresh copy to work with (can't filter in-place safely)
cd /tmp
rm -rf ski-run-scraper-filter
git clone --mirror https://github.com/jacobschulman/ski-run-scraper.git ski-run-scraper-filter
cd ski-run-scraper-filter
```

### Step 3: Run git-filter-repo to Clean History
```bash
# This removes old data file versions, keeping only the latest commit of each file
git-filter-repo \
  --path-regex '^data/(.*)\.(json|ndjson)$' \
  --force \
  --prune-empty commits

# This step:
# - Finds all data JSON/NDJSON files
# - Removes duplicate versions (old commits)
# - Keeps structure intact
# - Prunes empty commits
# Takes 10-20 minutes depending on machine
```

### Step 4: Verify the Cleanup
```bash
# Check new size
du -sh .

# Check that recent commits are still there
git log --oneline -20

# Verify current data files are present
git show HEAD:data/vail/lifts/2026-01-14.ndjson | head -5
```

### Step 5: Update GitHub (REQUIRES FORCE PUSH)
```bash
# Push the cleaned history to GitHub (this rewrites remote history)
git push --mirror https://github.com/jacobschulman/ski-run-scraper.git

# This FORCES GitHub to accept the rewritten history
# After this:
# - GitHub repo will be cleaned
# - All existing clones become "stale" (refs will be behind)
# - Fresh clones will be small/fast
```

### Step 6: Notify and Update Hetzner Server
```bash
# On Hetzner server, reset to the cleaned history
ssh root@hetzner

cd /home/scraper/ski-run-scraper

# Option A: Fresh clone (cleanest)
cd /home/scraper
mv ski-run-scraper ski-run-scraper.old-backup
git clone https://github.com/jacobschulman/ski-run-scraper.git
cd ski-run-scraper

# Option B: Fetch and reset (keeps git reflog)
git fetch --all
git reset --hard origin/main
git gc --aggressive

# Restart services
pm2 restart all
```

## Rollback Procedure (If Something Goes Wrong)

### If GitHub cleanup fails:
```bash
# Restore from backup
cd /tmp/ski-run-scraper.git.backup
git push --mirror https://github.com/jacobschulman/ski-run-scraper.git --force
```

### If Hetzner breaks:
```bash
# Fresh clone from backup
cd /home/scraper
rm -rf ski-run-scraper
git clone https://github.com/jacobschulman/ski-run-scraper.git
cd ski-run-scraper
pm2 restart all
```

## Important Warnings

⚠️ **FORCE PUSH**: This rewrites GitHub history. All developers must be aware.

⚠️ **STALE CLONES**: Existing clones of the repo will show as "behind" origin. They'll need to re-clone.

⚠️ **IRREVERSIBLE**: Once force-pushed to GitHub, old commits are gone (except in your backup).

⚠️ **NO PARTIAL ROLLBACK**: You can only rollback to the entire backup or accept the new cleaned state.

## Estimated Cleanup Time

| Step | Time | Notes |
|------|------|-------|
| Step 1: Backup mirror | 10-15 min | Large files, network dependent |
| Step 2: Fresh clone | 10-15 min | Another full copy |
| Step 3: Run filter-repo | 10-20 min | Depends on disk speed |
| Step 4: Verify | 2-5 min | Quick checks |
| Step 5: Force push | 5-10 min | GitHub API rate limits |
| Step 6: Hetzner update | 2-5 min | Fresh clone + restart |
| **TOTAL** | **40-70 min** | Can do during low traffic window |

## Alternative: More Aggressive Cleanup (ADVANCED)

If you want even more aggressive cleanup (keeping only code commits + latest data, NO old data history):

```bash
# Filter out all but the most recent version of each data file
git-filter-repo \
  --analyze \
  --force

# Then manually edit .git/filter-repo/analyze/large-blobs.txt
# Remove blobs for old data files you don't need

git-filter-repo \
  --blob-callback 'if blob.size > 1000000: stream.write(b"delete")' \
  --force
```

This could get you down to 200-300MB but is riskier.

## Timeline Recommendation

1. **Day 1 - Evening:** Run Steps 1-4 (verify cleanup works)
2. **Day 1 - Midnight:** Run Steps 5-6 (low traffic window)
3. **Day 2:** Announce completion, everyone re-clones as needed

This way you can verify the cleanup before committing to the force push.
