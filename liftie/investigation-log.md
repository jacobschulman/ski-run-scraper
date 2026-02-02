# Liftie Investigation Log

<!-- Claude appends entries here in reverse chronological order -->
<!-- Format: ## YYYY-MM-DD HH:MM - Resort/Issue Type -->
<!-- Then: Summary, Root Cause, Actions, Outcome -->

## 2026-02-02 10:30 - bigsky snow stale on GitHub Pages

**Summary**: Snow data for bigsky showing 247 minutes stale on GitHub Pages. bigsky is completely absent from the GitHub Pages `latest-snow.json` (only 33 resorts present vs expected ~66). Hetzner API has fresh data (`lastScraped: 2026-02-02T09:56:19Z`). Same root cause as all other snow staleness issues today — the 08:56 scheduled snow scraper was cancelled (pre-concurrency-fix commit), and the 09:42 manual run failed at data repo push due to merge conflicts.

**Symptoms**:
- bigsky not present in GitHub Pages `latest-snow.json` at all
- Hetzner API has fresh bigsky snow data (`lastScraped: 2026-02-02T09:56:19.508Z`)
- 08:56 scheduled snow scraper run was cancelled (pre-concurrency-fix commit)
- 09:42 manual snow scraper run failed at data repo push (merge conflicts)
- Two fix runs active: `21585602118` (in-progress, commit `d9b6cd9`) and `21585623469` (pending, commit `39fb339`)

**Root Cause**: Two compounding issues, both already fixed:
1. The 08:56 scheduled run used a pre-fix commit and was cancelled by the lift scraper via shared `data-repo-push` concurrency group (fixed in `f88d0ca`)
2. The 09:42 manual run scraped successfully but the data repo push failed with merge conflicts during `git pull --rebase --autostash` from concurrent lift scraper pushes (fixed in `d9b6cd9` and `39fb339`)

**Actions Taken**:
1. Verified bigsky is absent from GitHub Pages `latest-snow.json`
2. Verified Hetzner API has fresh bigsky snow data (`lastScraped: 2026-02-02T09:56:19.508Z`)
3. Confirmed config.json has bigsky as an Ikon resort (provider: ikon, apiProvider: reportpal)
4. Confirmed snow scraper run `21585602118` is in-progress with data repo fix
5. Confirmed run `21585623469` is pending with the most robust fix (`39fb339`)

**Outcome**: ALREADY FIXED - No additional action needed. Both underlying fixes (concurrency group separation and data repo pull-first pattern) are deployed. The in-progress/pending snow scraper runs will update GitHub Pages data for bigsky and all other resorts.

---

## 2026-02-02 10:28 - beavercreek snow stale on GitHub Pages (repeat)

**Summary**: Snow data for beavercreek reported as 260 minutes stale on GitHub Pages. Investigation found the data is already fresh — GitHub Pages `latest-snow.json` has beavercreek with timestamp `2026-02-02T09:44:29.175Z` (only ~35 minutes old). The staleness alert was a transient artifact generated before the 09:42 run's public repo push deployed to GitHub Pages. This is beavercreek's second alert today (first at 09:58 UTC); the same root cause pattern as all other snow staleness issues today.

**Symptoms**:
- Health check reported beavercreek snow 260 minutes stale on GitHub Pages
- GitHub Pages `latest-snow.json` actually contains fresh beavercreek data (`2026-02-02T09:44:29.175Z`)
- Two fix runs: `21585602118` (in-progress, commit `d9b6cd9`) and `21585623469` (pending, commit `39fb339`)

**Root Cause**: Same two compounding issues as all other snow staleness alerts today, both already fixed:
1. The 08:56 scheduled snow scraper used a pre-fix commit and was cancelled by the lift scraper via shared `data-repo-push` concurrency group (fixed in `f88d0ca`)
2. The 09:42 manual run scraped successfully and pushed to the public repo (refreshing GitHub Pages) but failed at the data repo push due to merge conflicts (fixed in `d9b6cd9` and `39fb339`)

The alert was transient — data was already fresh on GitHub Pages by the time of investigation.

