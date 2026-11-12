# Ski Run Scraper

Automated daily scraper for ski resort grooming, snow, and lift status/waits (Vail + Inspector/Ikon providers). Runs via GitHub Actions and publishes historical data through a simple JSON API.

## 🔗 Live Data API

**API Documentation:** https://jacobschulman.github.io/ski-run-scraper/data/index.html

**Quick Links:**
- All resorts (latest combined groom/snow snapshot): https://jacobschulman.github.io/ski-run-scraper/data/latest.json
- **Global Leaderboard/Aggregates:** https://jacobschulman.github.io/ski-run-scraper/data/aggregates/latest.json
- File index (per-resort manifest): https://jacobschulman.github.io/ski-run-scraper/data/index.json
- Lift wait index (per-resort): `https://jacobschulman.github.io/ski-run-scraper/data/{resort}/lifts/index.json`
- Terrain index (per-resort): `https://jacobschulman.github.io/ski-run-scraper/data/{resort}/terrain/index.json`
- Lift wait NDJSON: `https://jacobschulman.github.io/ski-run-scraper/data/{resort}/lifts/{YYYY-MM-DD}.ndjson`
- Example groom/snow file: https://jacobschulman.github.io/ski-run-scraper/data/keystone/2025-11-06.json

**Aggregates API (for leaderboards):** See [AGGREGATES.md](AGGREGATES.md) for full documentation on building global leaderboards with rankings, superlatives, regional data, and forecasts.

## Features

