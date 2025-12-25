// snow-scraper-persistent.js - Continuous snow report scraper for Hetzner
// Runs both Ikon (HTTP API) and Vail (Puppeteer) snow scrapers with separate timing
// Keeps browser warm between runs for better performance

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
// The aggregates generator will import data to database hourly

// Configuration
const CONFIG = {
  ikon: {
    intervalMs: 30 * 60 * 1000,    // 30 minutes
    jitterMs: 30000,               // 0-30 seconds random jitter
  },
  vail: {
    intervalMs: 30 * 60 * 1000,    // 30 minutes
    jitterMs: 60000,               // 0-60 seconds random jitter
    batchSize: 5,                  // Resorts per batch
    batchDelayMs: 3000,            // Delay between batches
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

// Health tracking
const health = {
  startTime: Date.now(),
  ikon: { totalRuns: 0, successfulRuns: 0, consecutiveFailures: 0, lastRun: null, lastSuccess: null, resortsScraped: 0 },
  vail: { totalRuns: 0, successfulRuns: 0, consecutiveFailures: 0, lastRun: null, lastSuccess: null, resortsScraped: 0 },
};

// Shared browser for Vail scraping
let browser = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ═══════════════════════════════════════════════════════════════════════════════
// IKON SNOW SCRAPER (HTTP API)
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
            reject(new Error(`Failed to parse JSON: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

function saveIkonSnowData(resortKey, resortData) {
  const resort = RESORTS[resortKey];
  if (!resort) return null;

  const timezone = resort.timezone || 'America/Denver';
  const today = seasonUtils.getResortLocalDate(timezone);
  const now = new Date();

  // Normalize the data
  const cleanData = dataNormalization.normalizeInspectorSnowReport(
    resortData,
    resortKey,
    resort.name,
    today
  );

  if (!cleanData) return null;

  // Add provider metadata
  const snowData = {
    ...cleanData,
    provider: 'ikon',
    apiProvider: 'inspector',
    timestamp: now.toISOString(),
  };

  // Ensure directory exists
  const snowDir = path.join(CONFIG.dataDir, resortKey, 'snow');
  fileStorage.ensureDirectoryExists(snowDir);

  // Save timestamped file
  const timestampedFile = path.join(snowDir, `${today}.json`);
  fs.writeFileSync(timestampedFile, JSON.stringify(snowData, null, 2));

  // Save as latest.json
  const latestFile = path.join(snowDir, 'latest.json');
  fs.writeFileSync(latestFile, JSON.stringify(snowData, null, 2));

  // Append to NDJSON
  const ndjsonFile = path.join(snowDir, `${today}.ndjson`);
  fs.appendFileSync(ndjsonFile, JSON.stringify(snowData) + '\n');

  // Note: Database saves skipped in persistent scraper (file storage is primary)

  return snowData;
}

async function runIkonSnowScraper() {
  const runId = Date.now();
  console.log(`\n[IKON-SNOW] Starting run ${runId}`);
  health.ikon.totalRuns++;
  health.ikon.lastRun = new Date().toISOString();

  try {
    // Get in-season Ikon resorts
    const ikonResorts = configLoader.getResortsByProvider(config, 'ikon')
      .filter(r => seasonUtils.isResortInSeason(r, config));

    if (ikonResorts.length === 0) {
      console.log('[IKON-SNOW] No resorts in season');
      return;
    }

    console.log(`[IKON-SNOW] Found ${ikonResorts.length} in-season resorts`);

    // Fetch all data in one call
    const allData = await fetchInspectorData();
    let scraped = 0;

    for (const resort of ikonResorts) {
      // Find matching resort in API response
      const resortData = allData.Resorts?.find(r =>
        r.Name?.toLowerCase().includes(resort.name.toLowerCase()) ||
        resort.name.toLowerCase().includes(r.Name?.toLowerCase())
      );

      if (resortData) {
        const saved = saveIkonSnowData(resort.key, resortData);
        if (saved) {
          scraped++;
          console.log(`[IKON-SNOW] ✓ ${resort.key}`);
        }
      }
    }

    health.ikon.resortsScraped = scraped;
    health.ikon.successfulRuns++;
    health.ikon.consecutiveFailures = 0;
    health.ikon.lastSuccess = new Date().toISOString();
    console.log(`[IKON-SNOW] Completed: ${scraped}/${ikonResorts.length} resorts`);

  } catch (error) {
    console.error(`[IKON-SNOW] Error: ${error.message}`);
    health.ikon.consecutiveFailures++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VAIL SNOW SCRAPER (Puppeteer)
// ═══════════════════════════════════════════════════════════════════════════════

async function initBrowser() {
  if (browser) {
    try { await browser.close(); } catch (e) {}
    browser = null;
  }

  console.log('[VAIL-SNOW] Launching browser...');
  try {
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
    console.log('[VAIL-SNOW] Browser launched successfully');
  } catch (error) {
    console.error('[VAIL-SNOW] Failed to launch browser:', error.message);
    browser = null;
  }
}

async function scrapeVailSnowReport(resortKey, url) {
  const resort = RESORTS[resortKey];
  const page = await browser.newPage();

  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (e) {
      console.log(`[VAIL-SNOW] ${resortKey} load issue:`, e.message);
    }

    await sleep(3000);

    // Wait for FR object
    await page.waitForFunction(
      () => typeof FR !== 'undefined' && FR.snowReportData,
      { timeout: 45000 }
    ).catch(() => {});

    // Extract data
    const data = await page.evaluate(() => {
      if (typeof FR !== 'undefined' && FR.snowReportData) {
        return {
          snowReport: FR.snowReportData,
          forecasts: FR.forecasts || null
        };
      }
      return null;
    });

    if (!data || !data.snowReport) return null;

    const timezone = resort.timezone || 'America/Denver';
    const today = seasonUtils.getResortLocalDate(timezone);
    const snow = data.snowReport;

    // Build clean data
    const cleanData = {
      resort: resortKey,
      resortName: resort.name,
      provider: 'vail',
      date: today,
      timestamp: new Date().toISOString(),
      lastUpdated: snow.LastUpdatedText || null,
      conditions: snow.OverallSnowConditions || null,
      snowfall: {
        overnight_inches: parseFloat(snow.OvernightSnowfall?.Inches) || 0,
        overnight_cm: parseFloat(snow.OvernightSnowfall?.Centimeters) || 0,
        "24hour_inches": parseFloat(snow.TwentyFourHourSnowfall?.Inches) || 0,
        "24hour_cm": parseFloat(snow.TwentyFourHourSnowfall?.Centimeters) || 0,
        "48hour_inches": parseFloat(snow.FortyEightHourSnowfall?.Inches) || 0,
        "48hour_cm": parseFloat(snow.FortyEightHourSnowfall?.Centimeters) || 0,
        "7day_inches": parseFloat(snow.SevenDaySnowfall?.Inches) || 0,
        "7day_cm": parseFloat(snow.SevenDaySnowfall?.Centimeters) || 0,
        season_total_inches: parseFloat(snow.CurrentSeason?.Inches) || 0,
        season_total_cm: parseFloat(snow.CurrentSeason?.Centimeters) || 0
      },
      baseDepth: {
        inches: parseFloat(snow.BaseDepth?.Inches) || 0,
        cm: parseFloat(snow.BaseDepth?.Centimeters) || 0
      }
    };

    // Save to files
    const snowDir = path.join(CONFIG.dataDir, resortKey, 'snow');
    fileStorage.ensureDirectoryExists(snowDir);

    fs.writeFileSync(path.join(snowDir, `${today}.json`), JSON.stringify(cleanData, null, 2));
    fs.writeFileSync(path.join(snowDir, 'latest.json'), JSON.stringify(cleanData, null, 2));
    fs.appendFileSync(path.join(snowDir, `${today}.ndjson`), JSON.stringify(cleanData) + '\n');

    // Note: Database saves skipped in persistent scraper (file storage is primary)

    return cleanData;

  } finally {
    await page.close();
  }
}

async function runVailSnowScraper() {
  const runId = Date.now();
  console.log(`\n[VAIL-SNOW] Starting run ${runId}`);
  health.vail.totalRuns++;
  health.vail.lastRun = new Date().toISOString();

  try {
    if (!browser) {
      await initBrowser();
      if (!browser) {
        console.log('[VAIL-SNOW] Browser not available, skipping Vail scrape');
        return;
      }
    }

    // Get in-season Vail resorts with snow report URLs
    const vailResorts = configLoader.getResortsByProvider(config, 'vail')
      .filter(r => seasonUtils.isResortInSeason(r, config) && r.snowReportUrl);

    if (vailResorts.length === 0) {
      console.log('[VAIL-SNOW] No resorts in season');
      return;
    }

    console.log(`[VAIL-SNOW] Found ${vailResorts.length} in-season resorts`);

    let scraped = 0;

    // Process in batches
    for (let i = 0; i < vailResorts.length; i += CONFIG.vail.batchSize) {
      const batch = vailResorts.slice(i, i + CONFIG.vail.batchSize);

      for (const resort of batch) {
        try {
          const data = await scrapeVailSnowReport(resort.key, resort.snowReportUrl);
          if (data) {
            scraped++;
            console.log(`[VAIL-SNOW] ✓ ${resort.key}: ${data.snowfall['24hour_inches']}" 24hr`);
          }
        } catch (e) {
          console.error(`[VAIL-SNOW] ✗ ${resort.key}: ${e.message}`);
        }
      }

      if (i + CONFIG.vail.batchSize < vailResorts.length) {
        await sleep(CONFIG.vail.batchDelayMs);
      }
    }

    health.vail.resortsScraped = scraped;
    health.vail.successfulRuns++;
    health.vail.consecutiveFailures = 0;
    health.vail.lastSuccess = new Date().toISOString();
    console.log(`[VAIL-SNOW] Completed: ${scraped}/${vailResorts.length} resorts`);

  } catch (error) {
    console.error(`[VAIL-SNOW] Error: ${error.message}`);
    health.vail.consecutiveFailures++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH FILE
// ═══════════════════════════════════════════════════════════════════════════════

const HEALTH_FILE = path.join(__dirname, 'snow-health.json');

function writeHealthFile() {
  const healthData = {
    scraper: 'snow',
    status: health.ikon.consecutiveFailures < 3 && health.vail.consecutiveFailures < 3 ? 'ok' : 'degraded',
    uptime: Math.round((Date.now() - health.startTime) / 1000),
    ikon: health.ikon,
    vail: health.vail,
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(HEALTH_FILE, JSON.stringify(healthData, null, 2));
  } catch (e) {
    console.error('Failed to write health file:', e.message);
  }
}

setInterval(writeHealthFile, 10000);

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════════

let isShuttingDown = false;

process.on('SIGINT', async () => {
  console.log('\n[SNOW] Shutting down...');
  isShuttingDown = true;
  if (browser) await browser.close();
  process.exit(0);
});

async function main() {
  console.log('[SNOW] Snow Scraper Persistent Process');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Ikon interval: ${CONFIG.ikon.intervalMs / 1000 / 60} min`);
  console.log(`Vail interval: ${CONFIG.vail.intervalMs / 1000 / 60} min`);
  console.log(`Data directory: ${CONFIG.dataDir}`);

  // Initialize browser (don't fail if it doesn't work)
  try {
    await initBrowser();
  } catch (e) {
    console.error('[SNOW] Browser init failed:', e.message);
  }

  // Track last run times - set to 0 to trigger immediate first runs
  let lastIkonRun = 0;
  let lastVailRun = 0;

  // Main loop
  while (!isShuttingDown) {
    const now = Date.now();

    // Check if it's time for Ikon
    if (now - lastIkonRun >= CONFIG.ikon.intervalMs) {
      lastIkonRun = now;
      runIkonSnowScraper().catch(console.error);
    }

    // Check if it's time for Vail (offset by 15 min to stagger)
    if (now - lastVailRun >= CONFIG.vail.intervalMs) {
      lastVailRun = now;
      // Add slight delay so they don't run simultaneously
      setTimeout(() => runVailSnowScraper().catch(console.error), 60000);
    }

    await sleep(10000);
  }
}

main();
