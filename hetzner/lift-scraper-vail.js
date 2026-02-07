// lift-scraper-vail.js - Continuous Puppeteer-based Vail lift scraper for Hetzner
// Runs independently from the HTTP API scrapers so Chrome crashes are isolated

const dns = require('dns');
// Fallback to public DNS if system resolver is broken (e.g., Tailscale MagicDNS down)
dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { formatInTimeZone } = require('date-fns-tz');

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const configPath = path.join(__dirname, '..', 'config.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error('Failed to load config.json:', error.message);
  process.exit(1);
}

const CONFIG = {
  enabledResorts: config.liftScraping?.vail?.enabledResorts || [],

  // Operating hours (local resort time)
  scrapingStartHour: 8,
  scrapingEndHour: 17,

  // Page pool size - each page uses ~50-100MB RAM
  pagePoolSize: 1,

  // How often to scrape (in ms)
  cycleIntervalMs: 180 * 1000,  // 3 minutes

  // Delay between launching each scrape (gentler on servers)
  delayBetweenScrapes: 500,     // 500ms

  // Timeouts
  navigationTimeout: 45000,    // 45s to load page
  dataWaitTimeout: 30000,      // 30s to wait for FR.TerrainStatusFeed

  // Failure handling
  failureCooldownMs: 10 * 60 * 1000,  // Skip failing resorts for 10 minutes
  maxConsecutiveFailures: 4,          // After 4 failures, apply cooldown

  dataDir: path.join(__dirname, '..', 'data'),
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

// Health tracking
const health = {
  vail: { lastRun: null, lastSuccess: null, consecutiveFailures: 0, totalRuns: 0 },
  startTime: Date.now(),
};

// Chrome memory management
// With --single-process, Chrome accumulates memory across page navigations.
// Browser is closed after each cycle to prevent this.
const MAX_VAIL_CYCLES = 200; // ~10 hours, covers full operating day
const MIN_AVAILABLE_MEMORY_MB = 256;
let vailCycleCount = 0;

// Per-resort failure tracking for graceful degradation
const resortFailureCounts = {};  // resort.key -> consecutive failure count
const resortCooldowns = {};      // resort.key -> timestamp when cooldown expires

const RESORTS = config.resorts.reduce((acc, resort) => {
  acc[resort.key] = resort;
  return acc;
}, {});

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
  const startHour = CONFIG.scrapingStartHour || 8;
  const endHour = CONFIG.scrapingEndHour || 17;
  return hour >= endHour || hour < startHour;
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
// VAIL SCRAPER (Puppeteer)
// ═══════════════════════════════════════════════════════════════════════════════

const vailState = {
  browser: null,
  pagePool: [],
  queue: [],
  running: false,
  lastCycleStart: 0,
};

// Kill any orphaned chromium processes before starting fresh
async function killOrphanedChromium() {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec('pkill -f chromium 2>/dev/null || true', (err) => {
      resolve();
    });
  });
}

async function initBrowser(state, poolSize, label) {
  if (state.browser) {
    try { await state.browser.close(); } catch (e) {}
  }

  await killOrphanedChromium();

  console.log(`[${label}] Launching browser with memory optimizations...`);
  state.browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--single-process',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-default-apps',
      '--mute-audio',
      '--disable-sync',
      '--disable-translate',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      '--disable-hang-monitor',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-domain-reliability',
      '--disable-component-update',
      '--disable-breakpad',
      '--no-first-run',
      '--no-zygote',
      '--js-flags=--max-old-space-size=128',
      // Force Google DoH to bypass broken system DNS (Tailscale MagicDNS REFUSED)
      '--dns-over-https-mode=secure',
      '--dns-over-https-templates=https://dns.google/dns-query{?dns}',
    ],
  });

  state.pagePool.length = 0;
  for (let i = 0; i < poolSize; i++) {
    const page = await state.browser.newPage();
    await page.setUserAgent(getRandomUserAgent());
    state.pagePool.push({ page, inUse: false, lastUrl: null });
    console.log(`[${label}] Created page ${i + 1}/${poolSize}`);
  }

  console.log(`[${label}] Browser ready with ${poolSize} pages`);
}