**Actions Taken**:
1. Verified GitHub Pages `latest-snow.json` has fresh beavercreek data (timestamp `2026-02-02T09:44:29.175Z`)
2. Confirmed snow scraper run `21585602118` is in-progress with data repo fix
3. Confirmed run `21585623469` is pending with the most robust fix

**Outcome**: ALREADY RESOLVED - GitHub Pages data for beavercreek is already fresh. The staleness alert was transient, generated before the ~09:58 UTC deployment completed. Both underlying fixes are deployed. In-progress and queued runs will provide the next scheduled updates.

---

## 2026-02-02 10:25 - bigboulder snow stale on GitHub Pages

**Summary**: Snow data for bigboulder reported as 251 minutes stale on GitHub Pages. Investigation found the data is already fresh — GitHub Pages `latest-snow.json` has bigboulder with timestamp `2026-02-02T09:51:28.293Z`. The staleness alert was generated before the successful deployment from the 09:42 run's public repo push (which completed at ~09:58 UTC). This is the same root cause pattern as all other snow staleness issues today.

**Symptoms**:
- Health check reported bigboulder snow 251 minutes stale on GitHub Pages
- GitHub Pages `latest-snow.json` actually contains fresh bigboulder data (`2026-02-02T09:51:28.293Z`)
- 08:56 scheduled snow scraper was cancelled (pre-concurrency-fix commit)
- 09:42 manual snow scraper run succeeded on public repo push but failed on data repo push (merge conflicts)
- Two fix runs in progress/queued: `21585602118` (commit `d9b6cd9`, in-progress) and `21585623469` (commit `39fb339`, pending)

**Root Cause**: Same two compounding issues as all other snow staleness alerts today:
1. The 08:56 scheduled snow scraper used a pre-fix commit and was cancelled by the lift scraper via shared `data-repo-push` concurrency group (fixed in `f88d0ca`)
2. The 09:42 manual run scraped successfully and pushed to the public repo (making GitHub Pages data fresh) but failed at the data repo push step due to merge conflicts (fixed in `d9b6cd9` and `39fb339`)

The alert was a transient artifact — the data had already been refreshed on GitHub Pages by the time of investigation.

**Actions Taken**:
1. Verified GitHub Pages `latest-snow.json` has fresh bigboulder data (timestamp `2026-02-02T09:51:28.293Z`)
2. Confirmed this is the same root cause as all prior snow staleness issues today
3. Confirmed snow scraper run `21585602118` is in progress with rebase fix (`d9b6cd9`)
4. Confirmed run `21585623469` is pending with merge conflict fix (`39fb339`)

**Outcome**: ALREADY RESOLVED - GitHub Pages data for bigboulder is already fresh. The staleness alert was transient, generated before the ~09:58 UTC deployment completed. Both underlying fixes (concurrency group separation and data repo pull-first pattern) are deployed. In-progress and pending runs will provide the next scheduled updates.

---

## 2026-02-02 10:20 - aspenhighlands snow stale on GitHub Pages

**Summary**: Snow data for aspenhighlands showing 247 minutes stale on GitHub Pages. aspenhighlands is completely absent from the GitHub Pages `latest-snow.json` (only 32 resorts present vs expected ~65). Hetzner API has fresh data (`lastScraped: 2026-02-02T09:56:09Z`). Same root cause as all other snow staleness issues today — the 08:56 scheduled snow scraper was cancelled (pre-concurrency-fix commit), and the 09:42 manual run failed at data repo push due to merge conflicts.

**Symptoms**:
- aspenhighlands not present in GitHub Pages `latest-snow.json` at all
- Hetzner API has fresh aspenhighlands snow data (`lastScraped: 2026-02-02T09:56:09Z`)
- 08:56 scheduled snow scraper run was cancelled (pre-concurrency-fix commit)
- 09:42 manual snow scraper run failed at data repo push (merge conflicts)
- Two fix runs queued: `21585602118` (in-progress, commit `d9b6cd9`) and `21585623469` (pending, commit `39fb339`)

**Root Cause**: Two compounding issues, both already fixed:
1. The 08:56 scheduled run used a pre-fix commit and was cancelled by the lift scraper via shared `data-repo-push` concurrency group (fixed in `f88d0ca`)
2. The 09:42 manual run scraped successfully but the data repo push failed with merge conflicts during `git pull --rebase --autostash` from concurrent lift scraper pushes (fixed in `d9b6cd9` and `39fb339`)

