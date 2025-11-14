# Ski Run Scraper

Automated daily scraper for ski resort grooming and lift status data. Runs via GitHub Actions and provides historical data through a simple JSON API.

## 🔗 Live Data API

**API Documentation:** https://jacobschulman.github.io/ski-run-scraper/data/index.html

**Quick Links:**
- All resorts (latest): https://jacobschulman.github.io/ski-run-scraper/data/latest.json
- File index: https://jacobschulman.github.io/ski-run-scraper/data/index.json
- Keystone: https://jacobschulman.github.io/ski-run-scraper/data/keystone/2025-11-06.json
- Vail: https://jacobschulman.github.io/ski-run-scraper/data/vail/2025-11-06.json
- Park City: https://jacobschulman.github.io/ski-run-scraper/data/parkcity/2025-11-06.json
- Beaver Creek: https://jacobschulman.github.io/ski-run-scraper/data/beavercreek/2025-11-06.json

## Features

- **Daily automated scraping** at 7 AM MST via GitHub Actions
- **Historical data tracking** with timestamped files (one file per resort per day)
- **Multi-resort support** with easy configuration
- **Configurable season dates** (automatically skips scraping after season end)
- **GitHub Pages API** for easy data access
- **Separate data per resort** for efficient querying

## Current Resorts

- Keystone
- Vail
- Park City
- Beaver Creek

## Quick Start

### Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run the scraper:**
   ```bash
   # Scrape all resorts
   npm run scrape

   # Scrape a specific resort
   node ski-scraper.js keystone
   ```

3. **Data will be saved to:**
   - `data/{resort}/YYYY-MM-DD.json` - Daily timestamped data
   - `data/latest.json` - Most recent data from all resorts
   - `data/index.json` - Manifest of all available files

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

Edit `config.json` to add resorts:

```json
{
  "resorts": [
    {
      "key": "keystone",
      "name": "Keystone",
      "url": "https://www.keystoneresort.com/the-mountain/mountain-conditions/terrain-and-lift-status.aspx"
    },
    {
      "key": "beavercreek",
      "name": "Beaver Creek",
      "url": "https://www.beavercreek.com/the-mountain/mountain-conditions/terrain-and-lift-status.aspx"
    }
  ]
}
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
      "Id": 1,
      "Name": "North Peak",
      "Trails": [
        {
          "Id": 101,
          "Name": "Schoolmarm",
          "Difficulty": "Green",
          "IsOpen": true,
          "IsGroomed": true,
          "TrailLength": "3.5 miles",
          "TrailType": "Skiing"
        }
      ],
      "Lifts": []
    }
  ],
  "Lifts": [
    {
      "Id": 1,
      "Name": "River Run Gondola",
      "Status": "Open"
    }
  ]
}
```

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
│       └── daily-scrape.yml      # GitHub Actions workflow
├── data/
│   ├── index.html                # API documentation
│   ├── latest.json               # Latest data from all resorts
│   ├── index.json                # Manifest of all files
│   ├── keystone/
│   │   ├── 2025-01-05.json
│   │   ├── 2025-01-06.json
│   │   └── ...
│   └── vail/
│       └── 2025-01-05.json
├── config.json                   # Resort and schedule configuration
├── ski-scraper.js                # Main scraper script
├── package.json                  # Node.js dependencies
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
4. Test locally with `node ski-scraper.js {resort-key}`
5. Submit a PR!

## 📊 Browse Grooming Reports

View formatted grooming data with date navigation and historical tracking:

- **Keystone:** https://jacobschulman.github.io/ski-run-scraper/data/keystone.html
- **Vail:** https://jacobschulman.github.io/ski-run-scraper/data/vail.html
- **Park City:** https://jacobschulman.github.io/ski-run-scraper/data/parkcity.html
- **Beaver Creek:** https://jacobschulman.github.io/ski-run-scraper/data/beavercreek.html
