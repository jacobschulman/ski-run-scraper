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
  const hasBeenScraped = hasBeenScrapedToday(resort, dataType, seasonUtils);

  const checks = {
    inSeason: seasonUtils.isResortInSeason(resort, config),
    hasUrl: dataType === 'terrain' ? !!resort.terrainUrl : !!resort.snowReportUrl,
    notScraped: !hasBeenScraped,
    inWindow: seasonUtils.isInScrapingWindow(resort, config)
  };

  // Scrape if: in season, has URL, not scraped today, and within the daily scraping window
  return checks.inSeason && checks.hasUrl && checks.notScraped && checks.inWindow;
}

/**
 * Get detailed status for a resort (for logging)
 */
function getResortStatus(resort, config, seasonUtils) {
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
    shouldScrapeTerrain: shouldScrapeResort(resort, 'terrain', config, seasonUtils),
    shouldScrapeSnow: shouldScrapeResort(resort, 'snow', config, seasonUtils)
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

module.exports = {
  ensureDirectoryExists,
  getTodayDate,
  hasBeenScrapedToday,
  shouldScrapeResort,
  getResortStatus,
  slugifyTrailName,
  sanitizeTrailName
};
