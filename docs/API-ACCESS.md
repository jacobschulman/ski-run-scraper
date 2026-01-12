# Ski Run Scraper API Access Guide

> For backend engineers needing to access the ski data APIs

## TL;DR

**All APIs are completely public and require NO authentication.**

- No API keys
- No bearer tokens
- No OAuth
- No rate limiting

Just make HTTP GET requests to the endpoints below.

---

## Base URLs

| Environment | Base URL | Notes |
|-------------|----------|-------|
| **GitHub Pages** (Primary) | `https://jacobschulman.github.io/ski-run-scraper` | Recommended for production use |
| **Hetzner Server** | `http://46.62.169.104:3000` | Real-time data, internal use |

---

## Quick Start Examples

```bash
# Get latest lift data from all resorts
curl https://jacobschulman.github.io/ski-run-scraper/data/latest-lifts.json

# Get latest snow data from all resorts
curl https://jacobschulman.github.io/ski-run-scraper/data/latest-snow.json

# Get terrain data for a specific resort
curl https://jacobschulman.github.io/ski-run-scraper/data/vail/terrain/latest.json

# Check server health (Hetzner only)
curl http://46.62.169.104:3000/health
```

---

## API Endpoints

### GitHub Pages Endpoints

| Endpoint | Description |
|----------|-------------|
| `/data/latest.json` | Latest terrain data from all resorts |
| `/data/latest-snow.json` | Latest snow data from all resorts |
| `/data/latest-lifts.json` | Latest lift wait times from all resorts |
| `/data/aggregates/latest.json` | Global leaderboard and aggregates |
| `/data/index.json` | Manifest of all available data files |
| `/data/{resort}/terrain/latest.json` | Latest terrain for specific resort |
| `/data/{resort}/snow/latest.json` | Latest snow for specific resort |
| `/data/{resort}/lifts/index.json` | Lift data manifest for resort |
| `/data/{resort}/lifts/YYYY-MM-DD.ndjson` | Historical lift data (NDJSON format) |

### Hetzner Server Endpoints

| Endpoint | Description |
|----------|-------------|
| `/health` | Server and scraper health status |
| `/health/resorts` | Per-resort scrape status |
| `/api` | API documentation/info |
| `/data/latest-lifts.json` | Real-time lift data (updated every 1-2 min) |
| `/data/:resort/lifts/index.json` | Dynamic lift index for resort |
| `/data/*` | Static file serving for all data |
| `/dashboards/*` | HTML dashboards |
| `/config.json` | Resort configuration |

---

## Resort Identifiers

Use these slugs in API paths (e.g., `/data/{resort}/...`):

### Vail Resorts
```
vail, beaver-creek, breckenridge, keystone, park-city,
heavenly, northstar, kirkwood, stevens-pass, stowe,
okemo, mount-snow, hunter-mountain, attitash, wildcat,
crotched, mount-sunapee, whistler-blackcomb, perisher,
falls-creek, hotham, andermatt-sedrun, crans-montana,
wilmot, afton-alps, mt-brighton, liberty, roundtop,
whitetail, jack-frost, big-boulder, hidden-valley, snow-creek,
paoli-peaks, mad-river-mountain, boston-mills, brandywine,
alpine-valley
```

### Ikon Resorts
```
stratton, palisades-tahoe, jackson-hole, big-sky, deer-valley,
alta, aspen-highlands, aspen-mountain, buttermilk, snowmass,
copper-mountain, steamboat, winter-park, arapahoe-basin,
eldora, taos, mammoth-mountain, june-mountain, big-bear,
crystal-mountain, killington, sugarbush, sugarloaf, sunday-river,
loon, tremblant, blue-mountain, revelstoke, cypress-mountain,
banff-sunshine, lake-louise, mt-norquay, red-mountain, panorama,
big-white, silver-star, sun-peaks, kicking-horse
```

---

## Data Formats

### Lift Data (NDJSON)
Newline-delimited JSON with one record per scrape:
```json
{"timestamp":"2026-01-11T18:19:00Z","lifts":[{"name":"Chair 1","status":"open","waitMinutes":5},...]}
{"timestamp":"2026-01-11T18:21:00Z","lifts":[{"name":"Chair 1","status":"open","waitMinutes":7},...]}
```

### Snow Data (JSON)
```json
{
  "resort": "vail",
  "timestamp": "2026-01-11T12:00:00Z",
  "snowfall24h": 6,
  "snowfall48h": 12,
  "snowfall7d": 24,
  "baseDepth": 48,
  "seasonTotal": 156
}
```

### Terrain Data (JSON)
```json
{
  "resort": "vail",
  "timestamp": "2026-01-11T05:00:00Z",
  "liftsOpen": 31,
  "liftsTotal": 33,
  "trailsOpen": 195,
  "trailsTotal": 195,
  "acresOpen": 5317,
  "terrainParksOpen": 3
}
```

---

## CORS

The API allows all origins:
```javascript
{
  origin: true,  // Allow all origins
  methods: ['GET', 'HEAD'],
  maxAge: 86400
}
```

You can call these APIs from any frontend application without CORS issues.

---

## Rate Limiting

**There is currently no rate limiting.** Please be respectful:
- Avoid polling more frequently than every 30 seconds
- Cache responses when possible
- Use GitHub Pages for historical data queries

---

## Health Monitoring

Check if services are running:

```bash
# Overall health
curl http://46.62.169.104:3000/health

# Response:
{
  "status": "ok",
  "timestamp": "2026-01-11T18:30:00Z",
  "services": {
    "lifts": { "status": "ok", "lastScrape": "2026-01-11T18:29:00Z" },
    "snow": { "status": "ok", "lastScrape": "2026-01-11T18:00:00Z" },
    "terrain": { "status": "ok", "lastScrape": "2026-01-11T05:00:00Z" }
  }
}
```

---

## SSH Access (Server Administration Only)

If you need direct server access (not required for API usage):

| Setting | Value |
|---------|-------|
| Host | `46.62.169.104` |
| Port | `22` |
| User | `scraper` |
| Auth | SSH key (ask Jacob) |

```bash
ssh scraper@46.62.169.104
```

---

## Questions?

- API issues: Check `/health` endpoint first
- Data questions: See `config.json` for resort mappings
- Access issues: There shouldn't be any - APIs are public
