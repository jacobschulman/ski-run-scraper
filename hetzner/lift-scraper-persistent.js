// lift-scraper-persistent.js - Continuous lift wait-time tracker for Hetzner
// Runs both Ikon (HTTP API) and Vail (Puppeteer) scrapers with separate timing
// Keeps browser warm between runs for better performance

const puppeteer = require('puppeteer');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { formatInTimeZone } = require('date-fns-tz');

// Configuration
const CONFIG = {
  ikon: {
    intervalMs: 150 * 1000,     // 2.5 minutes
    jitterMs: 15000,            // 0-15 seconds random jitter
  },
  vail: {
    intervalMs: 180 * 1000,     // 3 minutes
    jitterMs: 20000,            // 0-20 seconds random jitter
    concurrency: 2,             // Max concurrent page reloads (conservative to avoid Chrome crashes)
    // Priority resorts - only scrape these to keep memory stable
    priorityResorts: [
      'vail',
      'beavercreek',
      'parkcity',
      'breckenridge',
      'keystone',
      'whistlerblackcomb',
      'stowe',
      'heavenly',
      'northstar',
      'mountsnow',
      'okemo',
      'crestedbutte',
    ],
  },
  dataDir: path.join(__dirname, '..', 'data'),
  configPath: path.join(__dirname, '..', 'config.json'),
};

// User agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
];

// Health tracking for monitoring
const health = {
  ikon: { lastRun: null, lastSuccess: null, consecutiveFailures: 0, totalRuns: 0 },
  vail: { lastRun: null, lastSuccess: null, consecutiveFailures: 0, totalRuns: 0 },
  startTime: Date.now(),
};

// Load main config
let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG.configPath, 'utf8'));
} catch (error) {
  console.error('Failed to load config.json:', error.message);
  process.exit(1);
}

const RESORTS = config.resorts.reduce((acc, resort) => {
  acc[resort.key] = resort;
  return acc;
}, {});

// Inspector API configuration
const INSPECTOR_API_URL = config.inspector?.apiUrl || 'https://mtnpowder.com/feed/v3.json';
const BEARER_TOKEN = config.inspector?.bearerToken;

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getResortLocalDate(timezone) {
  return formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
}

function getResortLocalTime(timezone) {
  return formatInTimeZone(new Date(), timezone, 'HH:mm:ss');
}

function getResortLocalHour(timezone) {
  return parseInt(formatInTimeZone(new Date(), timezone, 'H'));
}

function isInDeadHours(timezone) {
  const hour = getResortLocalHour(timezone);
  return hour >= 22 || hour < 7;
}

function isResortInSeason(resort) {
  const timezone = resort.timezone;
  const localDate = getResortLocalDate(timezone);
  const [currentYear, currentMonth, currentDay] = localDate.split('-').map(Number);

  const seasonStart = resort.seasonStart || config.schedule?.defaultSeasonStart || '11-01';
  const seasonEnd = resort.seasonEnd || config.schedule?.defaultSeasonEnd || '05-01';

  const [startMonth, startDay] = seasonStart.split('-').map(Number);
  const [endMonth, endDay] = seasonEnd.split('-').map(Number);

  const seasonCrossesYear = startMonth > endMonth;

  let inSeason;
  if (seasonCrossesYear) {
    inSeason = (currentMonth > startMonth || (currentMonth === startMonth && currentDay >= startDay)) ||
               (currentMonth < endMonth || (currentMonth === endMonth && currentDay < endDay));
  } else {
    inSeason = (currentMonth > startMonth || (currentMonth === startMonth && currentDay >= startDay)) &&
               (currentMonth < endMonth || (currentMonth === endMonth && currentDay < endDay));
  }

  return inSeason;
}

function formatLiftType(type) {
  if (!type) return null;
  const typeMap = {
    'Gondola': 'Gondola',
    'Chairlift': 'Chair',
    'Express': 'Chair',
    'Detachable': 'Chair',
    'Fixed Grip': 'Chair',
    'Surface': 'Surface',
    'T-Bar': 'Surface',
    'Magic Carpet': 'Carpet',
    'Conveyor': 'Carpet',
  };
  for (const [key, value] of Object.entries(typeMap)) {
    if (type.includes(key)) return value;
  }
  return type;
}

