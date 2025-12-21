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
