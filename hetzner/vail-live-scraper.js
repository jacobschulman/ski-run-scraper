// vail-live-scraper.js - Bare-bones Vail-only lift scraper
// Keeps browser alive, reloads page every 45s for near real-time data

const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { formatInTimeZone } = require('date-fns-tz');

const URL = 'https://www.vail.com/the-mountain/mountain-conditions/terrain-and-lift-status.aspx';
const TZ = 'America/Denver';
const DATA_DIR = path.join(__dirname, '..', 'data', 'vail', 'lifts');
const HEALTH_FILE = path.join(__dirname, 'health.json');
const CYCLE_MS = 45000;
const MIN_MEM_MB = 200;

const health = { lastRun: null, lastSuccess: null, consecutiveFailures: 0, totalRuns: 0 };
let browser = null, page = null, isShuttingDown = false;

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

function killOrphanedChromium() {
  const { exec } = require('child_process');
  return new Promise(r => exec('pkill -f chromium 2>/dev/null || true', () => r()));
}

function isDead() {
  const h = parseInt(formatInTimeZone(new Date(), TZ, 'H'));
  return h >= 17 || h < 8;
}

async function launchBrowser() {
  if (browser) try { await browser.close(); } catch {}
  await killOrphanedChromium();
  browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--single-process', '--no-zygote',
      '--js-flags=--max-old-space-size=128',
    ],
  });
  page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
}

async function scrape() {
  const timestamp = new Date().toISOString();
  const localDate = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
  const localTime = formatInTimeZone(new Date(), TZ, 'HH:mm:ss');

  if (page.url().includes('vail.com')) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  } else {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  await page.waitForFunction(
    () => typeof FR !== 'undefined' && FR.TerrainStatusFeed && FR.TerrainStatusFeed.Lifts,
    { timeout: 20000 }
  );

  const lifts = await page.evaluate(() => FR.TerrainStatusFeed.Lifts);
  if (!lifts || !lifts.length) throw new Error('No lift data');

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const lines = lifts.map(l => JSON.stringify({
    timestamp, localTime, resort: 'vail',
    liftId: l.SortOrder?.toString() || null,
    name: l.Name, status: l.Status, type: formatLiftType(l.Type),
    waitMinutes: l.WaitTimeInMinutes != null ? l.WaitTimeInMinutes : null,
    capacity: l.Capacity, mountain: l.Mountain,
    openTime: l.OpenTime, closeTime: l.CloseTime,
  }));

  fs.appendFileSync(path.join(DATA_DIR, `${localDate}.ndjson`), lines.join('\n') + '\n');
  return lifts.length;
}

function writeHealth() {
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8')); } catch {}
  const mem = getMemoryUsage();
  existing.vail = {
    lastRun: health.lastRun, lastSuccess: health.lastSuccess,
    consecutiveFailures: health.consecutiveFailures, totalRuns: health.totalRuns,
  };
  if (mem) existing.memory = mem;
  existing.lastUpdatedBy = 'vail-live-scraper';
  existing.lastUpdatedAt = new Date().toISOString();
  try { fs.writeFileSync(HEALTH_FILE, JSON.stringify(existing, null, 2)); } catch {}
}

async function shutdown() {
  console.log('[VAIL-LIVE] Shutting down...');
  isShuttingDown = true;
  if (browser) try { await browser.close(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
  console.log(`[VAIL-LIVE] Started at ${new Date().toISOString()} | cycle=${CYCLE_MS / 1000}s`);
  await launchBrowser();

  while (!isShuttingDown) {
    try {
      if (isDead()) {
        console.log('[VAIL-LIVE] Dead hours - sleeping 5 min');
        await new Promise(r => setTimeout(r, 300000));
        continue;
      }

      const mem = getMemoryUsage();
      if (mem && mem.availableMB < MIN_MEM_MB) {
        console.error(`[VAIL-LIVE] Low memory: ${mem.availableMB}MB - exiting for PM2 restart`);
        process.exit(1);
      }

      health.lastRun = new Date().toISOString();
      health.totalRuns++;
      const count = await scrape();
      health.lastSuccess = new Date().toISOString();
      health.consecutiveFailures = 0;
      console.log(`[VAIL-LIVE] ${count} lifts | run #${health.totalRuns}`);

    } catch (err) {
      health.consecutiveFailures++;
      console.error(`[VAIL-LIVE] Error (${health.consecutiveFailures}x): ${err.message}`);
      try { await launchBrowser(); } catch (e) {
        console.error('[VAIL-LIVE] Browser relaunch failed - exiting');
        process.exit(1);
      }
    }

    await new Promise(r => setTimeout(r, CYCLE_MS));
  }
}

killOrphanedChromium().then(() => {
  setInterval(writeHealth, 5000);
  main().catch(err => { console.error('[VAIL-LIVE] Fatal:', err); process.exit(1); });
});