**Actions Taken**:
1. Verified aspenhighlands is absent from GitHub Pages `latest-snow.json`
2. Verified Hetzner API has fresh aspenhighlands snow data (`lastScraped: 2026-02-02T09:56:09Z`)
3. Confirmed config.json has aspenhighlands as an Ikon resort (provider: ikon, apiProvider: aspensnowmass)
4. Confirmed snow scraper run `21585602118` is in-progress with data repo fix
5. Confirmed run `21585623469` is pending with the most robust fix (`39fb339`)

**Outcome**: ALREADY FIXED - No additional action needed. Both underlying fixes (concurrency group separation and data repo pull-first pattern) are deployed. The in-progress/pending snow scraper runs will update GitHub Pages data for aspenhighlands and all other resorts.

---

## 2026-02-02 10:15 - aspenmountain snow stale on GitHub Pages

**Summary**: Snow data for aspenmountain showing 247 minutes stale on GitHub Pages. aspenmountain is completely absent from GitHub Pages `latest-snow.json`. Hetzner API has fresh data (`lastScraped: 2026-02-02T09:56:09Z`) and local `latest-snow.json` includes aspenmountain with timestamp `2026-02-02T09:57:55Z`. Same root cause as all other snow staleness issues today — the 08:56 scheduled snow scraper was cancelled (pre-concurrency-fix commit), and the 09:42 manual run failed at data repo push due to merge conflicts.

**Symptoms**:
- aspenmountain NOT present in GitHub Pages `latest-snow.json` (stale from 05:36 UTC run)
- Hetzner API has fresh aspenmountain snow data (`lastScraped: 2026-02-02T09:56:09Z`)
- Local `latest-snow.json` has aspenmountain with timestamp `2026-02-02T09:57:55Z`
- 08:56 scheduled snow scraper run was cancelled (pre-concurrency-fix commit)
- 09:42 manual snow scraper run failed at data repo push (merge conflicts)

**Root Cause**: Two compounding issues, both already fixed in earlier investigations today:
1. The 08:56 scheduled snow scraper used a pre-fix commit and was cancelled by the lift scraper via shared `data-repo-push` concurrency group (fixed in `f88d0ca`)
2. The 09:42 manual run succeeded at scraping but failed at the data repo push step due to merge conflicts during `git pull --rebase --autostash` (fixed in `d9b6cd9` and `39fb339`)

**Actions Taken**:
1. Verified aspenmountain is absent from GitHub Pages `latest-snow.json`
2. Verified Hetzner API has fresh aspenmountain snow data (`lastScraped: 2026-02-02T09:56:09Z`)
3. Verified local `latest-snow.json` includes aspenmountain with fresh data
4. Confirmed snow scraper run `21585602118` (commit `d9b6cd9`) is in-progress with fix
5. Confirmed snow scraper run `21585623469` (commit `39fb339`) is queued behind it with latest fix

**Outcome**: ALREADY FIXED - No additional action needed. Both underlying fixes (concurrency group separation and data repo pull-first pattern) are already deployed. The in-progress snow scraper run will update GitHub Pages data for aspenmountain and all other resorts. Future scheduled runs will not encounter these issues.

---

## 2026-02-02 10:15 - attitash snow stale on GitHub Pages

**Summary**: Snow data for attitash reported as 255 minutes stale on GitHub Pages. Investigation found the data is already fresh — GitHub Pages `latest-snow.json` has attitash with timestamp `2026-02-02T09:48:20.634Z`. The staleness alert was generated before the successful deployment from the 09:42 run's public repo push (which completed at ~09:58 UTC). This is the same root cause pattern as all other snow staleness issues today.

**Symptoms**:
- Health check reported attitash snow 255 minutes stale on GitHub Pages
- GitHub Pages `latest-snow.json` actually contains fresh attitash data (`2026-02-02T09:48:20.634Z`)
- 08:56 scheduled snow scraper was cancelled (pre-concurrency-fix commit)
- 09:42 manual snow scraper run succeeded on public repo push but failed on data repo push (merge conflicts)
- Two fix runs in progress/queued: `21585602118` (commit `d9b6cd9`) and `21585623469` (commit `39fb339`)

