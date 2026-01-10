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

## Data Validation Rules

When investigating data issues, check for these red flags:

### Terrain Data Quality
| Issue | What to Look For | Root Cause Pattern |
|-------|------------------|-------------------|
| **Empty Trails array** | `Trails: []` but `trailsOpen > 0` or `trailsTotal > 0` | Scraper parsed stats but failed on trail details |
| **Empty Lifts array** | `Lifts: []` but `liftsOpen > 0` or `liftsTotal > 0` | Scraper parsed stats but failed on lift details |
| **Stats mismatch** | `trailsOpen: 50` but `Trails.length: 10` | Partial parsing failure or data truncation |
| **Wrong data type** | Terrain file has `baseDepth`, `snowfall24`, `snowConditions` | Snow data echoed to terrain (scraper bug) |
| **Empty during hours** | No trails/lifts data between 8am-5pm local time | Scraper crash or source unavailable |

### Snow Data Quality
| Issue | What to Look For | Root Cause Pattern |
|-------|------------------|-------------------|
| **Missing key fields** | No `baseDepth`, `snowfall24`, or `snowConditions` | Parse failure or source format changed |
| **Wrong data type** | Snow file has `Trails`, `Lifts`, `trailsOpen` | Terrain data echoed to snow (scraper bug) |
| **Suspicious zeros** | `baseDepth: 0` in peak season (Dec-Mar) | Parse failure (valid resorts have >12" base) |

### Lift Data Quality
| Issue | What to Look For | Root Cause Pattern |
|-------|------------------|-------------------|
| **Sparse data after noon** | < 3 lifts with status after 12pm local | Scraper timeout or blocked by resort |
| **Stuck timestamps** | Same timestamp for hours | Scraper in cooldown loop (check PM2 logs) |
| **All lifts "unknown"** | Every lift has `status: unknown` | Source format changed or blocked |

### General Patterns
- **Timeout loop**: Large resorts (Vail, Whistler) can time out, hit cooldown, time out again. Fix: `pm2 restart lift-scraper`
- **Echoed data**: If terrain looks like snow or vice versa, the scraper is returning wrong data type
- **Missing from source**: Resort in config but not in data file = scraper crash or never ran

## Known Patterns
(Claude will add entries here as it learns from investigations)

## Resort-Specific Notes
(Claude will add entries here as it learns quirks about specific resorts)