function buildVailQueue() {
  const enabledKeys = new Set(CONFIG.enabledResorts || []);

  const allVailResorts = config.resorts.filter(r =>
    (!r.provider || r.provider === 'vail') &&
    enabledKeys.has(r.key) &&
    isResortInSeason(r)
  );

  const deadHourResorts = allVailResorts.filter(r => isInDeadHours(r.timezone));
  if (deadHourResorts.length > 0 && deadHourResorts.length === allVailResorts.length) {
    const sampleTz = deadHourResorts[0].timezone;
    const localTime = getResortLocalTime(sampleTz);
    console.log(`[VAIL] All resorts in dead hours (current time: ${localTime}) - scraping window: ${CONFIG.scrapingStartHour}:00-${CONFIG.scrapingEndHour}:00`);
  }

  const resorts = allVailResorts.filter(r =>
    !isInDeadHours(r.timezone) &&
    (r.terrainUrl || r.url) &&
    // Skip resorts in cooldown
    (!resortCooldowns[r.key] || Date.now() > resortCooldowns[r.key])
  );

  return resorts;
}

async function scrapeOneResort(poolEntry, resort, label = 'VAIL') {
  const { page } = poolEntry;
  const url = resort.terrainUrl || resort.url;
  const timestamp = new Date().toISOString();

  try {
    const navTimeout = CONFIG.navigationTimeout;
    const dataTimeout = CONFIG.dataWaitTimeout;

    // Navigate or reload
    if (poolEntry.lastUrl === url) {
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: navTimeout });
      } catch (e) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout });
      }
    } else {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout });
      poolEntry.lastUrl = url;
    }

    // Give extra time for JS to execute after domcontentloaded
    await sleep(2000);

    // Wait for data
    await page.waitForFunction(
      () => typeof FR !== 'undefined' && FR.TerrainStatusFeed,
      { timeout: dataTimeout }
    );

    const data = await page.evaluate(() => {
      if (typeof FR !== 'undefined' && FR.TerrainStatusFeed) {
        return { Lifts: FR.TerrainStatusFeed.Lifts || [] };
      }
      return null;
    });

    if (!data?.Lifts?.length) {
      console.log(`[${label}] ${resort.key}: No lift data`);
      return { success: false, lifts: 0 };
    }

    // Save all lift data
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
      waitMinutes: lift.WaitTimeInMinutes != null ? lift.WaitTimeInMinutes : null,
      capacity: lift.Capacity,
      mountain: lift.Mountain,
      openTime: lift.OpenTime,
      closeTime: lift.CloseTime,
    }));

    fs.appendFileSync(outputFile, records.map(r => JSON.stringify(r)).join('\n') + '\n');

    console.log(`[${label}] ${resort.key}: ${records.length} lifts`);
    // Reset failure count on success
    resortFailureCounts[resort.key] = 0;
    return { success: true, lifts: records.length };

  } catch (error) {
    let errorType = 'Unknown';
    if (error.message.includes('timeout')) errorType = 'Timeout';
    if (error.message.includes('waitForFunction')) errorType = 'DataWaitTimeout';
    if (error.message.includes('Waiting failed')) errorType = 'DataWaitTimeout';
    if (error.message.includes('navigation')) errorType = 'NavigationError';
    if (error.message.includes('browser')) errorType = 'BrowserError';

    console.error(`[${label}] ${resort.key} [${errorType}]: ${error.message}`);

    // Track per-resort failures and apply cooldown
    resortFailureCounts[resort.key] = (resortFailureCounts[resort.key] || 0) + 1;
    if (resortFailureCounts[resort.key] >= CONFIG.maxConsecutiveFailures) {
      resortCooldowns[resort.key] = Date.now() + CONFIG.failureCooldownMs;
      console.warn(`[${label}] ${resort.key} cooling down for ${CONFIG.failureCooldownMs / 1000}s after ${resortFailureCounts[resort.key]} consecutive failures`);
    }

    // For browser errors, signal that the browser needs a restart
    if (errorType === 'BrowserError') {
      return { success: false, lifts: 0, needsBrowserRestart: true };
    }

    poolEntry.lastUrl = null;
    return { success: false, lifts: 0 };
  }
}

