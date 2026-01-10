# Liftie Context

## System Architecture

### Dual Data Sources (both being monitored!)

| Data Type | Hetzner | GitHub Pages | Notes |
|-----------|---------|--------------|-------|
| **Lifts** | Primary | N/A | Only on Hetzner |
| **Snow** | Monitored | Monitored | Transitioning to Hetzner |
| **Terrain** | Monitored | Monitored | Transitioning to Hetzner |

### Health Check URLs
- **Hetzner**: `http://46.62.169.104:3000/health/resorts`
- **GitHub Pages Snow**: `https://jacobschulman.github.io/ski-run-scraper/data/latest-snow.json`
- **GitHub Pages Terrain**: `https://jacobschulman.github.io/ski-run-scraper/data/latest.json`

### GitHub Actions (runs scrapers, deploys to GitHub Pages)
- `daily-scrape.yml` - Terrain/grooming data (hourly)
- `snow-scraper.yml` - Snow reports (hourly)
- Data commits to repo → auto-deployed to GitHub Pages

### Hetzner VPS (runs scrapers + API server)
- PM2 processes: `lift-scraper`, `snow-scraper`, `terrain-scraper`, `api-server`
- Code location: `/home/scraper/ski-run-scraper`
- API at `http://46.62.169.104:3000`

### Key Files
- Config: `config.json` (resort definitions, timezones, season dates)
- Scrapers: `vail-scraper.js`, `ikon-scraper.js`, `vail-lift-scraper.js`, `ikon-lift-scraper.js`, `canadian-scraper.js`

## Known Patterns
(Claude will add entries here as it learns from investigations)

## Resort-Specific Notes
(Claude will add entries here as it learns quirks about specific resorts)
