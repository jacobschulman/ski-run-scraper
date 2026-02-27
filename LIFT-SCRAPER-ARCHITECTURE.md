# Lift Scraper Architecture

Reference doc for the lift data pipeline. Updated Feb 2026.

## Three-Tier System

| Tier | What it provides | Update frequency | Where it runs |
|------|-----------------|-------------------|---------------|
| **Real-time** | Actual wait time minutes | 45s (vail), ~2min (live-scraper instances) | Hetzner VPS |
| **Status** | Open/Closed lift status | 10min (Vail via GH Actions), 2min (Ikon via Hetzner HTTP) | GH Actions + Hetzner |
| **Schedule** | Published hours only | N/A | No scraping, hardcoded |

## Hetzner Processes (PM2)

All managed via `hetzner/ecosystem.config.js`. Auto-deployed by `hetzner/deploy.sh` every 5 min.

| Process | Script | What it does | Memory limit |
|---------|--------|--------------|-------------|
| `vail-live-scraper` | `vail-live-scraper.js` | **DO NOT TOUCH.** Dedicated Vail-only scraper, 45s cycle, keeps browser alive. Gold standard. | 800M |
| `lift-scraper-vail` | `lift-scraper-vail.js` | LEGACY queue scraper for `enabledResorts`. Keep during transition, remove after live-scrapers are stable. | 1200M |
| `live-scraper-a` | `live-scraper.js a` | Fresh-browser-per-resort scraper for group a (breckenridge, parkcity, keystone). Currently commented out. | 400M |
| `live-scraper-b` | `live-scraper.js b` | Group b (heavenly, northstar, kirkwood). Commented out. | 400M |
| `live-scraper-c` | `live-scraper.js c` | Group c (stowe, mountsnow, beavercreek, crestedbutte). Commented out. | 400M |
| `lift-scraper-others` | `lift-scraper-others.js` | HTTP API scraper for all Ikon resorts (Inspector, Aspen, ReportPal, DOR, Zaneray). Lightweight, 2min cycle. | 300M |
| `snow-scraper` | `snow-scraper-persistent.js` | Snow reports, 30min cycle. | 1500M |
| `terrain-scraper` | `terrain-scraper-persistent.js` | Daily grooming/trail status. | 1500M |
| `api-server` | `api-server.js` | Express server on port 3000. Serves lift data to the app. | 500M |
| `aggregates` | `generate-aggregates.js` | Hourly summary generation (cron). | N/A |

## GitHub Actions Processes

| Workflow | Schedule | What it does |
|----------|----------|-------------|
| `lift-scraper.yml` | Every 10 min | Runs `vail-lift-scraper.js` (ALL ~39 Vail resorts for open/closed) + `ikon-lift-scraper.js` (all Ikon). Generates lift JSON, commits to both public and data repos. |
| `snow-scraper.yml` | Every 30 min | Snow report scraping. |
| `terrain-scraper.yml` | Once daily | Grooming/trail data. |

## Data Flow

```
Scrapers (Hetzner + GH Actions)
    │
    ▼
data/{resort}/lifts/{YYYY-MM-DD}.ndjson    ← Raw scrape data (one JSON line per lift per timestamp)
    │
    ▼
generate-lift-data.js (npm run generate:lifts)
    │
    ▼
data/{resort}/lifts/index.json             ← Per-resort lift summary (latest snapshot)
    │
    ▼
generate-latest-lifts.js (npm run generate:latest-lifts)
    │
    ▼
data/latest-lifts.json                     ← All resorts aggregated (used by GH Pages)

lib/file-storage.js → data/index.json      ← Resort capabilities index (dataCapabilities)
```

### How the app fetches lift data

1. App calls `shouldUseHetznerForResort(resortKey)`
2. Checks Firebase Remote Config `liveLiftResortOverrides` first (per-resort override)
3. Falls back to `data/index.json` → `dataCapabilities.liftWaitTimesAvailable`
4. If true → fetch from Hetzner API (`/data/{resort}/lifts/index.json`)
5. If false → fetch from GitHub Pages (same path, different host)

## Config: `config.json`

### `liftScraping.vail`

```json
{
  "enabledResorts": ["beavercreek", "breckenridge", "crestedbutte"],
  "_enabledResortsNote": "LEGACY: Used by lift-scraper-vail.js. Remove once live-scrapers stable.",
  "instances": {
    "a": { "resorts": ["breckenridge", "parkcity", "keystone"], "cycleMs": 120000 },
    "b": { "resorts": ["heavenly", "northstar", "kirkwood"], "cycleMs": 120000 },
    "c": { "resorts": ["stowe", "mountsnow", "beavercreek", "crestedbutte"], "cycleMs": 120000 }
  },
  "disabledResorts": ["telluride"]
}
```