async function processScrapeQueue(state, label, delayScrapes) {
  let totalLifts = 0;
  let resortsProcessed = 0;
  const activePromises = new Map();

  const getAvailablePage = () => state.pagePool.find(p => !p.inUse);

  while (state.queue.length > 0 || activePromises.size > 0) {
    while (state.queue.length > 0) {
      const poolEntry = getAvailablePage();
      if (!poolEntry) break;

      const resort = state.queue.shift();
      poolEntry.inUse = true;

      const promise = scrapeOneResort(poolEntry, resort, label)
        .then(result => {
          poolEntry.inUse = false;
          if (result.success) {
            totalLifts += result.lifts;
            resortsProcessed++;
            health.vail.lastSuccess = new Date().toISOString();
            health.vail.consecutiveFailures = 0;
          }
          // If browser needs restart, handle it
          if (result.needsBrowserRestart && state.queue.length > 0) {
            console.warn(`[${label}] Browser error detected -- restarting browser for remaining resorts`);
            return initBrowser(state, CONFIG.pagePoolSize, label).catch(e => {
              console.error(`[${label}] Failed to restart browser: ${e.message}`);
            });
          }
        })
        .catch(error => {
          poolEntry.inUse = false;
          console.error(`[${label}] Unhandled: ${error.message}`);
        });

      activePromises.set(resort.key, promise);

      if (delayScrapes) {
        await sleep(delayScrapes);
      }
    }

    if (activePromises.size > 0) {
      await Promise.race(activePromises.values());
      for (const [key, promise] of activePromises.entries()) {
        const resolved = await Promise.race([promise, Promise.resolve('pending')]);
        if (resolved !== 'pending') {
          activePromises.delete(key);
        }
      }
    }
  }

  console.log(`[${label}] Queue done: ${resortsProcessed} resorts, ${totalLifts} lifts`);
}