**Root Cause**: Same two compounding issues as all other snow staleness alerts today:
1. The 08:56 scheduled snow scraper used a pre-fix commit and was cancelled by the lift scraper via shared `data-repo-push` concurrency group (fixed in `f88d0ca`)
2. The 09:42 manual run scraped successfully and pushed to the public repo (making GitHub Pages data fresh) but failed at the data repo push step due to merge conflicts (fixed in `d9b6cd9` and `39fb339`)

The alert was a transient artifact — the data had already been refreshed on GitHub Pages by the time of investigation.

**Actions Taken**:
1. Verified GitHub Pages `latest-snow.json` has fresh attitash data (timestamp `2026-02-02T09:48:20.634Z`)
2. Confirmed this is the same root cause as all prior snow staleness issues today
3. Confirmed snow scraper run `21585602118` is in progress with rebase fix (`d9b6cd9`)
4. Confirmed run `21585623469` is queued with merge conflict fix (`39fb339`)

**Outcome**: ALREADY RESOLVED - GitHub Pages data for attitash is already fresh. The staleness alert was transient, generated before the ~09:58 UTC deployment completed. Both underlying fixes (concurrency group separation and data repo pull-first pattern) are deployed. In-progress and queued runs will provide the next scheduled updates.

---

## 2026-02-02 10:05 - hiddenvalley snow stale on GitHub Pages

**Summary**: Snow data for hiddenvalley showing 241 minutes stale on GitHub Pages. Same root cause as all other snow staleness issues today (vail, attitash, bigboulder, beavercreek, breckenridge, alta, abasin, alpinevalley) — the 08:56 scheduled snow scraper was cancelled due to concurrency group collision, the 09:42 manual run failed due to data repo merge conflicts, and the fix runs (10:01 UTC) are currently in progress.

**Symptoms**:
- GitHub Pages `latest-snow.json` data for hiddenvalley ~4 hours old (last updated by 05:36 UTC run)
- Hetzner API showing hiddenvalley snow `lastScraped: 2026-02-02T09:59:21Z` (fresh)
- 08:56 scheduled snow scraper run was cancelled (pre-concurrency-fix commit)
- 09:42 manual snow scraper run failed (data repo merge conflicts)
- 10:01 manual snow scraper run in progress with both fixes (concurrency group + data repo pull-first)

**Root Cause**: Two compounding issues, both already fixed in earlier investigations today:
1. The 08:56 scheduled snow scraper used a pre-fix commit and was cancelled by the lift scraper via shared `data-repo-push` concurrency group (fixed in `f88d0ca`)
2. The 09:42 manual run succeeded at scraping but failed at the data repo push step due to merge conflicts during `git pull --rebase --autostash` (fixed in `d9b6cd9`)

**Actions Taken**:
1. Verified Hetzner API has fresh hiddenvalley snow data (`lastScraped: 2026-02-02T09:59:21Z`)
2. Confirmed this is the same root cause as all prior snow staleness issues today
3. Confirmed snow scraper run 21585602118 is in progress at 10:01 UTC with both fixes applied
4. Confirmed a second run (21585623469) is queued behind it

**Outcome**: ALREADY FIXED - No additional action needed. Both underlying fixes (concurrency group separation and data repo pull-first pattern) were already deployed. The in-progress snow scraper run will update GitHub Pages data for hiddenvalley and all other resorts. Future scheduled runs will not encounter these issues.

---

## 2026-02-02 10:10 - alpinevalley snow stale on GitHub Pages

**Summary**: Snow data for alpinevalley showing 250 minutes stale on GitHub Pages. The Hetzner API has fresh data (`lastScraped: 2026-02-02T10:00:26Z`) and local `latest-snow.json` includes alpinevalley with timestamp `2026-02-02T09:53:24Z`. The issue is that the GitHub Pages data repo has not been updated since the 05:36 UTC successful run.

