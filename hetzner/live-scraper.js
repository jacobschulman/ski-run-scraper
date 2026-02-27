// live-scraper.js - Generalized real-time lift scraper
// Based on the proven vail-live-scraper pattern.
// Fresh browser per resort to prevent Chrome memory leaks across navigations.
//
// Usage: node live-scraper.js <instance-name>
// Instance name maps to a resort group in config.json liftScraping.vail.instances
//
// Example PM2: pm2 start live-scraper.js --name live-scraper-a -- a

const dns = require('dns');
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

const args = process.argv.slice(2);
const TEST_MODE = args.includes('--test');
const INSTANCE_NAME = args.find(a => !a.startsWith('--'));
if (!INSTANCE_NAME) {
  console.error('Usage: node live-scraper.js <instance-name> [--test]');
  console.error('  --test    Run one cycle and exit (for local validation)');
  console.error('Instance name maps to config.json liftScraping.vail.instances.<name>');
  process.exit(1);
}

const instanceConfig = config.liftScraping?.vail?.instances?.[INSTANCE_NAME];
if (!instanceConfig || !instanceConfig.resorts || instanceConfig.resorts.length === 0) {
  console.error(`No instance "${INSTANCE_NAME}" found in config.json liftScraping.vail.instances`);
  process.exit(1);
}

const RESORT_KEYS = instanceConfig.resorts;
const CYCLE_MS = instanceConfig.cycleMs || 120000; // default 2 min
const MIN_MEM_MB = 200;
const DATA_DIR = path.join(__dirname, '..', 'data');
const HEALTH_FILE = path.join(__dirname, 'health.json');
const LABEL = `LIVE-${INSTANCE_NAME.toUpperCase()}`;

