// terrain-scraper-persistent.js - Daily terrain/grooming scraper for Hetzner
// Runs once per day per resort in their local morning (after overnight grooming)
// Uses Inspector API for Ikon resorts, Puppeteer for Vail resorts

const puppeteer = require('puppeteer');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Load modules from parent directory
const configLoader = require('../lib/config-loader');
const seasonUtils = require('../lib/season-utils');
const fileStorage = require('../lib/file-storage');
const dataNormalization = require('../lib/data-normalization');
// Note: Database saves are skipped in persistent scraper - file storage is primary
// The import-to-database.js script handles DB imports via aggregates cron

// Configuration
const CONFIG = {
  checkIntervalMs: 15 * 60 * 1000,  // Check every 15 minutes
  targetHour: 7,                     // Target hour in resort's local time (7 AM)
  windowHours: 3,                    // Scraping window (7 AM - 10 AM)
  vail: {
    batchSize: 4,
    batchDelayMs: 5000,
  },
  dataDir: path.join(__dirname, '..', 'data'),
  configPath: path.join(__dirname, '..', 'config.json'),
};

// Load resort configuration
const config = configLoader.loadConfig(CONFIG.configPath);
const RESORTS = configLoader.getResortsMap(config);

// Inspector API configuration
const INSPECTOR_API_URL = config.inspector?.apiUrl || 'https://mtnpowder.com/feed/v3.json';
const BEARER_TOKEN = config.inspector?.bearerToken || 'hPtaTVkbuyZQnrxvru4ApfpXnS21PJO3eTKdibDoLZE';

// Track which resorts have been scraped today (keyed by YYYY-MM-DD)
const scrapedToday = new Map();

// Health tracking
const health = {
  startTime: Date.now(),
  ikon: { totalRuns: 0, resortsScraped: 0, lastRun: null, consecutiveFailures: 0 },
  vail: { totalRuns: 0, resortsScraped: 0, lastRun: null, consecutiveFailures: 0 },
};

// Shared browser for Vail scraping
let browser = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function hasScrapedToday(resortKey, timezone) {
  const today = seasonUtils.getResortLocalDate(timezone);
  const key = `${resortKey}:${today}`;
  return scrapedToday.has(key);
}

function markScrapedToday(resortKey, timezone) {
  const today = seasonUtils.getResortLocalDate(timezone);
  const key = `${resortKey}:${today}`;
  scrapedToday.set(key, Date.now());

  // Clean up old entries (keep only today's)
  for (const [k] of scrapedToday) {
    if (!k.endsWith(today)) {
      scrapedToday.delete(k);
    }
  }
}

function isInScrapingWindow(resort) {
  const currentHour = seasonUtils.getResortLocalHour(resort.timezone);
  return currentHour >= CONFIG.targetHour && currentHour < (CONFIG.targetHour + CONFIG.windowHours);
}

// ═══════════════════════════════════════════════════════════════════════════════
// IKON TERRAIN SCRAPER (HTTP API)
// ═══════════════════════════════════════════════════════════════════════════════

