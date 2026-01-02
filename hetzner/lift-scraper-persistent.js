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
    // Rotating queue approach - cycle through all resorts with a small page pool
    pagePoolSize: 2,            // Only keep 2 pages open at a time
    delayBetweenScrapes: 15000, // 15 seconds between each resort scrape
    // High priority resorts appear 3x in queue (scraped ~every 5 min)
    // Normal resorts appear 1x in queue (scraped ~every 15-20 min)
    highPriorityResorts: [
      'vail',
      'beavercreek',
      'parkcity',
      'breckenridge',
      'keystone',
      'whistlerblackcomb',
      'stowe',
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

// Aspen Snowmass API
const ASPEN_API_BASE = 'https://www.aspensnowmass.com/AspenSnowmass/LiftStatus/Feed';

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

function fetchAspenData(mountainId) {
  return new Promise((resolve, reject) => {
    const url = `${ASPEN_API_BASE}?mountain=${mountainId}&areas=&isSummer=False`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Aspen JSON parse error: ${e.message}`));
          }
        } else {
          reject(new Error(`Aspen HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

function parseAspenHours(hoursStr) {
  if (!hoursStr) return { openTime: null, closeTime: null };
  const match = hoursStr.match(/(\d+:\d+\s*[AP]M)\s*-\s*(\d+:\d+\s*[AP]M)/i);
  if (match) return { openTime: match[1], closeTime: match[2] };
  return { openTime: null, closeTime: null };
}

function normalizeAspenLiftType(type) {
  if (!type) return null;
  if (type.includes('Gondola')) return 'Gondola';
  if (type.includes('HS') || type.includes('Express') || type.includes('Quad') ||
      type.includes('Triple') || type.includes('Double') || type.includes('Fixed')) return 'Chair';
  if (type.includes('Surface') || type.includes('T-Bar')) return 'Surface';
  if (type.includes('Carpet') || type.includes('Conveyor')) return 'Carpet';
  return type;
}

async function runAspenScraper() {
  const aspenResorts = config.resorts.filter(r =>
    r.provider === 'ikon' &&
    r.apiProvider === 'aspensnowmass' &&
    isResortInSeason(r)
  );

  if (aspenResorts.length === 0) return;

  const timestamp = new Date().toISOString();
  let totalLifts = 0;

  for (const resort of aspenResorts) {
    if (isInDeadHours(resort.timezone)) continue;

    const mountainId = resort.apiConfig?.mountainId;
    if (!mountainId) continue;

    try {
      const aspenData = await fetchAspenData(mountainId);
      if (!aspenData?.liftStatuses?.length) continue;

      const localDate = getResortLocalDate(resort.timezone);
      const localTime = getResortLocalTime(resort.timezone);
      const liftsDir = path.join(CONFIG.dataDir, resort.key, 'lifts');
      ensureDirectoryExists(liftsDir);

      const outputFile = path.join(liftsDir, `${localDate}.ndjson`);
      const records = aspenData.liftStatuses.map(lift => {
        const hours = parseAspenHours(lift.hoursOfOperation);
        return {
          timestamp,
          localTime,
          resort: resort.key,
          liftId: `aspen:${lift.liftName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          name: lift.liftName,
          status: lift.status,
          type: normalizeAspenLiftType(lift.type),
          waitMinutes: null,
          openTime: hours.openTime,
          closeTime: hours.closeTime,
          mountain: lift.area,
        };
      });

      fs.appendFileSync(outputFile, records.map(r => JSON.stringify(r)).join('\n') + '\n');
      totalLifts += records.length;
      console.log(`[ASPEN] ${resort.key}: ${records.length} lifts`);
    } catch (error) {
      console.error(`[ASPEN] ${resort.key}: ${error.message}`);
    }
  }

  if (totalLifts > 0) {
    console.log(`[ASPEN] Total: ${totalLifts} lift records`);
  }
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
// VAIL SCRAPER (Puppeteer) - Rotating Queue with Small Page Pool
// ═══════════════════════════════════════════════════════════════════════════════

let browser = null;
const pagePool = [];        // Small pool of reusable pages
let resortQueue = [];       // Queue of resorts to scrape
let vailRunning = false;    // Prevent overlapping runs

async function initBrowser() {
  if (browser) {
    try { await browser.close(); } catch (e) {}
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

  // Initialize page pool
  pagePool.length = 0;
  for (let i = 0; i < CONFIG.vail.pagePoolSize; i++) {
    const page = await browser.newPage();
    await page.setUserAgent(getRandomUserAgent());
    pagePool.push({ page, inUse: false, lastUrl: null });
    console.log(`[VAIL] Created page ${i + 1}/${CONFIG.vail.pagePoolSize}`);
  }

  console.log('[VAIL] Browser ready with page pool');
}

function getAvailablePage() {
  return pagePool.find(p => !p.inUse);
}

function buildResortQueue() {
  const vailResorts = config.resorts.filter(r =>
    (!r.provider || r.provider === 'vail') &&
    isResortInSeason(r) &&
    (r.terrainUrl || r.url)
  );

  // Filter to resorts not in dead hours
  const activeResorts = vailResorts.filter(r => !isInDeadHours(r.timezone));

  if (activeResorts.length === 0) return [];

  const highPrioritySet = new Set(CONFIG.vail.highPriorityResorts || []);
  const queue = [];

  // Add high priority resorts 3x (will be scraped more frequently)
  for (const resort of activeResorts) {
    if (highPrioritySet.has(resort.key)) {
      queue.push(resort);
      queue.push(resort);
      queue.push(resort);
    } else {
      queue.push(resort);
    }
  }

  // Shuffle the queue
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }

  return queue;
}

async function scrapeOneResort(poolEntry, resort) {
  const { page } = poolEntry;
  const url = resort.terrainUrl || resort.url;
  const timestamp = new Date().toISOString();

  try {
    // Navigate or reload
    if (poolEntry.lastUrl === url) {
      // Same URL - just reload
      try {
        await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
      } catch (e) {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
      }
    } else {
      // Different URL - full navigation
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
      poolEntry.lastUrl = url;
    }

    // Wait for data
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

    if (!data?.Lifts?.length) {
      console.log(`[VAIL] ${resort.key}: No lift data`);
      return { success: false, lifts: 0 };
    }

    // Save data
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

    console.log(`[VAIL] ${resort.key}: ${records.length} lifts`);
    return { success: true, lifts: records.length };

  } catch (error) {
    console.error(`[VAIL] ${resort.key}: ${error.message}`);
    // Reset lastUrl so we do full navigation next time
    poolEntry.lastUrl = null;
    return { success: false, lifts: 0 };
  }
}

async function runVailScraper() {
  // Prevent overlapping runs
  if (vailRunning) return;
  vailRunning = true;

  health.vail.lastRun = new Date().toISOString();
  health.vail.totalRuns++;

  // Ensure browser is alive
  if (!browser) {
    await initBrowser();
  } else {
    try {
      await browser.version();
    } catch (e) {
      console.log('[VAIL] Browser died, restarting...');
      await initBrowser();
    }
  }

  // Rebuild queue if empty
  if (resortQueue.length === 0) {
    resortQueue = buildResortQueue();
    if (resortQueue.length === 0) {
      // Check if ALL resorts are in dead hours - if so, close browser to save memory
      const anyActive = config.resorts.some(r =>
        isResortInSeason(r) && !isInDeadHours(r.timezone)
      );
      if (!anyActive && browser) {
        console.log('[VAIL] All resorts in dead hours - closing browser to save memory');
        try {
          await browser.close();
        } catch (e) {}
        browser = null;
        pagePool.length = 0;
      }
      console.log('[VAIL] No active resorts at this time');
      vailRunning = false;
      return;
    }
    console.log(`[VAIL] Built queue with ${resortQueue.length} entries`);
  }

  console.log(`[VAIL] Queue: ${resortQueue.length} remaining`);

  let totalLifts = 0;
  let resortsProcessed = 0;

  // Process resorts one at a time using available pages
  while (resortQueue.length > 0) {
    const poolEntry = getAvailablePage();
    if (!poolEntry) {
      // All pages busy - wait a bit
      await sleep(1000);
      continue;
    }

    const resort = resortQueue.shift();

    // Skip if resort is now in dead hours
    if (isInDeadHours(resort.timezone)) {
      continue;
    }

    poolEntry.inUse = true;

    try {
      const result = await scrapeOneResort(poolEntry, resort);
      if (result.success) {
        totalLifts += result.lifts;
        resortsProcessed++;
        health.vail.lastSuccess = new Date().toISOString();
        health.vail.consecutiveFailures = 0;
      }
    } finally {
      poolEntry.inUse = false;
    }

    // Delay between scrapes to be nice to servers
    await sleep(CONFIG.vail.delayBetweenScrapes);
  }

  console.log(`[VAIL] Cycle complete: ${resortsProcessed} resorts, ${totalLifts} lifts`);
  vailRunning = false;
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
  console.log('║     Ski Lift Scraper - Hetzner Rotating Queue Mode                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Ikon interval: ${CONFIG.ikon.intervalMs / 1000}s`);
  console.log(`Vail: ${CONFIG.vail.pagePoolSize} pages, ${CONFIG.vail.delayBetweenScrapes / 1000}s between scrapes`);
  console.log(`High priority resorts: ${CONFIG.vail.highPriorityResorts.join(', ')}`);
  console.log(`Data directory: ${CONFIG.dataDir}`);

  // Initialize browser for Vail
  await initBrowser();

  // Track last run times - set to 0 to trigger immediate first runs
  let lastIkonRun = 0;

  // Main loop - checks every 5 seconds if it's time to run scrapers
  while (!isShuttingDown) {
    const now = Date.now();

    // Check if it's time for Ikon + Aspen (every 2.5 min)
    if (now - lastIkonRun >= CONFIG.ikon.intervalMs) {
      lastIkonRun = now;
      // Fire and forget - don't await so we don't block the loop
      runIkonScraper().catch(console.error);
      runAspenScraper().catch(console.error);
    }

    // Vail runs continuously - just trigger it, it handles its own queue
    if (!vailRunning) {
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
