# Liftie Investigation Log

<!-- Claude appends entries here in reverse chronological order -->
<!-- Format: ## YYYY-MM-DD HH:MM - Resort/Issue Type -->
<!-- Then: Summary, Root Cause, Actions, Outcome -->

## 2026-02-02 09:45 - vail snow stale on GitHub Pages

**Summary**: Snow data for vail showing 242 minutes stale on GitHub Pages. Hetzner API data was fresh. Root cause was the snow scraper sharing a concurrency group with the lift scraper (every 10min) and terrain scraper (hourly), causing ~50% of snow scraper runs to be cancelled by GitHub Actions.

**Symptoms**:
- GitHub Pages `latest-snow.json` showing vail timestamp: `2026-02-02T05:38:02Z` (~4 hours old)
- Hetzner API showing vail snow `lastScraped: 2026-02-02T09:17:12Z` (fresh)
- Most recent snow scraper run (08:56:36Z) was cancelled
- Last successful snow scraper run was 05:36:25Z

**Root Cause**: All three GitHub Actions scrapers (lift, terrain, snow) shared the `data-repo-push` concurrency group with `cancel-in-progress: false`. GitHub Actions allows one running + one queued workflow per group. When a third enters, the queued one is cancelled. Since the lift scraper runs every 10 minutes, it frequently displaces the snow scraper from the queue.

Timeline of the cancelled run:
- 08:53:56Z - Terrain scraper started (running in `data-repo-push` group)
- 08:56:36Z - Snow scraper triggered, queued behind terrain
- 08:57:46Z - Lift scraper triggered, replaced snow scraper in queue → snow scraper cancelled

Analysis of last 20 runs showed ~50% cancellation rate for the snow scraper.

**Actions Taken**:
1. Verified Hetzner scraper data is fresh (not a scraper bug)
2. Analyzed GitHub Actions run history - found cancellation pattern
3. Traced concurrency group collision between lift/terrain/snow scrapers
4. Changed snow scraper concurrency group from `data-repo-push` to `snow-scraper`
5. Committed and pushed fix to main (f88d0ca)
6. Manually triggered snow scraper workflow to get immediate fresh data

**Outcome**: FIXED - Snow scraper now has its own concurrency group and won't be cancelled by other scrapers. Git push conflicts are handled by the existing rebase strategy.

---

## 2026-01-11 18:55 - alpinevalley snow stale on GitHub Pages

**Summary**: Snow data for alpinevalley showing 303 minutes stale on GitHub Pages, but fresh on Hetzner API. Root cause was a git autostash bug in the workflow.

**Symptoms**:
- GitHub Pages `latest-snow.json` showing alpinevalley timestamp: `2026-01-11T13:35:18Z` (~5 hours old)
- Hetzner API `/health/resorts` showing alpinevalley `lastScraped: 2026-01-11T18:23:06Z` (fresh)
- GitHub Actions workflow runs all succeeded (10 runs since morning)
- Workflow logs showed "no changes added to commit" after git status showed modified files

**Root Cause**: Bug in `snow-scraper.yml` and `daily-scrape.yml` workflows. When `git pull --rebase --autostash` runs and there are concurrent commits, autostash restores local changes as **modified-but-unstaged**. The subsequent `git commit` then fails because nothing is staged.

Evidence from workflow logs:
```
Created autostash: 917e5bcd
Fast-forward
... (rebase completed)
Applied autostash.
... (git status shows modified files)
no changes added to commit
Everything up-to-date
```

**Actions Taken**:
1. Verified Hetzner scraper is working fine (data is fresh there)
2. Analyzed GitHub Actions logs - found "no changes added to commit" error
3. Identified autostash behavior causing changes to be unstaged after rebase
4. Fixed both `snow-scraper.yml` and `daily-scrape.yml` by adding `git add data/` after the rebase
5. Created PR #33: https://github.com/jacobschulman/ski-run-scraper/pull/33

**Outcome**: FIXED (pending PR merge) - Added re-staging of data after rebase in both workflows. Once merged, the next hourly run should successfully commit and push data to GitHub Pages.