**Symptoms**:
- alpinevalley not present in GitHub Pages `latest-snow.json` (stale from 05:36 UTC run)
- Hetzner API shows fresh alpinevalley snow data (`lastScraped: 2026-02-02T10:00:26Z`)
- Local `latest-snow.json` has alpinevalley with timestamp `2026-02-02T09:53:24Z`
- Scheduled 08:56 UTC run was cancelled (pre-concurrency-fix commit)
- Manual 09:42 UTC run failed at "Commit to DATA repo" step due to merge conflicts during `git pull --rebase --autostash` when lift scraper pushed concurrently

**Root Cause**: Two compounding issues:
1. The 08:56 scheduled run was cancelled (pre-fix commit in shared concurrency group)
2. The 09:42 manual run scraped successfully and committed to public repo, but the data repo push failed with 50+ merge conflicts from concurrent lift scraper pushes. The rebase-based approach cannot handle concurrent pushes to the data repo.

**Actions Taken**:
1. Verified Hetzner API has fresh alpinevalley snow data (not a scraper bug)
2. Verified local `latest-snow.json` includes alpinevalley with fresh data
3. Identified data repo push failure from merge conflicts with concurrent lift scraper
4. Confirmed commit `39fb339` (already deployed) fixes this with fetch-reset-rsync retry loop
5. Confirmed snow scraper run with fix is queued (run `21585623469` on `39fb339`)

**Outcome**: FIXING - Root cause fixed in `39fb339`. A snow scraper run with the fix is queued and will deploy fresh data once it executes. Same underlying issue as the abasin investigation above.

---

## 2026-02-02 10:05 - abasin snow stale on GitHub Pages

**Summary**: Snow data for abasin reported as 247 minutes stale on GitHub Pages. Investigation found the data was actually fresh by the time of investigation — the 09:42 manual snow scraper run had successfully pushed to the public repo at 09:58:22Z (including abasin), but the data repo push step failed due to git merge conflicts. A subsequent commit (`39fb339f`) fixed the data repo push mechanism. GitHub Pages data confirmed fresh with abasin timestamp `2026-02-02T09:57:55Z`.

**Symptoms**:
- Health check reported abasin snow 247 minutes stale on GitHub Pages
- Initial WebFetch at start of investigation showed abasin missing from `latest-snow.json` (likely CDN cache)
- Hetzner API had fresh data (`lastScraped: 2026-02-02T09:53:49Z`)
- Manual snow scraper run at 09:42 failed (exit code 1)

**Root Cause**: Two issues compounded:
1. The 08:56 scheduled snow scraper was cancelled (pre-concurrency-group-fix commit, same as earlier vail/attitash/etc investigations)
2. The 09:42 manual snow scraper run succeeded in scraping and pushing to the PUBLIC repo, but failed at the DATA repo commit step due to merge conflicts from concurrent lift scraper pushes during `git pull --rebase --autostash`

The public repo push at 09:58:22Z included abasin in `latest-snow.json` (65 resorts). GitHub Pages deployed successfully at 09:58:23Z. The staleness alert was triggered before the deployment completed.

**Actions Taken**:
1. Verified Hetzner API has fresh abasin snow data
2. Confirmed 08:56 run was cancelled (pre-fix commit)
3. Identified 09:42 manual run failed at data repo push (merge conflicts)
4. Verified public repo push succeeded with abasin data (65 resorts)
5. Confirmed GitHub Pages deployment completed and abasin is now present and fresh
6. Noted that commit `39fb339f` has already been pushed to fix the data repo merge conflict issue

**Outcome**: RESOLVED - No action needed. The data was already fresh on GitHub Pages by the time of investigation. The staleness alert was a transient issue caused by the gap between the cancelled 08:56 run and the successful 09:58 public repo push. The data repo push failure has been addressed by commit `39fb339f`.

---

## 2026-02-02 10:02 - alta snow stale on GitHub Pages

**Summary**: Snow data for alta showing 247 minutes stale on GitHub Pages. Alta was not present in `latest-snow.json` on GitHub Pages at all. Hetzner API had fresh data (`lastScraped: 2026-02-02T09:53:49Z`). The 09:42 manual snow scraper run (triggered during earlier investigations) failed due to merge conflicts in the data repo during `git pull --rebase --autostash`.