// Build resort lookup
const RESORTS = {};
for (const key of RESORT_KEYS) {
  const resort = config.resorts.find(r => r.key === key);
  if (!resort) {
    console.error(`Resort "${key}" not found in config.json`);
    process.exit(1);
  }
  if (!resort.terrainUrl) {
    console.error(`Resort "${key}" has no terrainUrl`);
    process.exit(1);
  }
  RESORTS[key] = resort;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

const health = { lastRun: null, lastSuccess: null, consecutiveFailures: 0, totalRuns: 0, resortStats: {} };
let isShuttingDown = false;

function formatLiftType(type) {
  if (!type) return null;
  const map = {
    'Gondola': 'Gondola', 'Chairlift': 'Chair', 'Express': 'Chair',
    'Detachable': 'Chair', 'Fixed Grip': 'Chair', 'Surface': 'Surface',
    'T-Bar': 'Surface', 'Magic Carpet': 'Carpet', 'Conveyor': 'Carpet',
  };
  for (const [k, v] of Object.entries(map)) {
    if (type.includes(k)) return v;
  }
  return type;
}

function getMemoryUsage() {
  try {
    const info = fs.readFileSync('/proc/meminfo', 'utf8');
    const val = (key) => {
      const m = info.match(new RegExp(`${key}:\\s+(\\d+)`));
      return m ? parseInt(m[1]) * 1024 : 0;
    };
    const total = val('MemTotal'), available = val('MemAvailable');
    return {
      totalMB: Math.round(total / 1024 / 1024),
      availableMB: Math.round(available / 1024 / 1024),
      usedMB: Math.round((total - available) / 1024 / 1024),
      usedPercent: Math.round((1 - available / total) * 100),
    };
  } catch { return null; }
}

function isDead(timezone) {
  const h = parseInt(formatInTimeZone(new Date(), timezone, 'H'));
  return h >= 17 || h < 8;
}

function allResortsDead() {
  return RESORT_KEYS.every(key => isDead(RESORTS[key].timezone));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCRAPER - Fresh browser per resort
// ═══════════════════════════════════════════════════════════════════════════════

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

async function scrapeResort(resortKey) {
  const resort = RESORTS[resortKey];
  const url = resort.terrainUrl;
  const timezone = resort.timezone;

  // Skip if this resort is in dead hours (unless testing)
  if (!TEST_MODE && isDead(timezone)) {
    return { key: resortKey, skipped: true, reason: 'dead_hours' };
  }

  const timestamp = new Date().toISOString();
  const localDate = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
  const localTime = formatInTimeZone(new Date(), timezone, 'HH:mm:ss');

  let browser;
  try {
    // Fresh browser for each resort - prevents Chrome memory leaks
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--single-process', '--no-zygote',
        '--js-flags=--max-old-space-size=128',
        '--disable-extensions', '--disable-plugins', '--disable-default-apps',
        '--mute-audio', '--disable-sync', '--disable-translate',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForFunction(
      () => typeof FR !== 'undefined' && FR.TerrainStatusFeed && FR.TerrainStatusFeed.Lifts,
      { timeout: 20000 }
    );

    const lifts = await page.evaluate(() => FR.TerrainStatusFeed.Lifts);
    if (!lifts || !lifts.length) throw new Error('No lift data');

    // Save NDJSON
    const liftsDir = path.join(DATA_DIR, resortKey, 'lifts');
    if (!fs.existsSync(liftsDir)) fs.mkdirSync(liftsDir, { recursive: true });

    const lines = lifts.map(l => JSON.stringify({
      timestamp, localTime, resort: resortKey,
      liftId: l.SortOrder?.toString() || null,
      name: l.Name, status: l.Status, type: formatLiftType(l.Type),
      waitMinutes: l.WaitTimeInMinutes != null ? l.WaitTimeInMinutes : null,
      capacity: l.Capacity, mountain: l.Mountain,
      openTime: l.OpenTime, closeTime: l.CloseTime,
    }));

    fs.appendFileSync(path.join(liftsDir, `${localDate}.ndjson`), lines.join('\n') + '\n');

    return { key: resortKey, success: true, lifts: lifts.length };

  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════════════════════════════════════════

function writeHealth() {
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8')); } catch {}

  const mem = getMemoryUsage();
  existing[`live_${INSTANCE_NAME}`] = {
    lastRun: health.lastRun,
    lastSuccess: health.lastSuccess,
    consecutiveFailures: health.consecutiveFailures,
    totalRuns: health.totalRuns,
    resorts: RESORT_KEYS,
    resortStats: health.resortStats,
  };
  if (mem) existing.memory = mem;
  existing.lastUpdatedBy = `live-scraper-${INSTANCE_NAME}`;
  existing.lastUpdatedAt = new Date().toISOString();
  try { fs.writeFileSync(HEALTH_FILE, JSON.stringify(existing, null, 2)); } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════════

async function shutdown() {
  console.log(`[${LABEL}] Shutting down...`);
  isShuttingDown = true;
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function runCycle() {
  health.lastRun = new Date().toISOString();
  health.totalRuns++;

  let cycleSuccess = 0;
  let cycleFail = 0;

  for (const key of RESORT_KEYS) {
    if (isShuttingDown) break;

    try {
      const result = await scrapeResort(key);

      if (result.skipped) {
        // Don't count skips as failures
        continue;
      }

      if (result.success) {
        cycleSuccess++;
        health.resortStats[key] = {
          lastSuccess: new Date().toISOString(),
          lifts: result.lifts,
          consecutiveFailures: 0,
        };
        console.log(`[${LABEL}] ${key}: ${result.lifts} lifts`);
      }
    } catch (err) {
      cycleFail++;
      const stats = health.resortStats[key] || { consecutiveFailures: 0 };
      stats.consecutiveFailures = (stats.consecutiveFailures || 0) + 1;
      stats.lastError = err.message;
      health.resortStats[key] = stats;
      console.error(`[${LABEL}] ${key}: ${err.message}`);
    }
  }

  if (cycleSuccess > 0) {
    health.lastSuccess = new Date().toISOString();
    health.consecutiveFailures = 0;
  } else if (cycleFail > 0) {
    health.consecutiveFailures++;
  }

  return { success: cycleSuccess, fail: cycleFail };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log(`║  Live Scraper: ${INSTANCE_NAME.padEnd(50)}║`);
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Resorts: ${RESORT_KEYS.join(', ')}`);
  console.log(`Cycle:   ${CYCLE_MS / 1000}s`);
  console.log(`Data:    ${DATA_DIR}`);
  if (TEST_MODE) console.log(`Mode:    TEST (single cycle)`);
  console.log('');

  while (!isShuttingDown) {
    // Check memory (Linux only - returns null on macOS)
    const mem = getMemoryUsage();
    if (mem && mem.availableMB < MIN_MEM_MB) {
      console.error(`[${LABEL}] Low memory: ${mem.availableMB}MB - exiting for PM2 restart`);
      process.exit(1);
    }

    // Check if all resorts are in dead hours (skip in test mode)
    if (!TEST_MODE && allResortsDead()) {
      console.log(`[${LABEL}] All resorts in dead hours - sleeping 5 min`);
      await new Promise(r => setTimeout(r, 300000));
      continue;
    }

    const cycleStart = Date.now();
    const result = await runCycle();
    const elapsed = Math.round((Date.now() - cycleStart) / 1000);

    if (result.success > 0 || result.fail > 0) {
      console.log(`[${LABEL}] Cycle #${health.totalRuns}: ${result.success} ok, ${result.fail} fail (${elapsed}s)`);
    }

    // In test mode, run one cycle and exit
    if (TEST_MODE) {
      console.log(`\n[${LABEL}] Test complete. ${result.success} resorts scraped successfully.`);
      if (result.fail > 0) {
        console.log(`[${LABEL}] ${result.fail} resorts failed - check errors above.`);
        process.exit(1);
      }
      process.exit(0);
    }

    // Sleep for remainder of cycle
    const sleepMs = Math.max(0, CYCLE_MS - (Date.now() - cycleStart));
    if (sleepMs > 0) {
      await new Promise(r => setTimeout(r, sleepMs));
    }
  }
}

setInterval(writeHealth, 5000);
main().catch(err => { console.error(`[${LABEL}] Fatal:`, err); process.exit(1); });
