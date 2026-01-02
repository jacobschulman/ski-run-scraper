// snow-scraper-persistent.js - Continuous snow report scraper for Hetzner
// Runs both Ikon (HTTP API) and Vail (Puppeteer) snow scrapers
// Uses a single persistent page for efficiency

const puppeteer = require('puppeteer');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { formatInTimeZone } = require('date-fns-tz');

// Configuration
const CONFIG = {
  ikon: {
    intervalMs: 30 * 60 * 1000,    // 30 minutes
    jitterMs: 30000,               // 0-30 seconds random jitter
  },
  vail: {
    intervalMs: 30 * 60 * 1000,    // 30 minutes
    jitterMs: 60000,               // 0-60 seconds random jitter
    delayBetweenResorts: 5000,     // 5 seconds between resorts
  },
  dataDir: path.join(__dirname, '..', 'data'),
  configPath: path.join(__dirname, '..', 'config.json'),
};

// Load resort configuration
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

// Health tracking
const health = {
  startTime: Date.now(),
  ikon: { totalRuns: 0, successfulRuns: 0, consecutiveFailures: 0, lastRun: null, lastSuccess: null, resortsScraped: 0 },
  vail: { totalRuns: 0, successfulRuns: 0, consecutiveFailures: 0, lastRun: null, lastSuccess: null, resortsScraped: 0 },
};

// Shared browser and page for Vail scraping
let browser = null;
let page = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getResortLocalDate(timezone) {
  return formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
}