async function runVailScraper() {
  if (vailState.running) return;

  // Check if enough time has passed since last cycle
  const now = Date.now();
  const timeSinceLastCycle = now - vailState.lastCycleStart;
  if (timeSinceLastCycle < CONFIG.cycleIntervalMs) {
    return;
  }

  vailState.running = true;
  vailState.lastCycleStart = now;

  health.vail.lastRun = new Date().toISOString();
  health.vail.totalRuns++;

  // Build queue first
  vailState.queue = buildVailQueue();

  if (vailState.queue.length === 0) {
    console.log('[VAIL] No active resorts to scrape');
    vailState.running = false;
    return;
  }

  // Check memory -- try cleanup before giving up
  const mem = getMemoryUsage();
  if (mem && mem.availableMB < MIN_AVAILABLE_MEMORY_MB) {
    console.warn(`[VAIL] Low memory: ${mem.availableMB}MB -- cleaning up before scraping`);
    if (vailState.browser) {
      try { await vailState.browser.close(); } catch (e) {}
      vailState.browser = null;
      vailState.pagePool.length = 0;
    }
    await killOrphanedChromium();
    if (global.gc) global.gc();

    const memAfter = getMemoryUsage();
    if (memAfter && memAfter.availableMB < MIN_AVAILABLE_MEMORY_MB / 2) {
      console.error(`[VAIL] Memory still critical after cleanup (${memAfter.availableMB}MB) -- exiting for PM2 restart`);
      process.exit(1);
    }
    console.log(`[VAIL] Memory recovered to ${memAfter?.availableMB || '?'}MB -- continuing`);
  }

  // Cycle management
  if (vailCycleCount >= MAX_VAIL_CYCLES) {
    console.log(`[VAIL] Reached ${MAX_VAIL_CYCLES} cycles -- resetting counter`);
    vailCycleCount = 0;
    if (global.gc) global.gc();
  }

  // Launch fresh browser each cycle
  await initBrowser(vailState, CONFIG.pagePoolSize, 'VAIL');

  console.log(`[VAIL] Cycle ${vailCycleCount + 1} - ${vailState.queue.length} resorts: ${vailState.queue.map(r => r.key).join(', ')}`);

  await processScrapeQueue(vailState, 'VAIL', CONFIG.delayBetweenScrapes);

  // Close browser after each cycle to free all Chrome memory
  if (vailState.browser) {
    try { await vailState.browser.close(); } catch (e) {}
    vailState.browser = null;
    vailState.pagePool.length = 0;
  }
  await killOrphanedChromium();

  vailCycleCount++;
  console.log(`[VAIL] Cycle complete (memory released)`);
  vailState.running = false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH FILE (shared with API server and others scraper)
// ═══════════════════════════════════════════════════════════════════════════════

const HEALTH_FILE = path.join(__dirname, 'health.json');

function getMemoryUsage() {
  try {
    const memInfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const lines = memInfo.split('\n');
    const getValue = (key) => {
      const line = lines.find(l => l.startsWith(key));
      if (!line) return 0;
      return parseInt(line.split(/\s+/)[1]) * 1024;
    };
    const total = getValue('MemTotal:');
    const available = getValue('MemAvailable:');
    const swapTotal = getValue('SwapTotal:');
    const swapFree = getValue('SwapFree:');
    return {
      totalMB: Math.round(total / 1024 / 1024),
      availableMB: Math.round(available / 1024 / 1024),
      usedMB: Math.round((total - available) / 1024 / 1024),
      usedPercent: Math.round((1 - available / total) * 100),
      swapUsedMB: Math.round((swapTotal - swapFree) / 1024 / 1024),
      swapUsedPercent: swapTotal > 0 ? Math.round((1 - swapFree / swapTotal) * 100) : 0,
    };
  } catch (e) {
    return null;
  }
}

function writeHealthFile() {
  // Read existing health file to preserve others scraper's data
  let existingHealth = {};
  try {
    existingHealth = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8'));
  } catch (e) {}

  const memory = getMemoryUsage();
  const healthData = {
    ...existingHealth,
    status: health.vail.consecutiveFailures >= 3 ? 'degraded' : (existingHealth.status === 'degraded' ? 'degraded' : 'ok'),
    memory: memory || existingHealth.memory,
    vail: {
      lastRun: health.vail.lastRun,
      lastSuccess: health.vail.lastSuccess,
      consecutiveFailures: health.vail.consecutiveFailures,
      totalRuns: health.vail.totalRuns,
    },
    lastUpdatedBy: 'lift-scraper-vail',
    lastUpdatedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(HEALTH_FILE, JSON.stringify(healthData, null, 2));
  } catch (e) {
    console.error('Failed to write health file:', e.message);
  }
}

setInterval(writeHealthFile, 5000);

// ═══════════════════════════════════════════════════════════════════════════════
// TEMP DIRECTORY CLEANUP
// ═══════════════════════════════════════════════════════════════════════════════

function cleanupOldTempProfiles() {
  const { exec } = require('child_process');
  exec('find /tmp -name "puppeteer_dev_chrome_profile-*" -type d -mmin +120 -exec rm -rf {} + 2>/dev/null',
    (err) => {
      if (err && err.code !== 1) {
        console.error('[CLEANUP] Error cleaning temp profiles:', err.message);
      } else {
        console.log('[CLEANUP] Cleaned up old Puppeteer temp profiles');
      }
    }
  );
}

setInterval(cleanupOldTempProfiles, 60 * 60 * 1000);
cleanupOldTempProfiles();

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════════

let isShuttingDown = false;

process.on('SIGINT', async () => {
  console.log('\nShutdown signal received...');
  isShuttingDown = true;
  if (vailState.browser) await vailState.browser.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nTermination signal received...');
  isShuttingDown = true;
  if (vailState.browser) await vailState.browser.close();
  process.exit(0);
});

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║     Lift Scraper - Vail (Puppeteer)                                ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log(`Started at: ${new Date().toISOString()}`);

  const initMem = getMemoryUsage();
  if (initMem) {
    console.log(`Memory: ${initMem.usedMB}MB / ${initMem.totalMB}MB (${initMem.usedPercent}%), Swap: ${initMem.swapUsedMB}MB (${initMem.swapUsedPercent}%)`);
  }
  console.log('');
  console.log('┌─ VAIL RESORTS ───────────────────────────────────────────────────────');
  console.log(`│ Enabled: ${(CONFIG.enabledResorts || []).join(', ')}`);
  console.log(`│ Scraping window: ${CONFIG.scrapingStartHour}:00 - ${CONFIG.scrapingEndHour}:00 (local time)`);
  console.log(`│ Pages: ${CONFIG.pagePoolSize}, Cycle: ${CONFIG.cycleIntervalMs / 1000}s`);
  console.log(`│ Timeouts: nav=${CONFIG.navigationTimeout / 1000}s, data=${CONFIG.dataWaitTimeout / 1000}s`);
  console.log('└───────────────────────────────────────────────────────────────────────');
  console.log('');
  console.log(`Error handling: per-resort cooldown (${CONFIG.failureCooldownMs / 1000}s after ${CONFIG.maxConsecutiveFailures} failures)`);
  console.log(`Memory management: browser closed after each cycle, GC after ${MAX_VAIL_CYCLES} cycles`);
  console.log(`Data directory: ${CONFIG.dataDir}`);
  console.log('');

  while (!isShuttingDown) {
    if (!vailState.running) {
      runVailScraper().catch(error => {
        console.error('[VAIL] Unhandled error in cycle:', error.message);
        vailState.running = false;
      });
    }

    await sleep(5000);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
