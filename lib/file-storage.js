// lib/file-storage.js - Shared file storage utilities
// Used by both Vail (Puppeteer) and Inspector (HTTP API) scrapers

const fs = require('fs');
const path = require('path');

/**
 * Ensure directory exists, create if not
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Get today's date in YYYY-MM-DD format (UTC-based)
 */
function getTodayDate() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * Check if a resort has already been scraped today
 * Checks in the resort's local timezone
 */
function hasBeenScrapedToday(resort, dataType, seasonUtils) {
  const localDate = seasonUtils.getResortLocalDate(resort.timezone);
  const dataDir = path.join('data', resort.key, dataType);
  const todayFile = path.join(dataDir, `${localDate}.json`);

  return fs.existsSync(todayFile);
}

/**
 * Determine if a resort should be scraped for a specific data type
 * Logic: Scrape if in season, has URL, not scraped yet, and we're in the scraping window
 */
function shouldScrapeResort(resort, dataType, config, seasonUtils) {
  const forceScrape = process.env.FORCE_SCRAPE === '1' || process.env.FORCE_SCRAPE === 'true';
  const isInspector = resort.provider === 'inspector' || resort.provider === 'ikon';

  const checks = {
    inSeason: seasonUtils.isResortInSeason(resort, config),
    // Inspector resorts use a single API and don’t need per-resort URLs
    hasUrl: isInspector ? true : dataType === 'terrain' ? !!resort.terrainUrl : !!resort.snowReportUrl,
    inWindow: seasonUtils.isInScrapingWindow(resort, config)
  };

  // Always allow snow to refresh each run (hourly workflow) when in season and configured.
  if (forceScrape || (dataType === 'snow' && checks.inSeason && checks.hasUrl)) {
    return true;
  }

  // Grooming/terrain: once per day, only in the morning window, and skip if already captured.
  const hasBeenScraped = hasBeenScrapedToday(resort, dataType, seasonUtils);

  // Scrape if: in season, has URL, not scraped today, and within the daily scraping window
  // Allow overriding with FORCE_SCRAPE for debugging/backfills
  return forceScrape || (checks.inSeason && checks.hasUrl && !hasBeenScraped && checks.inWindow);
}

/**
 * Get detailed status for a resort (for logging)
 */
function getResortStatus(resort, config, seasonUtils) {
  const forceScrape = process.env.FORCE_SCRAPE === '1' || process.env.FORCE_SCRAPE === 'true';
  const localTime = seasonUtils.getResortLocalTimeFormatted(resort.timezone);
  const inSeason = seasonUtils.isResortInSeason(resort, config);
  const inWindow = seasonUtils.isInScrapingWindow(resort, config);
  const terrainScraped = hasBeenScrapedToday(resort, 'terrain', seasonUtils);
  const snowScraped = hasBeenScrapedToday(resort, 'snow', seasonUtils);
  const currentHour = seasonUtils.getResortLocalHour(resort.timezone);
  const targetHour = resort.targetHour !== undefined ? resort.targetHour : config.schedule.targetHour;
  const windowHours = config.schedule.scrapingWindowHours;

  return {
    localTime,
    inSeason,
    inWindow,
    terrainScraped,
    snowScraped,
    currentHour,
    targetHour,
    windowHours,
    forceScrape,
    shouldScrapeTerrain: forceScrape || shouldScrapeResort(resort, 'terrain', config, seasonUtils),
    shouldScrapeSnow: forceScrape || shouldScrapeResort(resort, 'snow', config, seasonUtils)
  };
}

/**
 * Convert trail name to URL-safe slug
 */
function slugifyTrailName(name) {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-')      // Replace spaces with hyphens
    .replace(/--+/g, '-')      // Replace multiple hyphens with single
    .trim();
}

/**
 * Sanitize trail name by removing pagination text and other artifacts
 * Fixes issues like "Black Forest 0   5073\t Items per page : 20 1 - 20 of 54"
 */
function sanitizeTrailName(name) {
  return name
    // Remove pagination text pattern: "0   5073\t Items per page : 20 1 - 20 of 54"
    .replace(/\s*\d+\s+\d+\s*\t\s*Items per page\s*:\s*\d+\s+\d+\s*-\s*\d+\s+of\s+\d+.*$/i, '')
    .trim();
}

/**
 * Compute data availability capabilities for a resort
 * Returns flags indicating which data types are available
 */