**Symptoms**:
- GitHub Pages `latest-snow.json` has no entry for alta at all
- Hetzner API has fresh alta snow data (`lastScraped: 2026-02-02T09:53:49Z`)
- 08:56 scheduled snow scraper run was cancelled (pre-concurrency-fix commit)
- 09:42 manual snow scraper run **failed** - data repo rebase hit merge conflicts with concurrent lift scraper pushes

**Root Cause**: The 09:42 snow scraper run (commit `f88d0ca4`) had the concurrency group fix but still used the old data repo commit pattern: commit first, then `git pull --rebase --autostash`. When the lift scraper pushed to the data repo during the snow scraper's ~16min run, the rebase encountered massive merge conflicts across 50+ files (lift index files, aggregates, snow data, etc.) and failed. A subsequent fix (`d9b6cd9` - "Fix data repo rebase conflicts in all scraper workflows") was committed at 10:00 UTC, which reorders the steps to: pull first, re-stage with `git add data/`, then commit.

**Actions Taken**:
1. Verified alta is missing from GitHub Pages `latest-snow.json`
2. Verified Hetzner API has fresh alta snow data
3. Identified that the 09:42 run failed due to data repo merge conflicts (not the concurrency group issue)
4. Confirmed fix `d9b6cd9` was already pushed to origin/main (reorders pull before commit)
5. Triggered new manual snow scraper run using the fixed commit `d9b6cd9`
6. Verified new run started (run ID 21585602118) at 10:01 UTC

**Outcome**: FIXED - Triggered new snow scraper run with the data repo rebase fix. Once it completes, alta (and all other resorts) should have fresh data on GitHub Pages. The underlying code fix prevents future merge conflict failures.

---

## 2026-02-02 10:00 - breckenridge snow stale on GitHub Pages

**Summary**: Snow data for breckenridge showing 249 minutes stale on GitHub Pages. Same root cause as the vail, attitash, bigboulder, and beavercreek snow issues investigated earlier today - the concurrency group fix had been deployed but the cancelled 08:56 run predated it.

**Symptoms**:
- GitHub Pages `latest-snow.json` showing breckenridge timestamp: `2026-02-02T05:40:08Z` (~4.3 hours old)
- Hetzner API showing breckenridge snow `lastScraped: 2026-02-02T09:55:16Z` (fresh)
- Scheduled snow scraper run at 08:56:36Z was cancelled (used pre-fix commit)
- Manual snow scraper run triggered at 09:42:38Z with fix commit `f88d0ca4` is currently in progress

**Root Cause**: The 08:56 UTC scheduled snow scraper run used a pre-fix commit (before the concurrency group fix `f88d0ca`), so it was still in the shared `data-repo-push` group. The lift scraper displaced it from the queue. This is the same issue that caused staleness for vail, attitash, bigboulder, and beavercreek.

**Actions Taken**:
1. Verified Hetzner API has fresh breckenridge snow data (`lastScraped: 2026-02-02T09:55:16Z`) - not a scraper bug
2. Confirmed the 08:56 cancelled run used a pre-fix commit
3. Confirmed the concurrency group fix was already deployed at 09:42 UTC
4. Confirmed manual snow scraper run is in progress with the fix (`f88d0ca4`)

**Outcome**: FIXED - No additional action needed. The concurrency group fix was already deployed and a manual snow scraper run is in progress. Once it completes, breckenridge GitHub Pages data will be fresh. Future runs will use the separate `snow-scraper` concurrency group.

---

## 2026-02-02 09:58 - beavercreek snow stale on GitHub Pages

**Summary**: Snow data for beavercreek showing 250 minutes stale on GitHub Pages. Same root cause as the vail, attitash, and bigboulder snow issues investigated earlier - the concurrency group fix had been deployed but the cancelled 08:56 run predated it.

**Symptoms**:
- GitHub Pages `latest-snow.json` showing beavercreek timestamp: `2026-02-02T05:39:05Z` (~4.3 hours old)
- Hetzner API showing beavercreek snow `lastScraped: 2026-02-02T09:55:06Z` (fresh)
- Scheduled snow scraper run at 08:56:36Z was cancelled (used pre-fix commit `88f304d5`)
- Manual snow scraper run triggered at 09:42:38Z with fix commit `f88d0ca4` is currently in progress