- **Dual providers:** Vail (Puppeteer) + Inspector/Ikon (HTTP API), each writing normalized terrain/snow and lift data.
- **Daily automated scraping** once per resort per local morning window (filenames use the resort's local date).
- **Historical data tracking** with timestamped files (one file per resort per day) plus per-resort terrain indexes.
- **Real-time lift waits**: independent lift scraper writes NDJSON and per-resort lift indexes.
- **Configurable season/window** (skips off-season or outside scraping window unless forced).
- **GitHub Pages API** for easy data access.

## Current Resorts

See `config.json` for the full list (Vail + Inspector/Ikon resorts).

## Quick Start

### Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run the scraper:**
   ```bash
   # Scrape all Vail resorts
   npm run scrape

   # Scrape Ikon resorts via Inspector HTTP API
   node ikon-scraper.js

   # Scrape a specific Vail resort (Puppeteer flow)
   node vail-scraper.js keystone

   # Force a backfill/override window checks for debugging
   FORCE_SCRAPE=true node ikon-scraper.js
   ```

3. **Data will be saved to:**
   - `data/{resort}/YYYY-MM-DD.json` - Daily timestamped terrain/snow data
   - `data/{resort}/terrain/index.json` - Per-resort terrain manifest
   - `data/{resort}/lifts/{YYYY-MM-DD}.ndjson` - Lift wait/status stream (real-time)
   - `data/{resort}/lifts/index.json` - Per-resort lift manifest (latest status + history stats)
   - `data/latest.json` - Most recent terrain/snow from all resorts
   - `data/index.json` - Manifest of all available terrain/snow files

### GitHub Actions Setup

1. **Push this repo to GitHub**

2. **Enable GitHub Actions:**
   - Go to repository Settings → Actions → General
   - Ensure Actions are enabled

3. **Enable GitHub Pages:**
   - Go to repository Settings → Pages
   - Source: Deploy from a branch
   - Branch: `main`, folder: `/ (root)`
   - Save

4. **Access your data:**
   - API Documentation: `https://{username}.github.io/{repo}/data/index.html`
   - Latest data: `https://{username}.github.io/{repo}/data/latest.json`
   - Resort-specific: `https://{username}.github.io/{repo}/data/keystone/2025-01-05.json`

## Configuration

### Adding New Resorts

1. Edit `config.json` to add the resort:

```json
{
  "resorts": [
    {
      "key": "keystone",
      "name": "Keystone",
      "timezone": "America/Denver",
      "terrainUrl": "https://www.keystoneresort.com/the-mountain/mountain-conditions/terrain-and-lift-status.aspx",
      "snowReportUrl": "https://www.keystoneresort.com/the-mountain/mountain-conditions/snow-and-weather-report.aspx"
    }
  ]
}
```

2. Generate landing pages for the new resort:

```bash
node generate-landing-pages.js
```

3. Test locally:

```bash
node vail-scraper.js keystone
```

### Adjusting Schedule

Edit `.github/workflows/daily-scrape.yml` and change the cron expression:

```yaml
schedule:
  # "0 14 * * *" = 7 AM MST (2 PM UTC in winter)
  # Adjust hour as needed for your timezone
  - cron: '0 14 * * *'
```

**Timezone Reference:**
- 7 AM MST = 14:00 UTC (winter) or 13:00 UTC (summer DST)
- Use [Crontab Guru](https://crontab.guru/) to adjust timing

### Season End Date

Edit `config.json` to change when scraping stops:

```json
{
  "season": {
    "endDate": "05-01",
    "comment": "Format: MM-DD. Scraper will skip runs after this date each year."
  }
}
```

## Data Structure

Each resort's JSON file contains:

```json
{
  "Date": "2025-01-05T12:00:00Z",
  "ResortId": 8,
  "GroomingAreas": [
    {
      "Name": "North Peak",
      "Trails": [
        {
          "Name": "Schoolmarm",
          "Difficulty": "Green",
          "IsOpen": true,
          "IsGroomed": true,
          "TrailLength": "3.5 miles",
          "TrailType": "Skiing"
        }
      ]
    }
  ],
  "SnowReport": { ... } // Inspector-normalized fields when present
}
```

### Cadence & lift data
- Grooming and snow files are written once per resort per local day during the morning window; they only rewrite when `GroomingAreas` change (lift churn is ignored).
- Real-time lift wait/status data is captured by a separate lift scraper (Inspector API) that fetches all resorts in one call; output lives in `data/{resort}/lifts/YYYY-MM-DD.ndjson` with per-resort lift indexes.

## Usage Examples

### JavaScript / Node.js

```javascript
// Fetch latest data for all resorts
const response = await fetch('https://{username}.github.io/{repo}/data/latest.json');
const data = await response.json();

// Get Keystone data
const keystone = data.keystone.data;
console.log(`Keystone - ${keystone.GroomingAreas.length} areas`);
```

### Python

```python
import requests

# Fetch specific resort and date
url = 'https://{username}.github.io/{repo}/data/keystone/2025-01-05.json'
data = requests.get(url).json()

# Count groomed trails
groomed = sum(
    1 for area in data['GroomingAreas']
    for trail in area['Trails']
    if trail['IsGroomed']
)
print(f"Groomed trails: {groomed}")
```

### LED Matrix Example

```javascript
// Fetch only what you need - saves bandwidth
fetch('https://{username}.github.io/{repo}/data/vail/2025-01-05.json')
  .then(res => res.json())
  .then(data => {
    const groomed = data.GroomingAreas
      .flatMap(area => area.Trails)
      .filter(trail => trail.IsGroomed && trail.IsOpen);

    displayOnMatrix(groomed.map(t => t.Name));
  });
```

## Project Structure

```
ski-run-scraper/
├── .github/
│   └── workflows/
│       └── daily-scrape.yml         # GitHub Actions workflow
├── data/
│   ├── index.html                   # API documentation
│   ├── latest.json                  # Latest terrain data from all resorts
│   ├── latest-snow.json             # Latest snow data from all resorts
│   ├── index.json                   # Manifest of all files
│   ├── styles.css                   # Shared styles for landing pages
│   ├── resort.js                    # Shared JavaScript for grooming pages
│   ├── keystone/
│   │   ├── grooming.html            # Grooming report landing page
│   │   ├── snow.html                # Snow report landing page
│   │   ├── terrain/
│   │   │   ├── 2025-11-05.json
│   │   │   └── 2025-11-06.json
│   │   └── snow/
│   │       ├── 2025-11-05.json
│   │       ├── 2025-11-06.json
│   │       └── latest.json
│   └── vail/
│       ├── grooming.html
│       ├── snow.html
│       └── ...
├── templates/
│   ├── grooming.html                # Universal grooming page template
│   └── snow.html                    # Universal snow page template
├── config.json                      # Resort and schedule configuration
├── vail-scraper.js                  # Vail Resorts scraper (Puppeteer)
├── ikon-scraper.js                  # Ikon Pass scraper (Inspector API)
├── vail-lift-scraper.js             # Vail lift wait times (Puppeteer)
├── ikon-lift-scraper.js             # Ikon lift wait times (Inspector API)
├── snow-scraper.js                  # Hourly snow report scraper (both providers)
├── generate-landing-pages.js        # Landing page generator
├── package.json                     # Node.js dependencies
└── README.md
```

## Troubleshooting

### Manual Testing

Trigger a manual scrape:
1. Go to your GitHub repo → Actions tab
2. Select "Daily Ski Data Scraper" workflow
3. Click "Run workflow"

### Check Logs

View scraper output:
1. Go to Actions tab
2. Click on the latest workflow run
3. View job logs

### Common Issues

**Puppeteer fails in GitHub Actions:**
- The workflow includes `--no-sandbox` flag which should handle this
- Check the Actions logs for specific errors

**Data not updating:**
- Verify the workflow is enabled in Actions settings
- Check if season end date has passed
- Review workflow logs for errors

**GitHub Pages not serving files:**
- Ensure Pages is enabled in repository settings
- Wait a few minutes after enabling for DNS propagation
- Check that Pages is set to deploy from the correct branch

## License

MIT

## Contributing

To add support for additional resorts:
1. Find the resort's terrain status page (usually `{resort}.com/terrain-and-lift-status`)
2. Verify it uses the same `FR.TerrainStatusFeed` data structure
3. Add the resort to `config.json`
4. Test locally with `node vail-scraper.js {resort-key}`
5. Submit a PR!

## 📊 Browse Grooming & Snow Reports

View formatted grooming and snow data with date navigation and historical tracking:

**Grooming Reports:**
- **Keystone:** https://jacobschulman.github.io/ski-run-scraper/data/keystone/grooming.html
- **Vail:** https://jacobschulman.github.io/ski-run-scraper/data/vail/grooming.html
- **Park City:** https://jacobschulman.github.io/ski-run-scraper/data/parkcity/grooming.html
- **Beaver Creek:** https://jacobschulman.github.io/ski-run-scraper/data/beavercreek/grooming.html

**Snow Reports:**
- **Keystone:** https://jacobschulman.github.io/ski-run-scraper/data/keystone/snow.html
- **Vail:** https://jacobschulman.github.io/ski-run-scraper/data/vail/snow.html
- **Park City:** https://jacobschulman.github.io/ski-run-scraper/data/parkcity/snow.html
- **Beaver Creek:** https://jacobschulman.github.io/ski-run-scraper/data/beavercreek/snow.html

## 🎨 Landing Page Management

Landing pages are generated from universal templates that auto-detect the resort from the URL.

### Current Resorts

The scraper now supports 40+ resorts across North America and Australia. See `config.json` for the complete list.

### Generating Landing Pages

After adding a new resort to `config.json`, run:

```bash
node generate-landing-pages.js
```

This will:
- Create `grooming.html` and `snow.html` for each resort with appropriate URLs configured
- Update existing pages if templates have changed
- Auto-detect resort name and timezone from the URL path

**Important:** Changes to template files require re-running the script to propagate:

```bash
# 1. Edit templates/grooming.html or templates/snow.html
# 2. Regenerate all landing pages
node generate-landing-pages.js
```

### Template Files

- `templates/grooming.html` - Universal grooming report template
- `templates/snow.html` - Universal snow report template

Both templates use JavaScript to auto-detect which resort they're displaying based on the URL path.

## Read-only preseason audit

```bash
npm run audit:scrapers
# Limit sources, optionally compare lift values with local Chromium:
npm run audit:scrapers -- --resorts keystone,stowe --browser keystone,stowe
npm run test:audit
```

The audit checks configured public sources without running production scrapers,
contacting deployment servers, or publishing data. It saves `report.json`,
`report.txt`, and raw responses under `.cache/scraper-audit/<timestamp>/` (ignored
by Git). Inspector is fetched once; requests have a 20-second deadline and use
three workers. Optional browser checks use the installed Puppeteer browser.

Results distinguish HTTP errors, missing embedded data, empty terrain, and
extracted but unverified payloads. A successful response is not proof of accurate
conditions. Source timestamps are preserved without replacing them with fetch
time. Snow semantics and Canadian custom parsers still need separate validation;
browser comparisons are sequential samples and do not establish cloud-network
accessibility or ongoing freshness. The command exits successfully when the audit
completes, even if sources fail; inspect the report for source outcomes.

For a focused Vail browser/HTTP comparison and replay of its observed public
terrain API request, run `node scripts/audit-vail-parity.js keystone`. This writes
a separate audit directory and preserves exact status representations for comparison.

### Historical snow compatibility

Vail snow serialization is shared in `lib/vail-snow-normalization.js`. Run
`npm run test:snow-compatibility` to check it against the committed Breckenridge
2025-11-15 fixture (copied from `HEAD:data/breckenridge/snow/2025-11-15.json`
during the November 2026 audit).

Preserve existing snow field names, source-reported inches/cm, resort-local
`date`, UTC collection `timestamp`, source `lastUpdated`, forecast structure,
and the daily JSON/latest JSON/intraday NDJSON paths. `provider` is an existing
additive field absent from the early historical fixture. Audit metadata stays
outside published records. Legacy missing-number defaults are unchanged;
compatibility does not establish freshness. A stale preseason zero report must
not be treated as a new measured zero for year-over-year comparisons. Missing
historical dates must likewise remain missing rather than being filled with zero.

## Recovery runs (2026/27)

Keep broad scheduled publishing disabled while qualifying sources. The snow collector
now requires `SCRAPER_RESORTS` (comma-separated keys); existing broad commands
without an allowlist deliberately stop. No Hetzner deployment is needed.

```bash
# Actual APIs; only accepted candidate files and diagnostics under .cache/
SCRAPER_DRY_RUN=1 SCRAPER_RESORTS=abasin,mammoth,jacksonhole,bigsky,aspenmountain node snow-scraper.js ikon
# Embedded JSON over HTTP, separately qualified from an API
SCRAPER_DRY_RUN=1 SCRAPER_RESORTS=keystone,breckenridge VAIL_SNOW_TRANSPORT=http node snow-scraper.js vail
# Compare the same raw snow fields with Chrome; nonzero exit on mismatch/rejection
node scripts/check-vail-snow-parity.js keystone
npm run test:recovery
```

Dry runs bypass season filtering for diagnostics, but never bypass freshness.
Production runs still use configured season dates. Removing `SCRAPER_DRY_RUN`
writes accepted records locally using the existing paths, schema, units and
normalizers; it does not deploy or push. Restore historical data before a local
production run: this checkout excludes `data/` through sparse checkout.

The publication gate rejects snow reports older than 30 hours, more than 15
minutes in the future, missing/unparseable timestamps, and payloads without snow
measurements. Fresh measured zero is valid. It uses Inspector's **SnowReport**
update, not the feed update; Zaneray's snow update, not its wrapper update.
Vail timezone abbreviations are explicit; Aspen and Zaneray local report dates
use the configured resort timezone. SnoCountry offset-free timestamps and
Canadian source timestamps remain unqualified and blocked. Rejections preserve
existing daily files, latest files, NDJSON history and database records. Audit
reasons stay in separate `run.json` files, outside the historical data schema.
The gate also covers the legacy root Vail/Inspector/Canadian snow writers;
Hetzner scripts and servers have not been changed.

A completed dry-run command can include rejected sources. Inspect its report or
run `node scripts/check-recovery-results.js` to require every selected source to
pass. The `Scraper readiness (no publishing)` GitHub workflow (manual or recovery-branch push) does
this check and uploads candidates/reasons as artifacts. It has read-only repo
permissions and no schedule or publishing steps. It runs cloud diagnostics without checking out or modifying historical `data/`.

To qualify direct access: test the exact configured endpoint without browser
cookies; require valid schema and source freshness (HTTP 200 alone is not enough);
compare overlapping fields with the official page/browser; repeat during resort
operating hours to check freshness; then run the same test on GitHub's cloud IP.
Successful local access does not establish cloud accessibility. Vail lift waits
remain unqualified: the observed background terrain endpoint returned an explicit
failure even in Chrome. Do not replace the lift collector based on snow results.

The `Breck and Keystone pilot` workflow collects snow and terrain at minute 17
of every second UTC hour (`17 */2 * * *`), with manual dispatch available. GitHub
may delay scheduled jobs. It uses direct HTTP to the public pages' embedded JSON;
this is not the unreliable background terrain API. No browser or Hetzner host
is needed. Live lift polling remains out of scope.

Run `node scripts/run-vail-pilot.js` for a read-only dry run. Both resorts must
pass before `--publish` writes anything. Terrain uses the final labeled
`FR.TerrainStatusFeed` assignment and restores browser-added area `order`.
It preserves source keys, labels, booleans, nulls, IDs, local daily filenames,
the existing UTC terrain copy, and aggregate shapes. The feed timestamp must
be within 30 hours; it does not prove when an operator last changed a trail.
An all-closed, nonempty report is valid; an empty or failed feed is rejected.

The pilot checks out both resorts' existing snow/terrain history and both global
aggregates, merges only those resorts, appends snow NDJSON, and retains old index
entries. A separate commit guard rejects deletions, historical daily rewrites,
and unrelated paths. Concurrent main-branch changes cause a safe push failure;
the next run retries with a fresh checkout. The existing branch-based Pages site is explicitly rebuilt through the GitHub
Pages API after the data commit, and the job waits for that commit to publish.
Source failures fail the job and retain the previous published data. Review the
Actions result and `vail-pilot-evidence` artifact; enable GitHub failed-workflow
notifications for ongoing monitoring. This pilot does not rebuild SQLite-derived
per-trail streak pages or replace existing lift streams.