function fetchInspectorData() {
  return new Promise((resolve, reject) => {
    const url = `${INSPECTOR_API_URL}?bearer_token=${BEARER_TOKEN}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

function saveIkonTerrainData(resortKey, resortData) {
  const resort = RESORTS[resortKey];
  if (!resort) return null;

  const timezone = resort.timezone || 'America/Denver';
  const today = seasonUtils.getResortLocalDate(timezone);

  // Normalize the terrain data
  const normalizedData = dataNormalization.normalizeInspectorTerrain(resortData, resortKey, resort.name);

  if (!normalizedData || !normalizedData.MountainAreas) {
    console.log(`[IKON-TERRAIN] ⏭️  ${resortKey} - no terrain data`);
    return null;
  }

  // Add provider metadata
  const terrainData = {
    ...normalizedData,
    provider: 'ikon',
    apiProvider: 'inspector',
    scrapedAt: new Date().toISOString(),
    date: today,
  };

  // Ensure directory exists
  const terrainDir = path.join(CONFIG.dataDir, resortKey, 'terrain');
  fileStorage.ensureDirectoryExists(terrainDir);

  // Save timestamped file
  const timestampedFile = path.join(terrainDir, `${today}.json`);
  fs.writeFileSync(timestampedFile, JSON.stringify(terrainData, null, 2));

  // Save as latest.json
  const latestFile = path.join(terrainDir, 'latest.json');
  fs.writeFileSync(latestFile, JSON.stringify(terrainData, null, 2));

  // Update terrain index
  const terrainFiles = fs.readdirSync(terrainDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort().reverse();

  const terrainIndex = {
    resort: resortKey,
    resortName: resort.name,
    provider: 'ikon',
    files: terrainFiles,
    latest: terrainFiles[0] || null,
    count: terrainFiles.length,
    lastUpdated: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(terrainDir, 'index.json'), JSON.stringify(terrainIndex, null, 2));

  // Note: Database saves skipped in persistent scraper (file storage is primary)

  return terrainData;
}

async function runIkonTerrainScraper() {
  console.log(`\n[IKON-TERRAIN] Checking resorts...`);
  health.ikon.lastRun = new Date().toISOString();

  try {
    // Get in-season Ikon resorts
    const ikonResorts = configLoader.getResortsByProvider(config, 'ikon')
      .filter(r => seasonUtils.isResortInSeason(r, config));

    // Filter to resorts in their scraping window that haven't been scraped today
    const resortsToScrape = ikonResorts.filter(r => {
      if (hasScrapedToday(r.key, r.timezone)) return false;
      if (!isInScrapingWindow(r)) return false;
      return true;
    });

    if (resortsToScrape.length === 0) {
      console.log('[IKON-TERRAIN] No resorts need scraping right now');
      return;
    }

    console.log(`[IKON-TERRAIN] Scraping ${resortsToScrape.length} resorts`);
    health.ikon.totalRuns++;

    // Fetch all data in one call
    const allData = await fetchInspectorData();
    let scraped = 0;

    for (const resort of resortsToScrape) {
      const resortData = allData.Resorts?.find(r =>
        r.Name?.toLowerCase().includes(resort.name.toLowerCase()) ||
        resort.name.toLowerCase().includes(r.Name?.toLowerCase())
      );

      if (resortData) {
        const saved = saveIkonTerrainData(resort.key, resortData);
        if (saved) {
          scraped++;
          markScrapedToday(resort.key, resort.timezone);
          const localTime = seasonUtils.getResortLocalTimeFormatted(resort.timezone);
          console.log(`[IKON-TERRAIN] ✓ ${resort.key} (${localTime})`);
        }
      }
    }

    health.ikon.resortsScraped += scraped;
    health.ikon.consecutiveFailures = 0;
    console.log(`[IKON-TERRAIN] Completed: ${scraped} resorts`);

  } catch (error) {
    console.error(`[IKON-TERRAIN] Error: ${error.message}`);
    health.ikon.consecutiveFailures++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VAIL TERRAIN SCRAPER (Puppeteer)
// ═══════════════════════════════════════════════════════════════════════════════

async function initBrowser() {
  if (browser) {
    try { await browser.close(); } catch (e) {}
  }

  console.log('[VAIL-TERRAIN] Launching browser...');
  browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--single-process',
    ]
  });
}

async function scrapeVailTerrain(resortKey, url) {
  const resort = RESORTS[resortKey];
  const timezone = resort.timezone || 'America/Denver';
  const today = seasonUtils.getResortLocalDate(timezone);

  if (!browser) await initBrowser();
  const page = await browser.newPage();

  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (e) {
      console.log(`[VAIL-TERRAIN] ${resortKey} load issue:`, e.message);
    }

    await sleep(3000);

    // Wait for FR object
    await page.waitForFunction(
      () => typeof FR !== 'undefined' && FR.TerrainStatusFeed,
      { timeout: 45000 }
    ).catch(() => {});

    // Extract terrain data
    const rawData = await page.evaluate(() => {
      if (typeof FR !== 'undefined' && FR.TerrainStatusFeed) {
        return FR.TerrainStatusFeed;
      }
      return null;
    });

    if (!rawData) return null;

    // Normalize the data
    const normalizedData = dataNormalization.normalizeVailTerrain(rawData, resortKey, resort.name);

    const terrainData = {
      ...normalizedData,
      provider: 'vail',
      scrapedAt: new Date().toISOString(),
      date: today,
    };

    // Save to files
    const terrainDir = path.join(CONFIG.dataDir, resortKey, 'terrain');
    fileStorage.ensureDirectoryExists(terrainDir);

    fs.writeFileSync(path.join(terrainDir, `${today}.json`), JSON.stringify(terrainData, null, 2));
    fs.writeFileSync(path.join(terrainDir, 'latest.json'), JSON.stringify(terrainData, null, 2));

    // Update terrain index
    const terrainFiles = fs.readdirSync(terrainDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort().reverse();

    const terrainIndex = {
      resort: resortKey,
      resortName: resort.name,
      provider: 'vail',
      files: terrainFiles,
      latest: terrainFiles[0] || null,
      count: terrainFiles.length,
      lastUpdated: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(terrainDir, 'index.json'), JSON.stringify(terrainIndex, null, 2));

    // Note: Database saves skipped in persistent scraper (file storage is primary)

    return terrainData;

  } finally {
    await page.close();
  }
}

async function runVailTerrainScraper() {
  console.log(`\n[VAIL-TERRAIN] Checking resorts...`);
  health.vail.lastRun = new Date().toISOString();

  try {
    // Get in-season Vail resorts
    const vailResorts = configLoader.getResortsByProvider(config, 'vail')
      .filter(r => seasonUtils.isResortInSeason(r, config) && r.terrainUrl);

    // Filter to resorts in their scraping window that haven't been scraped today
    const resortsToScrape = vailResorts.filter(r => {
      if (hasScrapedToday(r.key, r.timezone)) return false;
      if (!isInScrapingWindow(r)) return false;
      return true;
    });

    if (resortsToScrape.length === 0) {
      console.log('[VAIL-TERRAIN] No resorts need scraping right now');
      return;
    }

    console.log(`[VAIL-TERRAIN] Scraping ${resortsToScrape.length} resorts`);
    health.vail.totalRuns++;

    if (!browser) await initBrowser();

    let scraped = 0;

    // Process in batches
    for (let i = 0; i < resortsToScrape.length; i += CONFIG.vail.batchSize) {
      const batch = resortsToScrape.slice(i, i + CONFIG.vail.batchSize);

      for (const resort of batch) {
        try {
          const data = await scrapeVailTerrain(resort.key, resort.terrainUrl);
          if (data) {
            scraped++;
            markScrapedToday(resort.key, resort.timezone);
            const localTime = seasonUtils.getResortLocalTimeFormatted(resort.timezone);
            console.log(`[VAIL-TERRAIN] ✓ ${resort.key} (${localTime})`);
          }
        } catch (e) {
          console.error(`[VAIL-TERRAIN] ✗ ${resort.key}: ${e.message}`);
        }
      }

      if (i + CONFIG.vail.batchSize < resortsToScrape.length) {
        await sleep(CONFIG.vail.batchDelayMs);
      }
    }

    health.vail.resortsScraped += scraped;
    health.vail.consecutiveFailures = 0;
    console.log(`[VAIL-TERRAIN] Completed: ${scraped} resorts`);

  } catch (error) {
    console.error(`[VAIL-TERRAIN] Error: ${error.message}`);
    health.vail.consecutiveFailures++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH FILE
// ═══════════════════════════════════════════════════════════════════════════════

const HEALTH_FILE = path.join(__dirname, 'terrain-health.json');

function writeHealthFile() {
  const healthData = {
    scraper: 'terrain',
    status: health.ikon.consecutiveFailures < 3 && health.vail.consecutiveFailures < 3 ? 'ok' : 'degraded',
    uptime: Math.round((Date.now() - health.startTime) / 1000),
    ikon: health.ikon,
    vail: health.vail,
    scrapedToday: Object.fromEntries(scrapedToday),
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(HEALTH_FILE, JSON.stringify(healthData, null, 2));
  } catch (e) {
    console.error('Failed to write health file:', e.message);
  }
}

setInterval(writeHealthFile, 30000);

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════════

let isShuttingDown = false;

process.on('SIGINT', async () => {
  console.log('\n[TERRAIN] Shutting down...');
  isShuttingDown = true;
  if (browser) await browser.close();
  process.exit(0);
});

async function main() {
  console.log('[TERRAIN] Terrain Scraper Persistent Process');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Check interval: ${CONFIG.checkIntervalMs / 1000 / 60} min`);
  console.log(`Target hour: ${CONFIG.targetHour}:00 local time`);
  console.log(`Window: ${CONFIG.windowHours} hours`);
  console.log(`Data directory: ${CONFIG.dataDir}`);

  // Main loop - check periodically for resorts in their scraping window
  while (!isShuttingDown) {
    // Run both scrapers (they filter internally based on timing)
    await runIkonTerrainScraper();
    await runVailTerrainScraper();

    // Wait before next check
    await sleep(CONFIG.checkIntervalMs);
  }
}

main();