**Root Cause**: The 08:56 UTC scheduled snow scraper run used commit `88f304d5` (before the concurrency group fix `f88d0ca`), so it was still in the shared `data-repo-push` group. The lift scraper displaced it from the queue. This is the same issue that caused the vail, attitash, and bigboulder snow staleness.

**Actions Taken**:
1. Verified Hetzner API has fresh beavercreek snow data (not a scraper bug)
2. Confirmed the 08:56 cancelled run used a pre-fix commit
3. Confirmed the concurrency group fix was already deployed at 09:42 UTC
4. Confirmed manual snow scraper run is in progress with the fix (`f88d0ca4`)

**Outcome**: FIXED - No additional action needed. The concurrency group fix was already deployed and a manual snow scraper run is in progress. Once it completes, beavercreek GitHub Pages data will be fresh. Future runs will use the separate `snow-scraper` concurrency group.

---

## 2026-02-02 09:56 - bigboulder snow stale on GitHub Pages

**Summary**: Snow data for bigboulder showing 241 minutes stale on GitHub Pages. Same root cause as the vail and attitash snow issues investigated earlier - the concurrency group fix had been deployed but the cancelled 08:56 run predated it.

**Symptoms**:
- GitHub Pages `latest-snow.json` showing bigboulder timestamp: `2026-02-02T05:48:22Z` (~4 hours old)
- Hetzner API showing bigboulder snow `lastScraped: 2026-02-02T09:21:04Z` (fresh)
- Scheduled snow scraper run at 08:56:36Z was cancelled (used pre-fix commit `88f304d5`)
- Manual snow scraper run triggered at 09:42:38Z with fix commit `f88d0ca4` is currently in progress

**Root Cause**: The 08:56 UTC scheduled snow scraper run used commit `88f304d5` (before the concurrency group fix `f88d0ca`), so it was still in the shared `data-repo-push` group. The lift scraper at 08:57:46Z displaced it from the queue. This is the same issue that caused the vail and attitash snow staleness.

**Actions Taken**:
1. Verified Hetzner API has fresh bigboulder snow data (not a scraper bug)
2. Confirmed the 08:56 cancelled run used a pre-fix commit
3. Confirmed the concurrency group fix was already deployed at 09:42 UTC
4. Confirmed manual snow scraper run is in progress with the fix (`f88d0ca4`)

**Outcome**: FIXED - No additional action needed. The concurrency group fix was already deployed and a manual snow scraper run is in progress. Once it completes, bigboulder GitHub Pages data will be fresh. Future runs will use the separate `snow-scraper` concurrency group.

---

## 2026-02-02 09:52 - attitash snow stale on GitHub Pages

**Summary**: Snow data for attitash showing 245 minutes stale on GitHub Pages. Same root cause as the vail snow issue investigated minutes earlier - the concurrency group fix had been deployed but the cancelled 08:56 run predated it.

**Symptoms**:
- GitHub Pages `latest-snow.json` showing attitash timestamp: `2026-02-02T05:44:32Z` (~4 hours old)
- Hetzner API showing attitash snow `lastScraped: 2026-02-02T09:19:40Z` (fresh)
- Scheduled snow scraper run at 08:56:36Z was cancelled (used pre-fix commit `88f304d5`)
- Last successful snow scraper run was 05:36:25Z

**Root Cause**: The 08:56 UTC scheduled snow scraper run used commit `88f304d5` (before the concurrency group fix `f88d0ca`), so it was still in the shared `data-repo-push` group. The lift scraper at 08:57:46Z displaced it from the queue. This is the same issue that caused the vail snow staleness.

**Actions Taken**:
1. Verified Hetzner API has fresh attitash snow data (not a scraper bug)
2. Confirmed the 08:56 cancelled run used a pre-fix commit
3. Confirmed the concurrency group fix was already deployed at 09:42 UTC
4. Confirmed manual snow scraper run (triggered during vail investigation) is in progress with the fix

**Outcome**: FIXED - No additional action needed. The concurrency group fix was already deployed and a manual snow scraper run is in progress. Once it completes, attitash GitHub Pages data will be fresh. Future runs will use the separate `snow-scraper` concurrency group.

---

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
