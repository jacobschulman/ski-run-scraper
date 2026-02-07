// lift-scraper-others.js - Continuous HTTP API-based lift scraper for Hetzner
// Covers all non-Vail providers: Inspector (Ikon), Aspen, ReportPal, Zaneray, DOR
// Runs independently from Vail scraper so Puppeteer crashes don't affect these

const dns = require('dns');
// Fallback to public DNS if system resolver is broken (e.g., Tailscale MagicDNS down)
dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);

const https = require('https');
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
  intervalMs: 120 * 1000,     // 2 minutes
  jitterMs: 10000,            // 0-10 seconds random jitter
  enabledProviders: config.liftScraping?.ikon?.enabledProviders || [
    'inspector',
    'aspensnowmass',
    'reportpal',
    'dor',
  ],
  dataDir: path.join(__dirname, '..', 'data'),
};

// User agents for HTTP requests
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

// Health tracking
const health = {
  ikon: { lastRun: null, lastSuccess: null, consecutiveFailures: 0, totalRuns: 0 },
  startTime: Date.now(),
};

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
  return hour >= 17 || hour < 8;
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
// INSPECTOR (IKON) SCRAPER
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

async function runIkonScraper() {
  const startTime = Date.now();
  health.ikon.lastRun = new Date().toISOString();
  health.ikon.totalRuns++;

  // Apply jitter
  const jitter = Math.random() * CONFIG.jitterMs;
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
// ASPEN SNOWMASS SCRAPER
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH FILE (shared with API server and Vail scraper)
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
  // Read existing health file to preserve Vail scraper's data
  let existingHealth = {};
  try {
    existingHealth = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8'));
  } catch (e) {}

  const memory = getMemoryUsage();
  const healthData = {
    ...existingHealth,
    status: health.ikon.consecutiveFailures >= 3 ? 'degraded' : (existingHealth.status === 'degraded' ? 'degraded' : 'ok'),
    uptime: Math.round((Date.now() - health.startTime) / 1000),
    memory: memory || existingHealth.memory,
    ikon: {
      lastRun: health.ikon.lastRun,
      lastSuccess: health.ikon.lastSuccess,
      consecutiveFailures: health.ikon.consecutiveFailures,
      totalRuns: health.ikon.totalRuns,
    },
    lastUpdatedBy: 'lift-scraper-others',
    lastUpdatedAt: new Date().toISOString(),
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

process.on('SIGINT', () => {
  console.log('\nShutdown signal received...');
  isShuttingDown = true;
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nTermination signal received...');
  isShuttingDown = true;
  process.exit(0);
});

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║     Lift Scraper - Others (HTTP API Providers)                     ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log('');
  console.log('┌─ ENABLED PROVIDERS ──────────────────────────────────────────────────');
  console.log(`│ ${(CONFIG.enabledProviders || []).join(', ') || 'ALL'}`);
  console.log(`│ Interval: ${CONFIG.intervalMs / 1000}s`);
  console.log('└───────────────────────────────────────────────────────────────────────');
  console.log('');
  console.log(`Data directory: ${CONFIG.dataDir}`);
  console.log('');

  let lastRun = 0;

  while (!isShuttingDown) {
    const now = Date.now();

    if (now - lastRun >= CONFIG.intervalMs) {
      lastRun = now;
      const enabled = CONFIG.enabledProviders || [];

      if (enabled.length === 0 || enabled.includes('inspector')) {
        runIkonScraper().catch(e => console.error('[IKON] Unhandled error:', e.message));
      }
      if (enabled.length === 0 || enabled.includes('aspensnowmass')) {
        runAspenScraper().catch(e => console.error('[ASPEN] Unhandled error:', e.message));
      }
      if (enabled.length === 0 || enabled.includes('reportpal')) {
        runReportPalScraper().catch(e => console.error('[REPORTPAL] Unhandled error:', e.message));
      }
      if (enabled.length === 0 || enabled.includes('zaneray')) {
        runZanerayScraper().catch(e => console.error('[ZANERAY] Unhandled error:', e.message));
      }
      if (enabled.length === 0 || enabled.includes('dor')) {
        runDorScraper().catch(e => console.error('[DOR] Unhandled error:', e.message));
      }
    }

    await sleep(5000);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