function isResortInSeason(resort) {
  const timezone = resort.timezone || 'America/Denver';
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

function normalizeInspectorSnowReport(resortData, resortKey, resortName, date) {
  const snow = resortData.SnowReport || {};
  const conditions = resortData.CurrentConditions || {};

  return {
    resort: resortKey,
    resortName: resortName,
    date: date,
    timestamp: new Date().toISOString(),
    operatingStatus: resortData.OperatingStatus || null,
    conditions: snow.Conditions || null,
    lastUpdated: snow.LastUpdated || null,
    snowfall: {
      overnight_inches: parseFloat(snow.OvernightSnowfall?.Inches) || 0,
      overnight_cm: parseFloat(snow.OvernightSnowfall?.Centimeters) || 0,
      '24hour_inches': parseFloat(snow.Last24Hours?.Inches) || 0,
      '24hour_cm': parseFloat(snow.Last24Hours?.Centimeters) || 0,
      '48hour_inches': parseFloat(snow.Last48Hours?.Inches) || 0,
      '48hour_cm': parseFloat(snow.Last48Hours?.Centimeters) || 0,
      '7day_inches': parseFloat(snow.Last7Days?.Inches) || 0,
      '7day_cm': parseFloat(snow.Last7Days?.Centimeters) || 0,
      season_total_inches: parseFloat(snow.SeasonTotal?.Inches) || 0,
      season_total_cm: parseFloat(snow.SeasonTotal?.Centimeters) || 0,
    },
    baseDepth: {
      inches: parseFloat(snow.BaseDepth?.Inches) || 0,
      cm: parseFloat(snow.BaseDepth?.Centimeters) || 0,
    },
    currentConditions: conditions.Base ? {
      base: {
        temperature_f: conditions.Base?.TemperatureFahrenheit || null,
        temperature_c: conditions.Base?.TemperatureCelsius || null,
        skies: conditions.Base?.Skies || null,
        wind: conditions.Base?.Wind || null,
      }
    } : null,
  };
}

function saveIkonSnowData(resortKey, resortData) {
  const resort = RESORTS[resortKey];
  if (!resort) return null;

  const timezone = resort.timezone || 'America/Denver';
  const today = getResortLocalDate(timezone);

  const cleanData = normalizeInspectorSnowReport(
    resortData,
    resortKey,
    resort.name,
    today
  );

  if (!cleanData) return null;

  const snowData = {
    ...cleanData,
    provider: 'ikon',
    apiProvider: 'inspector',
  };

  const snowDir = path.join(CONFIG.dataDir, resortKey, 'snow');
  ensureDirectoryExists(snowDir);

  fs.writeFileSync(path.join(snowDir, `${today}.json`), JSON.stringify(snowData, null, 2));
  fs.writeFileSync(path.join(snowDir, 'latest.json'), JSON.stringify(snowData, null, 2));
  fs.appendFileSync(path.join(snowDir, `${today}.ndjson`), JSON.stringify(snowData) + '\n');

  return snowData;
}

async function runIkonSnowScraper() {
  console.log(`\n[IKON-SNOW] Starting run`);
  health.ikon.totalRuns++;
  health.ikon.lastRun = new Date().toISOString();

  try {
    const ikonResorts = config.resorts.filter(r =>
      r.provider === 'ikon' && isResortInSeason(r)
    );

    if (ikonResorts.length === 0) {
      console.log('[IKON-SNOW] No resorts in season');
      return;
    }

    console.log(`[IKON-SNOW] Found ${ikonResorts.length} in-season resorts`);

    const allData = await fetchInspectorData();
    let scraped = 0;

    for (const resort of ikonResorts) {
      const inspectorName = resort.inspectorName || resort.name;
      const resortData = allData.Resorts?.find(r => r.Name === inspectorName);

      if (resortData) {
        const saved = saveIkonSnowData(resort.key, resortData);
        if (saved) {
          scraped++;
          const snow24 = saved.snowfall['24hour_inches'];
          console.log(`[IKON-SNOW] ${resort.key}: ${snow24}" 24hr`);
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
// VAIL SNOW SCRAPER (Puppeteer) - Single persistent page
// ═══════════════════════════════════════════════════════════════════════════════

async function initBrowser() {
  if (browser) {
    try { await browser.close(); } catch (e) {}
    browser = null;
    page = null;
  }

  console.log('[VAIL-SNOW] Launching browser...');
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

  page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  console.log('[VAIL-SNOW] Browser ready');
}

async function scrapeVailSnowReport(resortKey, url) {
  const resort = RESORTS[resortKey];
  const timezone = resort.timezone || 'America/Denver';
  const today = getResortLocalDate(timezone);

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(2000);

    await page.waitForFunction(
      () => typeof FR !== 'undefined' && FR.snowReportData,
      { timeout: 30000 }
    ).catch(() => {});

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

    const snow = data.snowReport;
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
        '24hour_inches': parseFloat(snow.TwentyFourHourSnowfall?.Inches) || 0,
        '24hour_cm': parseFloat(snow.TwentyFourHourSnowfall?.Centimeters) || 0,
        '48hour_inches': parseFloat(snow.FortyEightHourSnowfall?.Inches) || 0,
        '48hour_cm': parseFloat(snow.FortyEightHourSnowfall?.Centimeters) || 0,
        '7day_inches': parseFloat(snow.SevenDaySnowfall?.Inches) || 0,
        '7day_cm': parseFloat(snow.SevenDaySnowfall?.Centimeters) || 0,
        season_total_inches: parseFloat(snow.CurrentSeason?.Inches) || 0,
        season_total_cm: parseFloat(snow.CurrentSeason?.Centimeters) || 0
      },
      baseDepth: {
        inches: parseFloat(snow.BaseDepth?.Inches) || 0,
        cm: parseFloat(snow.BaseDepth?.Centimeters) || 0
      }
    };

    const snowDir = path.join(CONFIG.dataDir, resortKey, 'snow');
    ensureDirectoryExists(snowDir);

    fs.writeFileSync(path.join(snowDir, `${today}.json`), JSON.stringify(cleanData, null, 2));
    fs.writeFileSync(path.join(snowDir, 'latest.json'), JSON.stringify(cleanData, null, 2));
    fs.appendFileSync(path.join(snowDir, `${today}.ndjson`), JSON.stringify(cleanData) + '\n');

    return cleanData;

  } catch (error) {
    console.error(`[VAIL-SNOW] ${resortKey}: ${error.message}`);
    return null;
  }
}

async function runVailSnowScraper() {
  console.log(`\n[VAIL-SNOW] Starting run`);
  health.vail.totalRuns++;
  health.vail.lastRun = new Date().toISOString();

  try {
    // Ensure browser is alive
    if (!browser || !page) {
      await initBrowser();
    } else {
      try {
        await browser.version();
      } catch (e) {
        console.log('[VAIL-SNOW] Browser died, restarting...');
        await initBrowser();
      }
    }

    // Get in-season Vail resorts with snow report URLs
    const vailResorts = config.resorts.filter(r =>
      (!r.provider || r.provider === 'vail') &&
      isResortInSeason(r) &&
      r.snowReportUrl
    );

    if (vailResorts.length === 0) {
      // Check if any resorts are in season at all
      const anyInSeason = config.resorts.some(r =>
        (!r.provider || r.provider === 'vail') && isResortInSeason(r)
      );

      if (!anyInSeason && browser) {
        console.log('[VAIL-SNOW] No resorts in season - closing browser to save memory');
        try { await browser.close(); } catch (e) {}
        browser = null;
        page = null;
      }

      console.log('[VAIL-SNOW] No resorts with snow URLs in season');
      return;
    }

    console.log(`[VAIL-SNOW] Found ${vailResorts.length} in-season resorts`);

    let scraped = 0;

    for (const resort of vailResorts) {
      const data = await scrapeVailSnowReport(resort.key, resort.snowReportUrl);
      if (data) {
        scraped++;
        console.log(`[VAIL-SNOW] ${resort.key}: ${data.snowfall['24hour_inches']}" 24hr`);
      }
      await sleep(CONFIG.vail.delayBetweenResorts);
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

process.on('SIGTERM', async () => {
  console.log('\n[SNOW] Termination signal received...');
  isShuttingDown = true;
  if (browser) await browser.close();
  process.exit(0);
});

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║     Snow Report Scraper - Hetzner Persistent Mode                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Ikon interval: ${CONFIG.ikon.intervalMs / 1000 / 60} min`);
  console.log(`Vail interval: ${CONFIG.vail.intervalMs / 1000 / 60} min`);
  console.log(`Data directory: ${CONFIG.dataDir}`);

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

    // Check if it's time for Vail (offset slightly)
    if (now - lastVailRun >= CONFIG.vail.intervalMs) {
      lastVailRun = now;
      // Slight delay so they don't run simultaneously
      setTimeout(() => runVailSnowScraper().catch(console.error), 60000);
    }

    await sleep(10000);
  }
}

main();
