// lift-scraper-persistent.js - Continuous lift wait-time tracker for Hetzner
// Runs both Ikon (HTTP API) and Vail (Puppeteer) scrapers with separate timing
// Keeps browser warm between runs for better performance

const puppeteer = require('puppeteer');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { formatInTimeZone } = require('date-fns-tz');

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION - Edit these arrays to scale up/down
// ═══════════════════════════════════════════════════════════════════════════════
//
// TO ADD MORE RESORTS: Just add resort keys to the arrays below
// TO ADD MORE PROVIDERS: Add provider name to enabledProviders array
//
// Available Ikon providers: 'inspector', 'aspensnowmass', 'reportpal', 'zaneray', 'dor'
// Available Vail resorts: see config.json for full list
//
const CONFIG = {
  ikon: {
    intervalMs: 120 * 1000,     // 2 minutes
    jitterMs: 10000,            // 0-10 seconds random jitter

    // ┌─────────────────────────────────────────────────────────────────────────┐
    // │ IKON PROVIDERS TO SCRAPE - Add more as stability improves              │
    // │ Options: 'inspector', 'aspensnowmass', 'reportpal', 'zaneray', 'dor'   │
    // └─────────────────────────────────────────────────────────────────────────┘
    enabledProviders: [
      'aspensnowmass',   // Aspen (3 mountains) - status only, no wait times
      'inspector',       // Ikon Inspector API (15 resorts) - HAS WAIT TIMES!
      'reportpal',       // Big Sky, Sugarloaf, Sunday River, Loon, Cypress - HAS WAIT TIMES!
      'dor',             // Snowbird, Copper, Killington - HAS WAIT TIMES!
      // 'zaneray',      // Jackson Hole - status only, no wait times
    ],
  },

  vail: {
    // ┌─────────────────────────────────────────────────────────────────────────┐
    // │ VAIL RESORTS TO SCRAPE - Add more as stability improves                │
    // │ These use Puppeteer (browser) so they're more resource-intensive       │
    // └─────────────────────────────────────────────────────────────────────────┘
    enabledResorts: [
      'vail',
      'beavercreek',
      'breckenridge',
      'crestedbutte',
      'laurelmountain',
      'aftonalps',
      'bigboulder',
      'bostonmills',
      'brandywine',
      'hiddenvalley',
      'alpinevalley',
      'crotched',
      'attitash',
      'hunter',
      // Add more here as needed:
      // 'parkcity', 'stowe', 'keystone', 'whistlerblackcomb',
      // 'northstar', 'heavenly', 'kirkwood', 'stevenspass',
    ],

    // Operating hours - when to scrape (local resort time)
    // Lifts typically open 8:30-9:00 AM, so start 30 min before earliest opening
    scrapingStartHour: 8,   // Start scraping at 8:00 AM local time
    scrapingEndHour: 17,     // Stop scraping at 5:00 PM local time

    // Page pool size - each page uses ~50-100MB RAM
    // Using 1 page to minimize memory (resorts are scraped sequentially anyway)
    pagePoolSize: 1,

    // How often to scrape (in ms)
    cycleIntervalMs: 180 * 1000,  // 3 minutes

    // Delay between launching each scrape (gentler on servers)
    delayBetweenScrapes: 500,     // 500ms

    // Timeouts (increase if getting timeout errors)
    navigationTimeout: 45000,    // 45s to load page
    dataWaitTimeout: 30000,      // 30s to wait for FR.TerrainStatusFeed

    // Failure handling
    failureCooldownMs: 10 * 60 * 1000,  // Skip failing resorts for 10 minutes
    maxConsecutiveFailures: 4,          // After 4 failures, apply cooldown
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

// Simple failure counter for current cycle — exit process on repeated failures
let cycleFailures = 0;

// Chrome memory management
// With --single-process, Chrome accumulates memory across page navigations.
// dmesg showed Chrome growing to 3-4GB RSS before kernel OOM-killed it.
// Fix: close browser after each Vail cycle so Chrome never runs long enough to balloon.
const MAX_VAIL_CYCLES = 20; // Force full process restart after this many cycles
const MIN_AVAILABLE_MEMORY_MB = 256; // Exit if system memory drops below this
let vailCycleCount = 0;

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
  // Dead hours: outside of configured scraping window
  // Default: 5 PM (17:00) to 8 AM - no lifts open during these times
  // Lifts typically open 8:30-9:00 AM, so we start 30min before earliest opening
  const startHour = CONFIG.vail.scrapingStartHour || 8;
  const endHour = CONFIG.vail.scrapingEndHour || 17;
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
// IKON SCRAPER (HTTP API)
// ═══════════════════════════════════════════════════════════════════════════════

function fetchInspectorData() {
  return new Promise((resolve, reject) => {
    const url = `${INSPECTOR_API_URL}?bearer_token=${BEARER_TOKEN}`;

    const req = https.get(url, (res) => {
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
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Inspector API timeout after 30s')));
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
    const req = https.get(url, (res) => {
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
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Aspen API timeout after 30s')));
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

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTPAL SCRAPER (Big Sky, Sugarloaf, Sunday River, Loon, Cypress)
// ═══════════════════════════════════════════════════════════════════════════════

function fetchReportPalData(resort) {
  return new Promise((resolve, reject) => {
    const { baseUrl, resortCode } = resort.apiConfig;
    const url = `${baseUrl}/api/reportpal?resortName=${resortCode}&useReportPal=true`;

    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SkiRunScraper/1.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Failed to parse ReportPal JSON: ${error.message}`));
          }
        } else {
          reject(new Error(`ReportPal HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`ReportPal request failed: ${error.message}`));
    });
    req.setTimeout(30000, () => req.destroy(new Error('ReportPal API timeout after 30s')));

    req.end();
  });
}

async function runReportPalScraper() {
  const reportpalResorts = config.resorts.filter(r =>
    r.provider === 'ikon' &&
    r.apiProvider === 'reportpal' &&
    isResortInSeason(r)
  );

  if (reportpalResorts.length === 0) return;

  const timestamp = new Date().toISOString();
  let totalLifts = 0;

  for (const resort of reportpalResorts) {
    if (isInDeadHours(resort.timezone)) continue;

    if (!resort.apiConfig?.baseUrl || !resort.apiConfig?.resortCode) continue;

    try {
      const reportpalData = await fetchReportPalData(resort);

      const localDate = getResortLocalDate(resort.timezone);
      const localTime = getResortLocalTime(resort.timezone);
      const liftsDir = path.join(CONFIG.dataDir, resort.key, 'lifts');
      ensureDirectoryExists(liftsDir);

      const outputFile = path.join(liftsDir, `${localDate}.ndjson`);
      const records = [];

      // Extract lifts from all areas
      if (reportpalData.facilities?.areas?.area) {
        const areas = reportpalData.facilities.areas.area;
        for (const area of areas) {
          if (area.lifts?.lift) {
            for (const lift of area.lifts.lift) {
              let status = lift.status;
              if (status === 'On Hold') status = 'Hold';

              records.push({
                timestamp,
                localTime,
                resort: resort.key,
                liftId: `reportpal:${lift.id}`,
                name: lift.name,
                status: status,
                type: formatLiftType(lift.type),
                waitMinutes: lift.skierWaitTime != null ? parseInt(lift.skierWaitTime) : null,
                openTime: lift.openTime || null,
                closeTime: lift.closeTime || null,
                mountain: area.name,
                capacity: lift.capacity || null,
              });
            }
          }
        }
      }

      if (records.length > 0) {
        fs.appendFileSync(outputFile, records.map(r => JSON.stringify(r)).join('\n') + '\n');
        totalLifts += records.length;
        console.log(`[REPORTPAL] ${resort.key}: ${records.length} lifts`);
      }
    } catch (error) {
      console.error(`[REPORTPAL] ${resort.key}: ${error.message}`);
    }
  }

  if (totalLifts > 0) {
    console.log(`[REPORTPAL] Total: ${totalLifts} lift records`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZANERAY SCRAPER (Jackson Hole)
// ═══════════════════════════════════════════════════════════════════════════════

function fetchZanerayData(resort) {
  return new Promise((resolve, reject) => {
    const { apiUrl } = resort.apiConfig;

    const urlObj = new URL(apiUrl);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SkiRunScraper/1.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Failed to parse Zaneray JSON: ${error.message}`));
          }
        } else {
          reject(new Error(`Zaneray HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Zaneray request failed: ${error.message}`));
    });
    req.setTimeout(30000, () => req.destroy(new Error('Zaneray API timeout after 30s')));

    req.end();
  });
}

function normalizeZanerayStatus(status) {
  if (!status) return 'Closed';
  const upperStatus = status.toUpperCase();
  if (upperStatus === 'OPEN') return 'Open';
  if (upperStatus === 'CLOSED') return 'Closed';
  if (upperStatus === 'HOLD' || upperStatus === 'ON_HOLD') return 'Hold';
  if (upperStatus === 'SCHEDULED') return 'Scheduled';
  if (upperStatus.includes('WIND')) return 'Windhold';
  return status;
}

function normalizeZanerayLiftType(type) {
  if (!type) return null;
  const upperType = type.toUpperCase();
  if (upperType.includes('GONDOLA')) return 'Gondola';
  if (upperType.includes('TRAM')) return 'Tram';
  if (upperType.includes('CHAIRLIFT') || upperType.includes('QUAD') || upperType.includes('TRIPLE') || upperType.includes('DOUBLE')) return 'Chair';
  if (upperType.includes('SURFACE') || upperType.includes('T-BAR') || upperType.includes('PLATTER')) return 'Surface';
  if (upperType.includes('CARPET') || upperType.includes('CONVEYOR')) return 'Carpet';
  return 'Chair';
}

async function runZanerayScraper() {
  const zanerayResorts = config.resorts.filter(r =>
    r.provider === 'ikon' &&
    r.apiProvider === 'zaneray' &&
    isResortInSeason(r)
  );

  if (zanerayResorts.length === 0) return;

  const timestamp = new Date().toISOString();
  let totalLifts = 0;

  for (const resort of zanerayResorts) {
    if (isInDeadHours(resort.timezone)) continue;

    if (!resort.apiConfig?.apiUrl) continue;

    try {
      const zanerayData = await fetchZanerayData(resort);

      const localDate = getResortLocalDate(resort.timezone);
      const localTime = getResortLocalTime(resort.timezone);
      const liftsDir = path.join(CONFIG.dataDir, resort.key, 'lifts');
      ensureDirectoryExists(liftsDir);

      const outputFile = path.join(liftsDir, `${localDate}.ndjson`);
      const records = [];

      if (zanerayData.lifts && typeof zanerayData.lifts === 'object') {
        for (const [liftKey, lift] of Object.entries(zanerayData.lifts)) {
          const status = normalizeZanerayStatus(lift.openingStatus);

          records.push({
            timestamp,
            localTime,
            resort: resort.key,
            liftId: `zaneray:${lift.id || liftKey}`,
            name: lift.name,
            status: status,
            type: normalizeZanerayLiftType(lift.liftType),
            waitMinutes: null,
            openTime: null,
            closeTime: null,
            mountain: null,
            departureAltitude: lift.departureAltitude?.value || null,
            arrivalAltitude: lift.arrivalAltitude?.value || null,
          });
        }
      }

      if (records.length > 0) {
        fs.appendFileSync(outputFile, records.map(r => JSON.stringify(r)).join('\n') + '\n');
        totalLifts += records.length;
        console.log(`[ZANERAY] ${resort.key}: ${records.length} lifts`);
      }
    } catch (error) {
      console.error(`[ZANERAY] ${resort.key}: ${error.message}`);
    }
  }

  if (totalLifts > 0) {
    console.log(`[ZANERAY] Total: ${totalLifts} lift records`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOR SCRAPER (Snowbird, Copper, Killington)
// ═══════════════════════════════════════════════════════════════════════════════

function fetchDorData(resort) {
  return new Promise((resolve, reject) => {
    const { baseUrl, endpoint } = resort.apiConfig;
    const url = `${baseUrl}${endpoint}`;

    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SkiRunScraper/1.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Failed to parse DOR JSON: ${error.message}`));
          }
        } else {
          reject(new Error(`DOR HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`DOR request failed: ${error.message}`));
    });
    req.setTimeout(30000, () => req.destroy(new Error('DOR API timeout after 30s')));

    req.end();
  });
}

function normalizeDorStatus(status) {
  if (!status) return 'Closed';
  const lowerStatus = status.toLowerCase();
  if (lowerStatus === 'open') return 'Open';
  if (lowerStatus === 'closed') return 'Closed';
  if (lowerStatus === 'hold' || lowerStatus === 'on hold') return 'Hold';
  if (lowerStatus === 'scheduled') return 'Scheduled';
  if (lowerStatus.includes('wind')) return 'Windhold';
  return status;
}

function normalizeDorLiftType(type) {
  if (!type) return null;
  const lowerType = type.toLowerCase();
  if (lowerType.includes('gondola')) return 'Gondola';
  if (lowerType.includes('tram')) return 'Tram';
  if (lowerType.includes('telemix')) return 'Telemix';
  if (lowerType.includes('six') || lowerType.includes('quad') || lowerType.includes('triple') || lowerType.includes('double')) return 'Chair';
  if (lowerType.includes('surface') || lowerType.includes('t-bar') || lowerType.includes('platter')) return 'Surface';
  if (lowerType.includes('carpet')) return 'Carpet';
  return 'Chair';
}

async function runDorScraper() {
  const dorResorts = config.resorts.filter(r =>
    r.provider === 'ikon' &&
    r.apiProvider === 'dor' &&
    isResortInSeason(r)
  );

  if (dorResorts.length === 0) return;

  const timestamp = new Date().toISOString();
  let totalLifts = 0;

  for (const resort of dorResorts) {
    if (isInDeadHours(resort.timezone)) continue;

    if (!resort.apiConfig?.baseUrl || !resort.apiConfig?.endpoint) continue;

    try {
      const dorData = await fetchDorData(resort);

      const localDate = getResortLocalDate(resort.timezone);
      const localTime = getResortLocalTime(resort.timezone);
      const liftsDir = path.join(CONFIG.dataDir, resort.key, 'lifts');
      ensureDirectoryExists(liftsDir);

      const outputFile = path.join(liftsDir, `${localDate}.ndjson`);
      const records = [];

      if (dorData.lift && Array.isArray(dorData.lift)) {
        for (const lift of dorData.lift) {
          const status = normalizeDorStatus(lift.status);

          const record = {
            timestamp,
            localTime,
            resort: resort.key,
            liftId: `dor:${lift.id}`,
            name: lift.name,
            status: status,
            type: normalizeDorLiftType(lift.type),
            waitMinutes: (lift.wait_time != null && lift.wait_time !== '') ? parseInt(lift.wait_time) : null,
            openTime: null,
            closeTime: null,
            mountain: lift.sector?.name || null,
          };

          // Parse hours string like "9 am - 3:45 pm"
          if (lift.hours) {
            const match = lift.hours.match(/(\d+(?::\d+)?\s*(?:AM|PM|A|P)?)\s*-\s*(\d+(?::\d+)?\s*(?:AM|PM|A|P)?)/i);
            if (match) {
              record.openTime = match[1].trim();
              record.closeTime = match[2].trim();
            }
          }

          records.push(record);
        }
      }

      if (records.length > 0) {
        fs.appendFileSync(outputFile, records.map(r => JSON.stringify(r)).join('\n') + '\n');
        totalLifts += records.length;
        console.log(`[DOR] ${resort.key}: ${records.length} lifts`);
      }
    } catch (error) {
      console.error(`[DOR] ${resort.key}: ${error.message}`);
    }
  }

  if (totalLifts > 0) {
    console.log(`[DOR] Total: ${totalLifts} lift records`);
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
              waitMinutes: (lift.WaitTime != null && lift.WaitTime !== '--') ? parseInt(lift.WaitTime) : null,
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
// VAIL SCRAPER (Puppeteer) - Single queue, only scrapes enabledResorts
// ═══════════════════════════════════════════════════════════════════════════════

// Single Vail scraper state (simplified from dual-queue)
// TO REVERT: See git history for the dual highPriorityState/regularState version
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
    // Kill ALL chromium processes (not just renderers) to ensure full cleanup
    exec('pkill -f chromium 2>/dev/null || true', (err) => {
      resolve();
    });
  });
}

async function initBrowser(state, poolSize, label) {
  if (state.browser) {
    try { await state.browser.close(); } catch (e) {}
  }

  // Clean up any orphaned chromium processes
  await killOrphanedChromium();

  console.log(`[VAIL-${label}] Launching browser with memory optimizations...`);
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
      // Additional memory optimizations
      '--single-process',              // Run in single process (saves ~100MB)
      '--disable-extensions',          // No extensions
      '--disable-plugins',             // No plugins
      '--disable-default-apps',        // No default apps
      '--mute-audio',                  // No audio processing
      '--disable-sync',                // No sync
      '--disable-translate',           // No translation
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      '--disable-hang-monitor',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-domain-reliability',
      '--disable-component-update',
      '--disable-breakpad',            // No crash reporting
      '--no-first-run',
      '--no-zygote',                   // No zygote process (saves memory)
      '--js-flags=--max-old-space-size=128',  // Limit JS heap to 128MB
    ],
  });

  // Initialize page pool
  state.pagePool.length = 0;
  for (let i = 0; i < poolSize; i++) {
    const page = await state.browser.newPage();
    await page.setUserAgent(getRandomUserAgent());
    state.pagePool.push({ page, inUse: false, lastUrl: null });
    console.log(`[VAIL-${label}] Created page ${i + 1}/${poolSize}`);
  }

  console.log(`[VAIL-${label}] Browser ready with ${poolSize} pages`);
}

function buildVailQueue() {
  // Only scrape resorts that are in the enabledResorts list
  const enabledKeys = new Set(CONFIG.vail.enabledResorts || []);

  // Check if any resorts are in dead hours (for logging)
  const allVailResorts = config.resorts.filter(r =>
    (!r.provider || r.provider === 'vail') &&
    enabledKeys.has(r.key) &&
    isResortInSeason(r)
  );

  const deadHourResorts = allVailResorts.filter(r => isInDeadHours(r.timezone));
  if (deadHourResorts.length > 0 && deadHourResorts.length === allVailResorts.length) {
    const sampleTz = deadHourResorts[0].timezone;
    const localTime = getResortLocalTime(sampleTz);
    console.log(`[VAIL] All resorts in dead hours (current time: ${localTime}) - scraping window: ${CONFIG.vail.scrapingStartHour}:00-${CONFIG.vail.scrapingEndHour}:00`);
  }

  const resorts = allVailResorts.filter(r =>
    !isInDeadHours(r.timezone) &&
    (r.terrainUrl || r.url)
  );

  return resorts;
}

async function scrapeOneResort(poolEntry, resort, label = 'VAIL') {
  const { page } = poolEntry;
  const url = resort.terrainUrl || resort.url;
  const timestamp = new Date().toISOString();

  try {
    const navTimeout = CONFIG.vail.navigationTimeout;
    const dataTimeout = CONFIG.vail.dataWaitTimeout;

    // Navigate or reload
    // Use domcontentloaded instead of networkidle2 - flagship sites (vail.com, beavercreek.com)
    // have heavy analytics that prevent networkidle2 from ever completing
    if (poolEntry.lastUrl === url) {
      // Same URL - just reload
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: navTimeout });
      } catch (e) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout });
      }
    } else {
      // Different URL - full navigation
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

    // Save all lift data (status + wait times where available)
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
    cycleFailures = 0;
    return { success: true, lifts: records.length };

  } catch (error) {
    let errorType = 'Unknown';
    if (error.message.includes('timeout')) errorType = 'Timeout';
    if (error.message.includes('waitForFunction')) errorType = 'DataWaitTimeout';
    if (error.message.includes('Waiting failed')) errorType = 'DataWaitTimeout';
    if (error.message.includes('navigation')) errorType = 'NavigationError';
    if (error.message.includes('browser')) errorType = 'BrowserError';

    console.error(`[${label}] ${resort.key} [${errorType}]: ${error.message}`);
    cycleFailures++;

    if (errorType === 'BrowserError' || errorType === 'NavigationError') {
      console.error(`[${label}] Fatal browser error - exiting for PM2 restart`);
      process.exit(1);
    }

    if (cycleFailures >= 2) {
      console.error(`[${label}] ${cycleFailures} failures this cycle - exiting for PM2 restart`);
      process.exit(1);
    }

    poolEntry.lastUrl = null;
    return { success: false, lifts: 0 };
  }
}

// Shared queue processing function used by both high and regular priority scrapers
async function processScrapeQueue(state, label, delayScrapes) {
  let totalLifts = 0;
  let resortsProcessed = 0;
  const activePromises = new Map();

  // Helper to get available page from this state's pool
  const getAvailablePage = () => state.pagePool.find(p => !p.inUse);

  while (state.queue.length > 0 || activePromises.size > 0) {
    // Fill all available pages with work
    while (state.queue.length > 0) {
      const poolEntry = getAvailablePage();
      if (!poolEntry) break;

      const resort = state.queue.shift();

      // Skip if resort entered dead hours
      if (isInDeadHours(resort.timezone)) {
        continue;
      }

      poolEntry.inUse = true;

      const scrapePromise = scrapeOneResort(poolEntry, resort, label)
        .then(result => {
          if (result.success) {
            totalLifts += result.lifts;
            resortsProcessed++;
            health.vail.lastSuccess = new Date().toISOString();
            health.vail.consecutiveFailures = 0;
          } else {
            // Track consecutive failures for Vail scraper
            health.vail.consecutiveFailures++;
          }
          return { poolEntry, result };
        })
        .catch(err => {
          console.error(`[${label}] Unexpected error: ${err.message}`);
          health.vail.consecutiveFailures++;
          return { poolEntry, result: { success: false, lifts: 0 } };
        })
        .finally(() => {
          poolEntry.inUse = false;
          activePromises.delete(poolEntry);
        });

      activePromises.set(poolEntry, scrapePromise);
    }

    if (activePromises.size > 0) {
      await Promise.race(activePromises.values());
      await sleep(delayScrapes);
    }
  }

  console.log(`[${label}] Processed ${resortsProcessed} resorts, ${totalLifts} lifts`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// VAIL SCRAPER - Simplified single-queue version
// ═══════════════════════════════════════════════════════════════════════════════
//
// TO ADD MORE RESORTS: Edit CONFIG.vail.enabledResorts array at the top of this file
// TO REVERT TO DUAL-QUEUE: See git history for commit before this change
//
async function runVailScraper() {
  if (vailState.running) return;

  // Check if enough time has passed since last cycle
  const now = Date.now();
  const timeSinceLastCycle = now - vailState.lastCycleStart;
  if (timeSinceLastCycle < CONFIG.vail.cycleIntervalMs) {
    return; // Too soon, skip this run
  }

  vailState.running = true;
  vailState.lastCycleStart = now;

  health.vail.lastRun = new Date().toISOString();
  health.vail.totalRuns++;

  // Build queue first — skip browser launch if nothing to scrape
  vailState.queue = buildVailQueue();

  if (vailState.queue.length === 0) {
    console.log('[VAIL] No active resorts to scrape');
    vailState.running = false;
    return;
  }

  // Only check memory/cycles when we're actually about to launch Chrome
  const mem = getMemoryUsage();
  if (mem && mem.availableMB < MIN_AVAILABLE_MEMORY_MB) {
    console.error(`[VAIL] Available memory critically low: ${mem.availableMB}MB (min: ${MIN_AVAILABLE_MEMORY_MB}MB) - exiting for PM2 restart`);
    process.exit(1);
  }

  if (vailCycleCount >= MAX_VAIL_CYCLES) {
    console.log(`[VAIL] Reached ${MAX_VAIL_CYCLES} cycles - exiting for clean PM2 restart`);
    process.exit(0);
  }

  // Launch fresh browser each cycle — with --single-process, Chrome leaks memory
  // across navigations, so we kill it after each cycle to prevent OOM
  await initBrowser(vailState, CONFIG.vail.pagePoolSize, 'VAIL');

  console.log(`[VAIL] Cycle ${vailCycleCount + 1}/${MAX_VAIL_CYCLES} - ${vailState.queue.length} resorts: ${vailState.queue.map(r => r.key).join(', ')}`);

  await processScrapeQueue(vailState, 'VAIL', CONFIG.vail.delayBetweenScrapes);

  // Close browser after each cycle to free all Chrome memory
  if (vailState.browser) {
    try { await vailState.browser.close(); } catch (e) {}
    vailState.browser = null;
    vailState.pagePool.length = 0;
  }
  await killOrphanedChromium();

  vailCycleCount++;
  cycleFailures = 0;
  console.log(`[VAIL] Cycle complete (memory released)`);
  vailState.running = false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH FILE (shared with API server)
// ═══════════════════════════════════════════════════════════════════════════════

const HEALTH_FILE = path.join(__dirname, 'health.json');

function getMemoryUsage() {
  try {
    const memInfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const lines = memInfo.split('\n');
    const getValue = (key) => {
      const line = lines.find(l => l.startsWith(key));
      if (!line) return 0;
      return parseInt(line.split(/\s+/)[1]) * 1024; // Convert KB to bytes
    };
    const total = getValue('MemTotal:');
    const free = getValue('MemFree:');
    const buffers = getValue('Buffers:');
    const cached = getValue('Cached:');
    const available = getValue('MemAvailable:');
    const swapTotal = getValue('SwapTotal:');
    const swapFree = getValue('SwapFree:');

    const used = total - free - buffers - cached;
    const swapUsed = swapTotal - swapFree;

    return {
      totalMB: Math.round(total / 1024 / 1024),
      usedMB: Math.round(used / 1024 / 1024),
      availableMB: Math.round(available / 1024 / 1024),
      usedPercent: Math.round((used / total) * 100),
      swapTotalMB: Math.round(swapTotal / 1024 / 1024),
      swapUsedMB: Math.round(swapUsed / 1024 / 1024),
      swapUsedPercent: swapTotal > 0 ? Math.round((swapUsed / swapTotal) * 100) : 0,
    };
  } catch (e) {
    return null; // /proc/meminfo not available (not Linux)
  }
}

function writeHealthFile() {
  const memory = getMemoryUsage();
  const healthData = {
    status: health.ikon.consecutiveFailures < 3 && health.vail.consecutiveFailures < 3 ? 'ok' : 'degraded',
    uptime: Math.round((Date.now() - health.startTime) / 1000),
    memory,
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
// TEMP DIRECTORY CLEANUP
// ═══════════════════════════════════════════════════════════════════════════════

// Clean up old Puppeteer temp profiles to prevent disk space issues
function cleanupOldTempProfiles() {
  const { exec } = require('child_process');
  // Remove profile directories older than 2 hours (120 minutes)
  exec('find /tmp -name "puppeteer_dev_chrome_profile-*" -type d -mmin +120 -exec rm -rf {} + 2>/dev/null',
    (err) => {
      if (err && err.code !== 1) {
        // Exit code 1 just means no files found, which is fine
        console.error('[CLEANUP] Error cleaning temp profiles:', err.message);
      } else {
        console.log('[CLEANUP] Cleaned up old Puppeteer temp profiles');
      }
    }
  );
}

// Run cleanup every hour
setInterval(cleanupOldTempProfiles, 60 * 60 * 1000);
// Also run once on startup
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
  console.log('║     Ski Lift Scraper - Memory Optimized Mode                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log(`Started at: ${new Date().toISOString()}`);

  // Log initial memory state
  const initMem = getMemoryUsage();
  if (initMem) {
    console.log(`Memory: ${initMem.usedMB}MB / ${initMem.totalMB}MB (${initMem.usedPercent}%), Swap: ${initMem.swapUsedMB}MB (${initMem.swapUsedPercent}%)`);
  }
  console.log('');
  console.log('┌─ IKON PROVIDERS ─────────────────────────────────────────────────────');
  console.log(`│ Enabled: ${(CONFIG.ikon.enabledProviders || []).join(', ') || 'ALL'}`);
  console.log(`│ Interval: ${CONFIG.ikon.intervalMs / 1000}s`);
  console.log('└───────────────────────────────────────────────────────────────────────');
  console.log('');
  console.log('┌─ VAIL RESORTS ───────────────────────────────────────────────────────');
  console.log(`│ Enabled: ${(CONFIG.vail.enabledResorts || []).join(', ')}`);
  console.log(`│ Scraping window: ${CONFIG.vail.scrapingStartHour}:00 - ${CONFIG.vail.scrapingEndHour}:00 (local time)`);
  console.log(`│ Pages: ${CONFIG.vail.pagePoolSize}, Cycle: ${CONFIG.vail.cycleIntervalMs / 1000}s`);
  console.log(`│ Timeouts: nav=${CONFIG.vail.navigationTimeout / 1000}s, data=${CONFIG.vail.dataWaitTimeout / 1000}s`);
  console.log('└───────────────────────────────────────────────────────────────────────');
  console.log('');
  console.log(`Error handling: crash-and-restart via PM2 (exit on 2+ failures per cycle)`);
  console.log(`Memory management: browser closed after each cycle, full restart after ${MAX_VAIL_CYCLES} cycles`);
  console.log(`Data directory: ${CONFIG.dataDir}`);
  console.log('');

  // Browser is now launched fresh each Vail cycle and closed after (prevents OOM)
  // No early browser init needed

  // Track last run time for Ikon APIs
  let lastIkonRun = 0;

  // Main loop - checks every 5 seconds if it's time to run scrapers
  while (!isShuttingDown) {
    const now = Date.now();

    // Ikon APIs - every 2 minutes (only enabled providers)
    if (now - lastIkonRun >= CONFIG.ikon.intervalMs) {
      lastIkonRun = now;
      const enabled = CONFIG.ikon.enabledProviders || [];

      // Only run scrapers for enabled providers
      // TO ENABLE MORE: Add provider name to CONFIG.ikon.enabledProviders array
      if (enabled.length === 0 || enabled.includes('inspector')) {
        runIkonScraper().catch(console.error);
      }
      if (enabled.length === 0 || enabled.includes('aspensnowmass')) {
        runAspenScraper().catch(console.error);
      }
      if (enabled.length === 0 || enabled.includes('reportpal')) {
        runReportPalScraper().catch(console.error);
      }
      if (enabled.length === 0 || enabled.includes('zaneray')) {
        runZanerayScraper().catch(console.error);
      }
      if (enabled.length === 0 || enabled.includes('dor')) {
        runDorScraper().catch(console.error);
      }
    }

    // Vail scraper - checks its own timing
    if (!vailState.running) {
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
