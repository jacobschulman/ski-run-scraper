# Terrain UTC Date Fix

## Problem

The app fetches terrain files using UTC date (`new Date().toISOString().slice(0, 10)`) but all terrain scrapers write files using the resort's local date (`getResortLocalDate(timezone)`). This creates a window — typically from ~5-7pm local time until the next morning's scrape — where the app requests a UTC-dated file that doesn't exist yet.

Example: At 6pm Mountain Time (Feb 27), UTC is already Feb 28. The app requests `2026-02-28.json` but the scraper only wrote `2026-02-27.json`.

## Fix Applied

Every terrain save location now also writes a copy under the UTC date when it differs from the local date:

```javascript
const utcDate = new Date().toISOString().slice(0, 10);
if (utcDate !== today) {
  fs.writeFileSync(path.join(terrainDir, `${utcDate}.json`), JSON.stringify(terrainData, null, 2));
}
```

This is a no-op most of the day (UTC and local match). Only fires in the window where they differ.

## Files Modified (9 save locations across 4 files)

| File | Function(s) | Lines |
|------|-------------|-------|
| `vail-scraper.js` | `saveResortData` | ~600 |
| `ikon-scraper.js` | `saveInspectorTerrainData` | ~213 |
| `ikon-scraper.js` | `saveAlternateProviderTerrainData` | ~734 |
| `canadian-scraper.js` | `saveTerrainData` | ~44 |
| `hetzner/terrain-scraper-persistent.js` | `saveIkonTerrainData` | ~161 |
| `hetzner/terrain-scraper-persistent.js` | `saveAspenTerrainData` | ~338 |
| `hetzner/terrain-scraper-persistent.js` | `saveCanadianBig3TerrainData` | ~479 |
| `hetzner/terrain-scraper-persistent.js` | `saveAlternateProviderTerrainData` | ~649 |
| `hetzner/terrain-scraper-persistent.js` | `scrapeVailTerrain` | ~944 |

## How to Revert

The change is isolated — each location is a self-contained `if` block that can be removed. To revert all changes:

```bash
# Revert the entire commit (replace COMMIT_HASH with the actual hash)
git revert COMMIT_HASH

# Or to revert individual files:
git checkout HEAD~1 -- vail-scraper.js ikon-scraper.js canadian-scraper.js hetzner/terrain-scraper-persistent.js
git commit -m "Revert terrain UTC date fix"
git push origin main
```

To revert manually, search each file for `utcDate` and remove the surrounding `if` block (3-4 lines each). The pattern in every location is:

```javascript
  // Also save under UTC date if it differs from local date
  const utcDate = new Date().toISOString().slice(0, 10);
  if (utcDate !== today) {
    fs.writeFileSync(path.join(terrainDir, `${utcDate}.json`), JSON.stringify(...));
  }
```

Remove those lines and the fix is fully reverted. No other code depends on the UTC-dated files.

## Side Effects

- Terrain indexes (`index.json`) will list both the local-date and UTC-date files. This is harmless — the index just lists available files.
- Extra disk usage is negligible (one duplicate JSON file per resort per day, only during the UTC/local mismatch window).
- The Hetzner auto-deploy (`deploy.sh`) will pick this up within 5 minutes and restart the terrain scraper.
- GH Actions scrapers (`vail-scraper.js`, `ikon-scraper.js`, `canadian-scraper.js`) will use the fix on their next scheduled run.
