// snow-scraper-persistent.js - Continuous snow report scraper for Hetzner
// Runs both Ikon (HTTP API) and Vail (Puppeteer) snow scrapers
// Uses a single persistent page for efficiency

const puppeteer = require('puppeteer');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { formatInTimeZone } = require('date-fns-tz');
const canadianBig3 = require('../lib/providers/canadian-big3');
const aspensnowmass = require('../lib/providers/aspensnowmass');
const reportpal = require('../lib/providers/reportpal');
const zaneray = require('../lib/providers/zaneray');
const snocountry = require('../lib/providers/snocountry');
const dataNormalization = require('../lib/data-normalization');

// Configuration
const CONFIG = {
  ikon: {
    intervalMs: 60 * 60 * 1000,    // 60 minutes (hourly)
    jitterMs: 30000,               // 0-30 seconds random jitter
  },
  vail: {
    intervalMs: 60 * 60 * 1000,    // 60 minutes (hourly)
    jitterMs: 60000,               // 0-60 seconds random jitter
    delayBetweenResorts: 5000,     // 5 seconds between resorts
  },
  canadianBig3: {
    intervalMs: 60 * 60 * 1000,    // 60 minutes (hourly)
    jitterMs: 30000,               // 0-30 seconds random jitter
  },
  aspen: {
    intervalMs: 60 * 60 * 1000,    // 60 minutes (hourly)
    jitterMs: 30000,               // 0-30 seconds random jitter
  },
  reportpal: {
    intervalMs: 60 * 60 * 1000,    // 60 minutes (hourly)
    jitterMs: 30000,               // 0-30 seconds random jitter
  },
  zaneray: {
    intervalMs: 60 * 60 * 1000,    // 60 minutes (hourly)
    jitterMs: 30000,               // 0-30 seconds random jitter
  },
  snocountry: {
    intervalMs: 60 * 60 * 1000,    // 60 minutes (hourly)
    jitterMs: 30000,               // 0-30 seconds random jitter
  },
  dataDir: path.join(__dirname, '..', 'data'),
  configPath: path.join(__dirname, '..', 'config.json'),
};

// Load resort configuration
console.log(`[CONFIG] Loading config from: ${CONFIG.configPath}`);
let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG.configPath, 'utf8'));
} catch (error) {
  console.error('Failed to load config.json:', error.message);
  process.exit(1);
}
console.log(`[CONFIG] Loaded ${config.resorts.length} resorts`);

// Validate expected providers exist (catch config loading issues early)
const expectedProviders = ['aspensnowmass', 'canadian-big3', 'reportpal', 'zaneray'];
for (const provider of expectedProviders) {
  const count = config.resorts.filter(r => r.apiProvider === provider).length;
  if (count === 0) {
    console.warn(`[CONFIG] WARNING: No resorts found with apiProvider '${provider}' - check config path!`);
  }
}