- `enabledResorts` → read by legacy `lift-scraper-vail.js`
- `instances` → read by new `live-scraper.js`
- `disabledResorts` → read by GH Actions `vail-lift-scraper.js` (telluride has non-standard URL)

### `liftScraping.ikon`

```json
{
  "enabledProviders": ["inspector", "aspensnowmass", "reportpal", "dor", "zaneray"]
}
```

All Ikon providers return status only. No Ikon resort has real wait time data (audited Feb 2026).

### Per-resort `liftWaitTimesAvailable`

This boolean flag is the source of truth for whether a resort provides real numeric wait times.

**Vail resorts with real wait times (13):** vail, beavercreek, breckenridge, parkcity, keystone, crestedbutte, heavenly, northstar, kirkwood, stowe, mountsnow, hunter, whistlerblackcomb

**Ikon resorts with real wait times: NONE** (all return null)

This flag flows through: `config.json` → `computeDataCapabilities()` → `data/index.json` → app reads `dataCapabilities.liftWaitTimesAvailable` → decides Hetzner vs GitHub.

### `dataSource` field

Added to `latest-lifts.json` output. Values:
- `'realtime'` → resort has actual wait time numbers
- `'status'` → resort has open/closed only

The app doesn't use this yet but it's available for the native app to consume when ready.

## Firebase Remote Config

Key flags that affect lift data:

| Key | Default | Purpose |
|-----|---------|---------|
| `waitTimesEnabled` | false | Master kill-switch for all wait time UI |
| `liftDataProvider` | 'hetzner' | 'github' or 'hetzner' |
| `hetznerBaseUrl` | 'http://46.62.169.104:3000' | Hetzner API URL |
| `liveLiftResortOverrides` | {} | Per-resort JSON override for Hetzner/GitHub selection |

### `liveLiftResortOverrides` format

```json
{
  "vail": true,
  "beavercreek": true,
  "*": false
}
```

- Named resort → force Hetzner (`true`) or GitHub (`false`)
- `"*"` or `"_default"` → default for unlisted resorts
- Overrides take priority over `liftWaitTimesAvailable` in data index

## Staged Rollout Plan

### Phase 1 (current push)
- All config changes deployed (Ikon fixes, GH Actions filter, dataSource field)
- `live-scraper.js` deployed but all instances commented out
- Legacy `lift-scraper-vail` continues running unchanged
- GH Actions now scrapes all ~39 Vail resorts (up from 14)

### Phase 2: Enable live-scraper-a
1. Uncomment `live-scraper-a` in `ecosystem.config.js`
2. Push, wait for auto-deploy
3. Verify: `pm2 logs live-scraper-a --lines 50`
4. Check data: `ls -la data/parkcity/lifts/`
5. Monitor memory: `free -m`
6. Watch for restart loops: `pm2 describe live-scraper-a`
7. Rollback: `pm2 stop live-scraper-a`

### Phase 3: Enable live-scraper-b
Same as Phase 2. Monitor total memory with both a + b running.

### Phase 4: Enable live-scraper-c
Same. All 12 resorts now on live-scraper instances.

### Phase 5: Remove legacy
1. Remove `lift-scraper-vail` from ecosystem
2. Remove `enabledResorts` from config
3. Push

## Testing live-scraper.js

```bash
# On Hetzner - single cycle test (ignores dead hours)
node live-scraper.js a --test

# Watch a running instance
pm2 logs live-scraper-a --lines 50

# Check health data
cat health.json | jq '.live_a'

# Memory check
free -m
pm2 jlist | jq '.[] | {name, monit: .monit}'
```

## Why Fresh Browser Per Resort

The old queue scraper (`lift-scraper-vail.js`) navigated one browser to many URLs. Chrome with `--single-process` leaks memory across navigations (grew to 3-4GB RSS, OOM killed). The new `live-scraper.js` launches a fresh browser per resort, scrapes, closes. Slightly slower (~3s browser launch overhead) but zero memory leak accumulation.

## Dead Resorts / Known Issues

- **laurelmountain** - Dead since Jan 25, 2026. Always returned null wait times. Removed from `enabledResorts`.
- **telluride** - Non-standard URL format, excluded via `disabledResorts`.
- **alta, abasin, taos, revelstoke** - Inspector API returns nothing. Likely name mismatch in the API.
- **All Ikon wait times** - Inspector, ReportPal, DOR all return null. ReportPal worked until ~Feb 9, 2026 (only Big Sky's Lone Peak Tram had data).