// ═══════════════════════════════════════════════════════════════════════════════
// IKON SCRAPER (HTTP API)
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
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

function getTodayLiftHours(hoursObj, timezone) {
  if (!hoursObj) return { openTime: null, closeTime: null };
  const dayName = formatInTimeZone(new Date(), timezone, 'EEEE');
  if (hoursObj[dayName]) {
    return { openTime: hoursObj[dayName].Open, closeTime: hoursObj[dayName].Close };
  }
  return { openTime: null, closeTime: null };
}

async function runIkonScraper() {
  const startTime = Date.now();
  health.ikon.lastRun = new Date().toISOString();
  health.ikon.totalRuns++;

  // Apply jitter
  const jitter = Math.random() * CONFIG.ikon.jitterMs;
  await sleep(jitter);

  console.log(`\n[IKON] Starting scrape (run #${health.ikon.totalRuns})`);

  try {
    const apiResponse = await fetchInspectorData();

    if (!apiResponse?.Resorts?.length) {
      throw new Error('No resort data in API response');
    }

    const timestamp = new Date().toISOString();
    const ikonResorts = config.resorts.filter(r => r.provider === 'ikon' && isResortInSeason(r));

    let totalLifts = 0;
    let resortsProcessed = 0;

    for (const resort of ikonResorts) {
      if (isInDeadHours(resort.timezone)) continue;

      const inspectorName = resort.inspectorName || resort.name;
      const ikonData = apiResponse.Resorts.find(r => r.Name === inspectorName);

      if (!ikonData) continue;

      const localDate = getResortLocalDate(resort.timezone);
      const localTime = getResortLocalTime(resort.timezone);
      const liftsDir = path.join(CONFIG.dataDir, resort.key, 'lifts');
      ensureDirectoryExists(liftsDir);

      const outputFile = path.join(liftsDir, `${localDate}.ndjson`);
      const records = [];

      if (ikonData.MountainAreas) {
        for (const area of ikonData.MountainAreas) {
          if (!area.Lifts) continue;
          for (const lift of area.Lifts) {
            const hours = getTodayLiftHours(lift.Hours, resort.timezone);
            records.push({
              timestamp,
              localTime,
              resort: resort.key,
              liftId: lift.LiftId || lift.Id || `${area.Name}:${lift.Name}`.toLowerCase(),
              name: lift.Name,
              status: lift.Status,
              type: formatLiftType(lift.LiftType),
              waitMinutes: lift.WaitTime && lift.WaitTime !== '--' ? parseInt(lift.WaitTime) || null : null,
              openTime: hours.openTime,
              closeTime: hours.closeTime,
              mountain: area.Name,
            });
          }
        }
      }

      if (records.length > 0) {
        fs.appendFileSync(outputFile, records.map(r => JSON.stringify(r)).join('\n') + '\n');
        totalLifts += records.length;
        resortsProcessed++;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[IKON] Completed in ${elapsed}ms - ${resortsProcessed} resorts, ${totalLifts} lift records`);

    health.ikon.lastSuccess = new Date().toISOString();
    health.ikon.consecutiveFailures = 0;

  } catch (error) {
    console.error(`[IKON] Error: ${error.message}`);
    health.ikon.consecutiveFailures++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VAIL SCRAPER (Puppeteer) - Truly Persistent Pages
// ═══════════════════════════════════════════════════════════════════════════════

let browser = null;
const persistentPages = new Map(); // resortKey -> { page, url, lastSuccess }

async function initBrowser() {
  if (browser) {
    try {
      await browser.close();
    } catch (e) {}
  }

  console.log('[VAIL] Launching browser...');
  browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--single-process',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  persistentPages.clear();
  console.log('[VAIL] Browser ready');
}

// Track page creation to avoid overwhelming Chrome
let pageCreationInProgress = false;
const pageCreationQueue = [];

async function getOrCreatePage(resortKey, url) {
  const existing = persistentPages.get(resortKey);

  // Check if we have a valid page
  if (existing?.page) {
    try {
      // Quick check if page is still alive
      await existing.page.evaluate(() => true);
      return existing.page;
    } catch (e) {
      // Page is dead, remove it
      console.log(`[VAIL] Page for ${resortKey} died, will recreate`);
      persistentPages.delete(resortKey);
    }
  }

  // Create new page (serialized to avoid overwhelming Chrome)
  return new Promise((resolve, reject) => {
    const createPage = async () => {
      try {
        console.log(`[VAIL] Creating persistent page for ${resortKey}`);
        const page = await browser.newPage();
        await page.setUserAgent(getRandomUserAgent());

        // Navigate to the URL initially
        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        } catch (e) {
          // Continue even if timeout
        }

        persistentPages.set(resortKey, { page, url, lastSuccess: null });
        resolve(page);
      } catch (e) {
        reject(e);
      } finally {
        // Process next in queue
        pageCreationInProgress = false;
        if (pageCreationQueue.length > 0) {
          const next = pageCreationQueue.shift();
          pageCreationInProgress = true;
          next();
        }
      }
    };

    if (pageCreationInProgress) {
      // Queue the creation
      pageCreationQueue.push(createPage);
    } else {
      pageCreationInProgress = true;
      createPage();
    }
  });
}

async function scrapeVailResort(resortKey, url) {
  const page = await getOrCreatePage(resortKey, url);

  try {
    // Just reload the page to get fresh data (much faster than full navigation)
    try {
      await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    } catch (e) {
      // If reload fails, try full navigation
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    }

    // Short settle time (page is already warmed up)
    await sleep(500 + Math.random() * 1000);

    await page.waitForFunction(
      () => typeof FR !== 'undefined' && FR.TerrainStatusFeed,
      { timeout: 30000 }
    );

    const data = await page.evaluate(() => {
      if (typeof FR !== 'undefined' && FR.TerrainStatusFeed) {
        return { Lifts: FR.TerrainStatusFeed.Lifts || [] };
      }
      return null;
    });

    // Update last success
    const pageInfo = persistentPages.get(resortKey);
    if (pageInfo) pageInfo.lastSuccess = Date.now();

    return data;
  } catch (e) {
    // If scrape fails, mark page as potentially bad for next run
    const pageInfo = persistentPages.get(resortKey);
    if (pageInfo && pageInfo.lastSuccess && Date.now() - pageInfo.lastSuccess > 600000) {
      // Page hasn't succeeded in 10 minutes, recreate it next time
      console.log(`[VAIL] ${resortKey} failing repeatedly, will recreate page`);
      try { await pageInfo.page.close(); } catch (e) {}
      persistentPages.delete(resortKey);
    }
    throw e;
  }
  // NOTE: We do NOT close the page - it stays open for reuse
}

async function runVailScraper() {
  const startTime = Date.now();
  health.vail.lastRun = new Date().toISOString();
  health.vail.totalRuns++;

  // Only restart browser if it's dead
  if (!browser) {
    await initBrowser();
  } else {
    try {
      // Check if browser is still alive
      await browser.version();
    } catch (e) {
      console.log('[VAIL] Browser died, restarting...');
      await initBrowser();
    }
  }

  // Apply jitter
  const jitter = Math.random() * CONFIG.vail.jitterMs;
  await sleep(jitter);

  console.log(`\n[VAIL] Starting scrape (run #${health.vail.totalRuns}, ${persistentPages.size} pages cached)`);

  try {
    const vailResorts = config.resorts.filter(r =>
      (!r.provider || r.provider === 'vail') &&
      isResortInSeason(r) &&
      (r.terrainUrl || r.url)
    );

    // Filter to priority resorts only (if configured)
    const prioritySet = new Set(CONFIG.vail.priorityResorts || []);
    const priorityResorts = prioritySet.size > 0
      ? vailResorts.filter(r => prioritySet.has(r.key))
      : vailResorts;

    // Filter to resorts not in dead hours
    const activeResorts = priorityResorts.filter(r => !isInDeadHours(r.timezone));

    if (activeResorts.length === 0) {
      console.log('[VAIL] No active resorts at this time');
      return;
    }

    // Shuffle for randomization
    const shuffled = activeResorts.sort(() => Math.random() - 0.5);

    let totalLifts = 0;
    let resortsProcessed = 0;
    const timestamp = new Date().toISOString();

    // Process with limited concurrency using persistent pages
    const concurrency = CONFIG.vail.concurrency;
    for (let i = 0; i < shuffled.length; i += concurrency) {
      const batch = shuffled.slice(i, i + concurrency);

      const results = await Promise.all(batch.map(async (resort) => {
        const url = resort.terrainUrl || resort.url;
        try {
          const data = await scrapeVailResort(resort.key, url);
          return { resort, data };
        } catch (error) {
          console.error(`[VAIL] ${resort.name}: ${error.message}`);
          return { resort, data: null };
        }
      }));

      // Save results
      for (const { resort, data } of results) {
        if (!data?.Lifts?.length) continue;

        const localDate = getResortLocalDate(resort.timezone);
        const localTime = getResortLocalTime(resort.timezone);
        const liftsDir = path.join(CONFIG.dataDir, resort.key, 'lifts');
        ensureDirectoryExists(liftsDir);

        const outputFile = path.join(liftsDir, `${localDate}.ndjson`);
        const records = data.Lifts.map(lift => ({
          timestamp,
          localTime,
          resort: resort.key,
          liftId: lift.SortOrder?.toString() || null,
          name: lift.Name,
          status: lift.Status,
          type: formatLiftType(lift.Type),
          waitMinutes: lift.WaitTimeInMinutes || null,
          capacity: lift.Capacity,
          mountain: lift.Mountain,
          openTime: lift.OpenTime,
          closeTime: lift.CloseTime,
        }));

        fs.appendFileSync(outputFile, records.map(r => JSON.stringify(r)).join('\n') + '\n');
        totalLifts += records.length;
        resortsProcessed++;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[VAIL] Completed in ${elapsed}ms - ${resortsProcessed} resorts, ${totalLifts} lift records`);

    health.vail.lastSuccess = new Date().toISOString();
    health.vail.consecutiveFailures = 0;

  } catch (error) {
    console.error(`[VAIL] Error: ${error.message}`);
    health.vail.consecutiveFailures++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH FILE (shared with API server)
// ═══════════════════════════════════════════════════════════════════════════════

const HEALTH_FILE = path.join(__dirname, 'health.json');

function writeHealthFile() {
  const healthData = {
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

// Write health file every 5 seconds
setInterval(writeHealthFile, 5000);

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════════

let isShuttingDown = false;

process.on('SIGINT', async () => {
  console.log('\nShutdown signal received...');
  isShuttingDown = true;
  if (browser) await browser.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nTermination signal received...');
  isShuttingDown = true;
  if (browser) await browser.close();
  process.exit(0);
});

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║     Ski Lift Scraper - Hetzner Persistent Mode                     ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Ikon interval: ${CONFIG.ikon.intervalMs / 1000}s`);
  console.log(`Vail interval: ${CONFIG.vail.intervalMs / 1000}s`);
  console.log(`Data directory: ${CONFIG.dataDir}`);

  // Initialize browser for Vail
  await initBrowser();

  // Track last run times - set to 0 to trigger immediate first runs
  let lastIkonRun = 0;
  let lastVailRun = 0;

  // Main loop - checks every 5 seconds if it's time to run scrapers
  while (!isShuttingDown) {
    const now = Date.now();

    // Check if it's time for Ikon (every 60s)
    if (now - lastIkonRun >= CONFIG.ikon.intervalMs) {
      lastIkonRun = now;
      // Fire and forget - don't await so we don't block the loop
      runIkonScraper().catch(console.error);
    }

    // Check if it's time for Vail (every 150s)
    if (now - lastVailRun >= CONFIG.vail.intervalMs) {
      lastVailRun = now;
      // Fire and forget - don't await so we don't block the loop
      runVailScraper().catch(console.error);
    }

    // Sleep for a bit before checking again
    await sleep(5000);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