function computeDataCapabilities(resortKey) {
  const capabilities = {
    terrainAvailable: false,
    snowReportAvailable: false,
    liftStatusAvailable: false,
    dailyBriefAvailable: false,
    liftWaitTimesAvailable: false,
    lastTerrainUpdate: null,
    lastSnowUpdate: null,
    lastBriefUpdate: null
  };

  // Check terrain/ directory
  const terrainDir = path.join('data', resortKey, 'terrain');
  if (fs.existsSync(terrainDir)) {
    const files = fs.readdirSync(terrainDir)
      .filter(f => f.endsWith('.json') && f !== 'index.json' && f !== 'latest.json');

    if (files.length > 0) {
      capabilities.terrainAvailable = true;

      // Check latest file for lift data
      try {
        const latestFile = path.join(terrainDir, files.sort().reverse()[0]);
        const data = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
        capabilities.liftStatusAvailable = !!(data.Lifts && data.Lifts.length > 0);
        capabilities.lastTerrainUpdate = data.Date || null;
      } catch (err) {
        // Ignore parsing errors
      }
    }
  }

  // Check snow/ directory
  const snowDir = path.join('data', resortKey, 'snow');
  if (fs.existsSync(snowDir)) {
    const files = fs.readdirSync(snowDir)
      .filter(f => f.endsWith('.json') && f !== 'index.json' && f !== 'latest.json');

    if (files.length > 0) {
      capabilities.snowReportAvailable = true;

      // Get timestamp from latest file
      try {
        const latestFile = path.join(snowDir, files.sort().reverse()[0]);
        const data = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
        capabilities.lastSnowUpdate = data.timestamp || null;
      } catch (err) {
        // Ignore parsing errors
      }
    }
  }

  // Check brief/ directory
  const briefDir = path.join('data', resortKey, 'brief');
  if (fs.existsSync(briefDir)) {
    const files = fs.readdirSync(briefDir)
      .filter(f => f.endsWith('.json') && f !== 'index.json' && f !== 'latest.json');

    if (files.length > 0) {
      capabilities.dailyBriefAvailable = true;

      // Get timestamp from latest file
      try {
        const latestFile = path.join(briefDir, files.sort().reverse()[0]);
        const data = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
        capabilities.lastBriefUpdate = data.generated || null;
      } catch (err) {
        // Ignore parsing errors
      }
    }
  }

  // Check lifts/ directory for wait time data (NDJSON files)
  const liftsDir = path.join('data', resortKey, 'lifts');
  if (fs.existsSync(liftsDir)) {
    const files = fs.readdirSync(liftsDir).filter(f => f.endsWith('.ndjson'));
    capabilities.liftWaitTimesAvailable = files.length > 0;
  }

  return capabilities;
}

/**
 * Generate data/index.json manifest of all available terrain data files
 * This index is used by native apps and other consumers to discover available data
 */
function generateDataIndex(config) {
  const index = {
    resorts: {},
    lastUpdated: new Date().toISOString()
  };

  const dataDir = 'data';
  if (!fs.existsSync(dataDir)) {
    console.log('⚠️  data/ directory does not exist, skipping index generation');
    return;
  }

  // Build resort map from config
  const RESORTS = config.resorts.reduce((acc, resort) => {
    acc[resort.key] = resort;
    return acc;
  }, {});

  // Scan each resort directory (both Vail and Inspector resorts)
  Object.keys(RESORTS).forEach(resortKey => {
    const terrainDir = path.join(dataDir, resortKey, 'terrain');
    if (fs.existsSync(terrainDir)) {
      const files = fs.readdirSync(terrainDir)
        .filter(f => f.endsWith('.json') && f !== 'index.json')
        .sort()
        .reverse(); // Most recent first

      if (files.length > 0) {
        index.resorts[resortKey] = {
          name: RESORTS[resortKey].name,
          provider: RESORTS[resortKey].provider || 'vail',
          files: files,  // Just the date files, not index.json
          latest: files[0],  // Most recent date file
          count: files.length,
          dataCapabilities: computeDataCapabilities(resortKey)
        };
      }
    }
  });

  fs.writeFileSync(path.join(dataDir, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`✓ Generated data/index.json (${Object.keys(index.resorts).length} resorts)`);
}

module.exports = {
  ensureDirectoryExists,
  getTodayDate,
  hasBeenScrapedToday,
  shouldScrapeResort,
  getResortStatus,
  slugifyTrailName,
  sanitizeTrailName,
  computeDataCapabilities,
  generateDataIndex
};
