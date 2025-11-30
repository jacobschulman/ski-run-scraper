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
  const hasBeenScraped = hasBeenScrapedToday(resort, dataType, seasonUtils);
  const isInspector = resort.provider === 'inspector';

  const checks = {
    inSeason: seasonUtils.isResortInSeason(resort, config),
    // Inspector resorts use a single API and don’t need per-resort URLs
    hasUrl: isInspector ? true : dataType === 'terrain' ? !!resort.terrainUrl : !!resort.snowReportUrl,
    notScraped: !hasBeenScraped,
    inWindow: seasonUtils.isInScrapingWindow(resort, config)
  };

  // Scrape if: in season, has URL, not scraped today, and within the daily scraping window
  // Allow overriding with FORCE_SCRAPE for debugging/backfills
  return forceScrape || (checks.inSeason && checks.hasUrl && checks.notScraped && checks.inWindow);
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
          files: files,  // Just the date files, not index.json
          latest: files[0],  // Most recent date file
          count: files.length
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
  generateDataIndex
};