// Also check for snocountry via snowApiProvider
const snocountryCount = config.resorts.filter(r => r.snowApiProvider === 'snocountry').length;
if (snocountryCount === 0) {
  console.warn(`[CONFIG] WARNING: No resorts found with snowApiProvider 'snocountry' - check config path!`);
} else {
  console.log(`[CONFIG] Found ${snocountryCount} resorts with snowApiProvider 'snocountry'`);
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
  canadianBig3: { totalRuns: 0, successfulRuns: 0, consecutiveFailures: 0, lastRun: null, lastSuccess: null, resortsScraped: 0 },
  aspen: { totalRuns: 0, successfulRuns: 0, consecutiveFailures: 0, lastRun: null, lastSuccess: null, resortsScraped: 0 },
  reportpal: { totalRuns: 0, successfulRuns: 0, consecutiveFailures: 0, lastRun: null, lastSuccess: null, resortsScraped: 0 },
  zaneray: { totalRuns: 0, successfulRuns: 0, consecutiveFailures: 0, lastRun: null, lastSuccess: null, resortsScraped: 0 },
  snocountry: { totalRuns: 0, successfulRuns: 0, consecutiveFailures: 0, lastRun: null, lastSuccess: null, resortsScraped: 0 },
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
    // Filter Ikon resorts, excluding those with custom apiProviders (like canadian-big3)
    const ikonResorts = config.resorts.filter(r =>
      r.provider === 'ikon' && !r.apiProvider && isResortInSeason(r)
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
    // Use domcontentloaded instead of networkidle2 - flagship sites (vail.com, beavercreek.com)
    // have heavy analytics that prevent networkidle2 from ever completing
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000); // Give extra time for JS to execute

    await page.waitForFunction(
      () => typeof FR !== 'undefined' && FR.snowReportData,
      { timeout: 45000 } // Increased timeout for data loading
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
// CANADIAN BIG3 SNOW SCRAPER (HTTP - Lake Louise, Sunshine Village, Mt Norquay)
// ═══════════════════════════════════════════════════════════════════════════════

async function saveCanadianBig3SnowData(resortKey, data) {
  const resort = RESORTS[resortKey];
  if (!resort) return null;

  const timezone = resort.timezone || 'America/Edmonton';
  const today = getResortLocalDate(timezone);

  // Convert to snow report format
  const snowReport = canadianBig3.toSnowReport(data, resortKey, resort.name, today);

  // Ensure directory exists
  const snowDir = path.join(CONFIG.dataDir, resortKey, 'snow');
  ensureDirectoryExists(snowDir);

  // Save timestamped file
  const timestampedFile = path.join(snowDir, `${today}.json`);
  fs.writeFileSync(timestampedFile, JSON.stringify(snowReport, null, 2));

  // Save as latest.json
  const latestFile = path.join(snowDir, 'latest.json');
  fs.writeFileSync(latestFile, JSON.stringify(snowReport, null, 2));

  // Update NDJSON file for the day
  const ndjsonFile = path.join(snowDir, `${today}.ndjson`);
  const ndjsonEntry = JSON.stringify({
    ...snowReport,
    timestamp: new Date().toISOString(),
  });
  fs.appendFileSync(ndjsonFile, ndjsonEntry + '\n');

  return snowReport;
}

async function runCanadianBig3SnowScraper() {
  console.log(`\n[CANADIAN-BIG3-SNOW] Starting scrape...`);
  health.canadianBig3.lastRun = new Date().toISOString();
  health.canadianBig3.totalRuns++;

  try {
    // Add jitter
    const jitter = Math.random() * CONFIG.canadianBig3.jitterMs;
    await sleep(jitter);

    // Get in-season Canadian Big3 resorts
    const big3Resorts = config.resorts.filter(r =>
      r.apiProvider === 'canadian-big3' &&
      isResortInSeason(r)
    );

    if (big3Resorts.length === 0) {
      console.log('[CANADIAN-BIG3-SNOW] No Canadian Big3 resorts in season');
      return;
    }

    console.log(`[CANADIAN-BIG3-SNOW] Found ${big3Resorts.length} in-season resorts`);

    // Use shared browser for Puppeteer-based scraping (Banff/Norquay need it for snow data)
    if (!browser) await initBrowser();

    let scraped = 0;

    for (const resort of big3Resorts) {
      try {
        // Pass browser to enable Puppeteer scraping for Banff/Norquay snow data
        const data = await canadianBig3.scrapeResort(resort.key, browser);

        if (data) {
          const saved = await saveCanadianBig3SnowData(resort.key, data);
          if (saved) {
            scraped++;
            const snow24 = data.snow?.snow24_cm || 0;
            const base = data.snow?.base_upper_cm || data.snow?.base_lower_cm || 0;
            console.log(`[CANADIAN-BIG3-SNOW] ${resort.key}: ${snow24}cm 24hr, ${base}cm base`);
          }
        }
      } catch (e) {
        console.error(`[CANADIAN-BIG3-SNOW] ${resort.key}: ${e.message}`);
      }
    }

    health.canadianBig3.resortsScraped = scraped;
    health.canadianBig3.successfulRuns++;
    health.canadianBig3.consecutiveFailures = 0;
    health.canadianBig3.lastSuccess = new Date().toISOString();
    console.log(`[CANADIAN-BIG3-SNOW] Completed: ${scraped}/${big3Resorts.length} resorts`);

  } catch (error) {
    console.error(`[CANADIAN-BIG3-SNOW] Error: ${error.message}`);
    health.canadianBig3.consecutiveFailures++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASPEN SNOWMASS SNOW SCRAPER (HTTP - Aspen Mountain, Aspen Highlands, Buttermilk)
// ═══════════════════════════════════════════════════════════════════════════════

function normalizeAspenSnowReport(snowReport, resortKey, resortName, localDate) {
  if (!snowReport) return null;

  const toNumber = (value) => {
    if (value === '' || value === '--' || value === null || value === undefined) return null;
    const num = parseFloat(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? num : null;
  };

  const pickNumber = (...values) => {
    for (const value of values) {
      const num = toNumber(value);
      if (num !== null) return num;
    }
    return 0;
  };

  const snow24_in = pickNumber(snowReport.snow24Hours?.inches);
  const snow24_cm = toNumber(snowReport.snow24Hours?.centimeters);
  const snow48_in = pickNumber(snowReport.snow48Hours?.inches);
  const snow48_cm = toNumber(snowReport.snow48Hours?.centimeters);
  const snow7d_in = pickNumber(snowReport.snow7Days?.inches);
  const snow7d_cm = toNumber(snowReport.snow7Days?.centimeters);
  const base_in = pickNumber(snowReport.snowBase?.inches);
  const base_cm = toNumber(snowReport.snowBase?.centimeters);

  return {
    resort: resortKey,
    resortName: resortName,
    date: localDate,
    timestamp: new Date().toISOString(),
    lastUpdated: snowReport.lastUpdated || null,
    conditions: snowReport.status || null,
    operatingStatus: snowReport.status || null,
    provider: 'ikon',
    apiProvider: 'aspensnowmass',
    snowfall: {
      overnight_inches: 0,
      overnight_cm: 0,
      '24hour_inches': snow24_in,
      '24hour_cm': snow24_cm !== null ? snow24_cm : Math.round(snow24_in * 2.54),
      '48hour_inches': snow48_in,
      '48hour_cm': snow48_cm !== null ? snow48_cm : Math.round(snow48_in * 2.54),
      '7day_inches': snow7d_in,
      '7day_cm': snow7d_cm !== null ? snow7d_cm : Math.round(snow7d_in * 2.54),
      season_total_inches: 0,
      season_total_cm: 0
    },
    baseDepth: {
      inches: base_in,
      cm: base_cm !== null ? base_cm : Math.round(base_in * 2.54),
    },
    terrain: {
      totalTrails: snowReport.trails?.totalCount || 0,
      openTrails: snowReport.trails?.openCount || 0,
      totalLifts: snowReport.lifts?.totalCount || 0,
      openLifts: snowReport.lifts?.openCount || 0,
    },
  };
}

async function saveAspenSnowData(resortKey, data) {
  const resort = RESORTS[resortKey];
  if (!resort) return null;

  const timezone = resort.timezone || 'America/Denver';
  const today = getResortLocalDate(timezone);

  // Normalize the snow report
  const snowReport = normalizeAspenSnowReport(data.snowReport, resortKey, resort.name, today);
  if (!snowReport) return null;

  // Ensure directory exists
  const snowDir = path.join(CONFIG.dataDir, resortKey, 'snow');
  ensureDirectoryExists(snowDir);

  // Save timestamped file
  fs.writeFileSync(path.join(snowDir, `${today}.json`), JSON.stringify(snowReport, null, 2));
  fs.writeFileSync(path.join(snowDir, 'latest.json'), JSON.stringify(snowReport, null, 2));
  fs.appendFileSync(path.join(snowDir, `${today}.ndjson`), JSON.stringify(snowReport) + '\n');

  return snowReport;
}

async function runAspenSnowScraper() {
  console.log(`\n[ASPEN-SNOW] Starting scrape...`);
  health.aspen.lastRun = new Date().toISOString();
  health.aspen.totalRuns++;

  try {
    // Add jitter
    const jitter = Math.random() * CONFIG.aspen.jitterMs;
    await sleep(jitter);

    // Get in-season Aspen resorts
    const aspenResorts = config.resorts.filter(r =>
      r.apiProvider === 'aspensnowmass' &&
      isResortInSeason(r)
    );

    if (aspenResorts.length === 0) {
      console.log('[ASPEN-SNOW] No Aspen resorts in season');
      return;
    }

    console.log(`[ASPEN-SNOW] Found ${aspenResorts.length} in-season resorts`);

    let scraped = 0;

    for (const resort of aspenResorts) {
      try {
        // Use the Aspen provider to fetch data
        const data = await aspensnowmass.fetch(resort);

        if (data && data.snowReport) {
          const saved = await saveAspenSnowData(resort.key, data);
          if (saved) {
            scraped++;
            const snow24 = saved.snowfall['24hour_inches'] || 0;
            const base = saved.baseDepth.inches || 0;
            console.log(`[ASPEN-SNOW] ${resort.key}: ${snow24}" 24hr, ${base}" base`);
          }
        }
      } catch (e) {
        console.error(`[ASPEN-SNOW] ${resort.key}: ${e.message}`);
      }
    }

    health.aspen.resortsScraped = scraped;
    health.aspen.successfulRuns++;
    health.aspen.consecutiveFailures = 0;
    health.aspen.lastSuccess = new Date().toISOString();
    console.log(`[ASPEN-SNOW] Completed: ${scraped}/${aspenResorts.length} resorts`);

  } catch (error) {
    console.error(`[ASPEN-SNOW] Error: ${error.message}`);
    health.aspen.consecutiveFailures++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTPAL SNOW SCRAPER (HTTP - Big Sky, Sugarloaf, Sunday River, Loon, Cypress)
// ═══════════════════════════════════════════════════════════════════════════════

async function saveReportPalSnowData(resortKey, data) {
  const resort = RESORTS[resortKey];
  if (!resort) return null;

  const timezone = resort.timezone || 'America/Denver';
  const today = getResortLocalDate(timezone);

  // Normalize using data-normalization module
  const snowReport = dataNormalization.normalizeReportPalSnowReport(data, resortKey, resort.name, today);
  if (!snowReport) return null;

  // Add provider info
  snowReport.provider = 'ikon';
  snowReport.apiProvider = 'reportpal';

  // Ensure directory exists
  const snowDir = path.join(CONFIG.dataDir, resortKey, 'snow');
  ensureDirectoryExists(snowDir);

  // Save files
  fs.writeFileSync(path.join(snowDir, `${today}.json`), JSON.stringify(snowReport, null, 2));
  fs.writeFileSync(path.join(snowDir, 'latest.json'), JSON.stringify(snowReport, null, 2));
  fs.appendFileSync(path.join(snowDir, `${today}.ndjson`), JSON.stringify(snowReport) + '\n');

  return snowReport;
}

async function runReportPalSnowScraper() {
  console.log(`\n[REPORTPAL-SNOW] Starting scrape...`);
  health.reportpal.lastRun = new Date().toISOString();
  health.reportpal.totalRuns++;

  try {
    // Add jitter
    const jitter = Math.random() * CONFIG.reportpal.jitterMs;
    await sleep(jitter);

    // Get in-season ReportPal resorts
    const reportpalResorts = config.resorts.filter(r =>
      r.apiProvider === 'reportpal' &&
      isResortInSeason(r)
    );

    if (reportpalResorts.length === 0) {
      console.log('[REPORTPAL-SNOW] No ReportPal resorts in season');
      return;
    }

    console.log(`[REPORTPAL-SNOW] Found ${reportpalResorts.length} in-season resorts`);

    let scraped = 0;

    for (const resort of reportpalResorts) {
      try {
        const data = await reportpal.fetch(resort);

        if (data) {
          const saved = await saveReportPalSnowData(resort.key, data);
          if (saved) {
            scraped++;
            const snow24 = saved.snowfall['24hour_inches'] || 0;
            const base = saved.baseDepth.inches || 0;
            console.log(`[REPORTPAL-SNOW] ${resort.key}: ${snow24}" 24hr, ${base}" base`);
          }
        }
      } catch (e) {
        console.error(`[REPORTPAL-SNOW] ${resort.key}: ${e.message}`);
      }
    }

    health.reportpal.resortsScraped = scraped;
    health.reportpal.successfulRuns++;
    health.reportpal.consecutiveFailures = 0;
    health.reportpal.lastSuccess = new Date().toISOString();
    console.log(`[REPORTPAL-SNOW] Completed: ${scraped}/${reportpalResorts.length} resorts`);

  } catch (error) {
    console.error(`[REPORTPAL-SNOW] Error: ${error.message}`);
    health.reportpal.consecutiveFailures++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZANERAY SNOW SCRAPER (HTTP - Jackson Hole)
// ═══════════════════════════════════════════════════════════════════════════════

async function saveZaneraySnowData(resortKey, data) {
  const resort = RESORTS[resortKey];
  if (!resort) return null;

  const timezone = resort.timezone || 'America/Denver';
  const today = getResortLocalDate(timezone);

  // Normalize using data-normalization module
  const snowReport = dataNormalization.normalizeZaneraySnowReport(data, resortKey, resort.name, today);
  if (!snowReport) return null;

  // Add provider info
  snowReport.provider = 'ikon';
  snowReport.apiProvider = 'zaneray';

  // Ensure directory exists
  const snowDir = path.join(CONFIG.dataDir, resortKey, 'snow');
  ensureDirectoryExists(snowDir);

  // Save files
  fs.writeFileSync(path.join(snowDir, `${today}.json`), JSON.stringify(snowReport, null, 2));
  fs.writeFileSync(path.join(snowDir, 'latest.json'), JSON.stringify(snowReport, null, 2));
  fs.appendFileSync(path.join(snowDir, `${today}.ndjson`), JSON.stringify(snowReport) + '\n');

  return snowReport;
}

async function runZaneraySnowScraper() {
  console.log(`\n[ZANERAY-SNOW] Starting scrape...`);
  health.zaneray.lastRun = new Date().toISOString();
  health.zaneray.totalRuns++;

  try {
    // Add jitter
    const jitter = Math.random() * CONFIG.zaneray.jitterMs;
    await sleep(jitter);

    // Get in-season Zaneray resorts
    const zanerayResorts = config.resorts.filter(r =>
      r.apiProvider === 'zaneray' &&
      isResortInSeason(r)
    );

    if (zanerayResorts.length === 0) {
      console.log('[ZANERAY-SNOW] No Zaneray resorts in season');
      return;
    }

    console.log(`[ZANERAY-SNOW] Found ${zanerayResorts.length} in-season resorts`);

    let scraped = 0;

    for (const resort of zanerayResorts) {
      try {
        const data = await zaneray.fetch(resort);

        if (data) {
          const saved = await saveZaneraySnowData(resort.key, data);
          if (saved) {
            scraped++;
            const snow24 = saved.snowfall['24hour_inches'] || 0;
            const base = saved.baseDepth.inches || 0;
            console.log(`[ZANERAY-SNOW] ${resort.key}: ${snow24}" 24hr, ${base}" base`);
          }
        }
      } catch (e) {
        console.error(`[ZANERAY-SNOW] ${resort.key}: ${e.message}`);
      }
    }

    health.zaneray.resortsScraped = scraped;
    health.zaneray.successfulRuns++;
    health.zaneray.consecutiveFailures = 0;
    health.zaneray.lastSuccess = new Date().toISOString();
    console.log(`[ZANERAY-SNOW] Completed: ${scraped}/${zanerayResorts.length} resorts`);

  } catch (error) {
    console.error(`[ZANERAY-SNOW] Error: ${error.message}`);
    health.zaneray.consecutiveFailures++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SNOCOUNTRY SNOW SCRAPER (HTTP - Killington, Copper via snowApiProvider)
// ═══════════════════════════════════════════════════════════════════════════════

async function saveSnoCountrySnowData(resortKey, data) {
  const resort = RESORTS[resortKey];
  if (!resort) return null;

  const timezone = resort.timezone || 'America/Denver';
  const today = getResortLocalDate(timezone);

  // Normalize using data-normalization module
  const snowReport = dataNormalization.normalizeSnoCountrySnowReport(data, resortKey, resort.name, today);
  if (!snowReport) return null;

  // Add provider info
  snowReport.provider = 'ikon';
  snowReport.apiProvider = 'snocountry';

  // Ensure directory exists
  const snowDir = path.join(CONFIG.dataDir, resortKey, 'snow');
  ensureDirectoryExists(snowDir);

  // Save files
  fs.writeFileSync(path.join(snowDir, `${today}.json`), JSON.stringify(snowReport, null, 2));
  fs.writeFileSync(path.join(snowDir, 'latest.json'), JSON.stringify(snowReport, null, 2));
  fs.appendFileSync(path.join(snowDir, `${today}.ndjson`), JSON.stringify(snowReport) + '\n');

  return snowReport;
}

async function runSnoCountrySnowScraper() {
  console.log(`\n[SNOCOUNTRY-SNOW] Starting scrape...`);
  health.snocountry.lastRun = new Date().toISOString();
  health.snocountry.totalRuns++;

  try {
    // Add jitter
    const jitter = Math.random() * CONFIG.snocountry.jitterMs;
    await sleep(jitter);

    // Get in-season resorts with snowApiProvider = snocountry
    const snocountryResorts = config.resorts.filter(r =>
      r.snowApiProvider === 'snocountry' &&
      isResortInSeason(r)
    );

    if (snocountryResorts.length === 0) {
      console.log('[SNOCOUNTRY-SNOW] No SnoCountry resorts in season');
      return;
    }

    console.log(`[SNOCOUNTRY-SNOW] Found ${snocountryResorts.length} in-season resorts`);

    let scraped = 0;

    for (const resort of snocountryResorts) {
      try {
        const data = await snocountry.fetch(resort);

        if (data) {
          const saved = await saveSnoCountrySnowData(resort.key, data);
          if (saved) {
            scraped++;
            const snow24 = saved.snowfall['24hour_inches'] || 0;
            const base = saved.baseDepth.inches || 0;
            console.log(`[SNOCOUNTRY-SNOW] ${resort.key}: ${snow24}" 24hr, ${base}" base`);
          }
        }
      } catch (e) {
        console.error(`[SNOCOUNTRY-SNOW] ${resort.key}: ${e.message}`);
      }
    }

    health.snocountry.resortsScraped = scraped;
    health.snocountry.successfulRuns++;
    health.snocountry.consecutiveFailures = 0;
    health.snocountry.lastSuccess = new Date().toISOString();
    console.log(`[SNOCOUNTRY-SNOW] Completed: ${scraped}/${snocountryResorts.length} resorts`);

  } catch (error) {
    console.error(`[SNOCOUNTRY-SNOW] Error: ${error.message}`);
    health.snocountry.consecutiveFailures++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH FILE
// ═══════════════════════════════════════════════════════════════════════════════

const HEALTH_FILE = path.join(__dirname, 'snow-health.json');

function writeHealthFile() {
  const allProvidersHealthy =
    health.ikon.consecutiveFailures < 3 &&
    health.vail.consecutiveFailures < 3 &&
    health.canadianBig3.consecutiveFailures < 3 &&
    health.aspen.consecutiveFailures < 3 &&
    health.reportpal.consecutiveFailures < 3 &&
    health.zaneray.consecutiveFailures < 3 &&
    health.snocountry.consecutiveFailures < 3;

  const healthData = {
    scraper: 'snow',
    status: allProvidersHealthy ? 'ok' : 'degraded',
    uptime: Math.round((Date.now() - health.startTime) / 1000),
    ikon: health.ikon,
    vail: health.vail,
    canadianBig3: health.canadianBig3,
    aspen: health.aspen,
    reportpal: health.reportpal,
    zaneray: health.zaneray,
    snocountry: health.snocountry,
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
  console.log(`Canadian Big3 interval: ${CONFIG.canadianBig3.intervalMs / 1000 / 60} min`);
  console.log(`Aspen interval: ${CONFIG.aspen.intervalMs / 1000 / 60} min`);
  console.log(`ReportPal interval: ${CONFIG.reportpal.intervalMs / 1000 / 60} min`);
  console.log(`Zaneray interval: ${CONFIG.zaneray.intervalMs / 1000 / 60} min`);
  console.log(`SnoCountry interval: ${CONFIG.snocountry.intervalMs / 1000 / 60} min`);
  console.log(`Data directory: ${CONFIG.dataDir}`);

  // Track last run times - set to 0 to trigger immediate first runs
  let lastIkonRun = 0;
  let lastVailRun = 0;
  let lastCanadianBig3Run = 0;
  let lastAspenRun = 0;
  let lastReportPalRun = 0;
  let lastZanerayRun = 0;
  let lastSnoCountryRun = 0;

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

    // Check if it's time for Canadian Big3 (offset from Vail)
    if (now - lastCanadianBig3Run >= CONFIG.canadianBig3.intervalMs) {
      lastCanadianBig3Run = now;
      // Slight delay so they don't run simultaneously
      setTimeout(() => runCanadianBig3SnowScraper().catch(console.error), 90000);
    }

    // Check if it's time for Aspen (offset from others)
    if (now - lastAspenRun >= CONFIG.aspen.intervalMs) {
      lastAspenRun = now;
      // Slight delay so they don't run simultaneously
      setTimeout(() => runAspenSnowScraper().catch(console.error), 120000);
    }

    // Check if it's time for ReportPal (offset from others)
    if (now - lastReportPalRun >= CONFIG.reportpal.intervalMs) {
      lastReportPalRun = now;
      setTimeout(() => runReportPalSnowScraper().catch(console.error), 150000);
    }

    // Check if it's time for Zaneray (offset from others)
    if (now - lastZanerayRun >= CONFIG.zaneray.intervalMs) {
      lastZanerayRun = now;
      setTimeout(() => runZaneraySnowScraper().catch(console.error), 180000);
    }

    // Check if it's time for SnoCountry (offset from others)
    if (now - lastSnoCountryRun >= CONFIG.snocountry.intervalMs) {
      lastSnoCountryRun = now;
      setTimeout(() => runSnoCountrySnowScraper().catch(console.error), 210000);
    }

    await sleep(10000);
  }
}

main();
