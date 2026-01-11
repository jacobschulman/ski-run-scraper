# Liftie Investigation Log

<!-- Claude appends entries here in reverse chronological order -->
<!-- Format: ## YYYY-MM-DD HH:MM - Resort/Issue Type -->
<!-- Then: Summary, Root Cause, Actions, Outcome -->

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
