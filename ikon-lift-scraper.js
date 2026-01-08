// ikon-lift-scraper.js - Ikon Pass lift wait-time tracker
// Uses Inspector API (mtnpowder.com) for fast, efficient lift status and wait time tracking
//
// ═══════════════════════════════════════════════════════════════════════════════
// API DOCUMENTATION
// ═══════════════════════════════════════════════════════════════════════════════
//
// API Endpoint: https://mtnpowder.com/feed/v3.json
// Provider: Ikon Pass resorts (configured with provider: "ikon" in config.json)
// Authentication: Bearer token (configured in config.json under inspector.bearerToken)
// Data Source: Single HTTP call fetches all 123 Ikon resorts, filtered by configured resorts
// Update Frequency: Every 10 minutes during operating hours
//
// ═══════════════════════════════════════════════════════════════════════════════
// USAGE
// ═══════════════════════════════════════════════════════════════════════════════
//
// node ikon-lift-scraper.js
//
// Runs automatically via .github/workflows/lift-scraper.yml every 10 minutes
// Uses intelligent filtering to only check resorts during their operating hours
//
// ═══════════════════════════════════════════════════════════════════════════════

const https = require('https');
const fs = require('fs');
const path = require('path');

const configLoader = require('./lib/config-loader');
const seasonUtils = require('./lib/season-utils');
const { formatLiftType } = require('./lib/data-normalization');
const fileStorage = require('./lib/file-storage');

// Load configuration
const config = configLoader.loadConfig();
const RESORTS = configLoader.getResortsMap(config);

// Inspector API configuration
const INSPECTOR_API_URL = config.inspector?.apiUrl || 'https://mtnpowder.com/feed/v3.json';
const BEARER_TOKEN = config.inspector?.bearerToken || 'hPtaTVkbuyZQnrxvru4ApfpXnS21PJO3eTKdibDoLZE';

// Aspen Snowmass API
const ASPEN_API_BASE = 'https://www.aspensnowmass.com/AspenSnowmass/LiftStatus/Feed';

// Zaneray API (Jackson Hole)
// Returns lift data in a "lifts" object with status in openingStatus field

// Operating window buffers
const PRE_OPEN_BUFFER_MINUTES = 30;
const POST_CLOSE_GRACE_MINUTES = 60; // extended grace period to ensure we capture all lift closings

/**
 * Fetch all resort data from Inspector API
 */
function fetchAllInspectorData() {
  return new Promise((resolve, reject) => {
    const url = `${INSPECTOR_API_URL}?bearer_token=${BEARER_TOKEN}`;

    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (error) {
            reject(new Error(`Failed to parse JSON: ${error.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    }).on('error', (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });
  });
}

/**
 * Fetch lift data from Aspen Snowmass API
 */
function fetchAspenData(mountainId) {
  return new Promise((resolve, reject) => {
    const url = `${ASPEN_API_BASE}?mountain=${mountainId}&areas=&isSummer=False`;

    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (error) {
            reject(new Error(`Failed to parse Aspen JSON: ${error.message}`));
          }
        } else {
          reject(new Error(`Aspen HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    }).on('error', (error) => {
      reject(new Error(`Aspen request failed: ${error.message}`));
    });
  });
}

/**
 * Parse Aspen hours string like "9:00 AM - 3:30 PM" into openTime/closeTime
 */
function parseAspenHours(hoursStr) {
  if (!hoursStr) return { openTime: null, closeTime: null };
  const match = hoursStr.match(/(\d+:\d+\s*[AP]M)\s*-\s*(\d+:\d+\s*[AP]M)/i);
  if (match) {
    return { openTime: match[1], closeTime: match[2] };
  }
  return { openTime: null, closeTime: null };
}

/**
 * Normalize Aspen lift type to standard format
 */
function normalizeAspenLiftType(type) {
  if (!type) return null;
  if (type.includes('Gondola')) return 'Gondola';
  if (type.includes('HS') || type.includes('Express')) return 'Chair';
  if (type.includes('Quad') || type.includes('Triple') || type.includes('Double')) return 'Chair';
  if (type.includes('Fixed')) return 'Chair';
  if (type.includes('Surface') || type.includes('T-Bar')) return 'Surface';
  if (type.includes('Carpet') || type.includes('Conveyor')) return 'Carpet';
  return type;
}

/**
 * Save Aspen lift data for a resort
 */
function saveAspenLiftData(resortKey, aspenData, timestamp) {
  const resort = RESORTS[resortKey];
  const timezone = resort.timezone;
  const localDate = seasonUtils.getResortLocalDate(timezone);
  const localTime = seasonUtils.getResortLocalTime(timezone);

  const liftsDir = path.join('data', resortKey, 'lifts');
  fileStorage.ensureDirectoryExists(liftsDir);

  const outputFile = path.join(liftsDir, `${localDate}.ndjson`);

  let liftRecords = [];
  let hasOpenLifts = false;

  if (aspenData.liftStatuses && aspenData.liftStatuses.length > 0) {
    aspenData.liftStatuses.forEach((lift) => {
      const hours = parseAspenHours(lift.hoursOfOperation);

      const liftRecord = {
        timestamp: timestamp,
        localTime: localTime,
        resort: resortKey,
        liftId: `aspen:${lift.liftName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        name: lift.liftName,
        status: lift.status,
        type: normalizeAspenLiftType(lift.type),
        waitMinutes: null, // Aspen doesn't provide wait times
        openTime: hours.openTime,
        closeTime: hours.closeTime,
        mountain: lift.area,
        rideTimeMinutes: lift.time ? parseInt(lift.time) : null,
        elevationGainFeet: lift.elevationGainFeet ? parseInt(lift.elevationGainFeet.replace(/,/g, '')) : null,
      };

      liftRecords.push(liftRecord);

      if (lift.status === 'Open') {
        hasOpenLifts = true;
      }
    });
  }

  if (liftRecords.length > 0) {
    const ndjsonLines = liftRecords.map(record => JSON.stringify(record)).join('\n') + '\n';
    fs.appendFileSync(outputFile, ndjsonLines);
    console.log(`✓ Saved ${liftRecords.length} Aspen lift records to ${outputFile}`);

    const openLifts = liftRecords.filter(r => r.status === 'Open');
    console.log(`  Open lifts: ${openLifts.length}/${liftRecords.length}`);
  }

  if (hasOpenLifts) {
    addToActiveResortCache(resortKey, timezone);
  }

  return { liftCount: liftRecords.length, hasOpenLifts };
}

/**
 * Fetch lift data from ReportPal API
 */
async function fetchReportPalData(resort) {
  const { baseUrl, resortCode } = resort.apiConfig;
  const url = `${baseUrl}/api/reportpal?resortName=${resortCode}&useReportPal=true`;

  console.log(`  📡 Fetching ReportPal data from: ${url}`);

  return new Promise((resolve, reject) => {
    const https = require('https');
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

    req.end();
  });
}

/**
 * Save ReportPal lift data for a resort
 */
function saveReportPalLiftData(resortKey, reportpalData, timestamp) {
  const resort = RESORTS[resortKey];
  const timezone = resort.timezone;
  const localDate = seasonUtils.getResortLocalDate(timezone);
  const localTime = seasonUtils.getResortLocalTime(timezone);

  const liftsDir = path.join('data', resortKey, 'lifts');
  fileStorage.ensureDirectoryExists(liftsDir);

  const outputFile = path.join(liftsDir, `${localDate}.ndjson`);

  let liftRecords = [];
  let hasOpenLifts = false;

  // Extract lifts from all areas
  if (reportpalData.facilities?.areas?.area) {
    const areas = reportpalData.facilities.areas.area;
    for (const area of areas) {
      if (area.lifts?.lift) {
        for (const lift of area.lifts.lift) {
          // Normalize status: treat "Scheduled" as potentially open during operating hours
          let status = lift.status;
          if (status === 'On Hold') status = 'Hold';

          const liftRecord = {
            timestamp: timestamp,
            localTime: localTime,
            resort: resortKey,
            liftId: `reportpal:${lift.id}`,
            name: lift.name,
            status: status,
            type: formatLiftType(lift.type),
            waitMinutes: lift.skierWaitTime ? parseInt(lift.skierWaitTime) : null,
            openTime: lift.openTime || null,
            closeTime: lift.closeTime || null,
            mountain: area.name,
            capacity: lift.capacity || null,
          };

          liftRecords.push(liftRecord);

          if (status === 'Open' || status === 'Scheduled') {
            hasOpenLifts = true;
          }
        }
      }
    }
  }

  if (liftRecords.length > 0) {
    const ndjsonLines = liftRecords.map(record => JSON.stringify(record)).join('\n') + '\n';
    fs.appendFileSync(outputFile, ndjsonLines);
    console.log(`✓ Saved ${liftRecords.length} ReportPal lift records to ${outputFile}`);

    const openLifts = liftRecords.filter(r => r.status === 'Open' || r.status === 'Scheduled');
    console.log(`  Open lifts: ${openLifts.length}/${liftRecords.length}`);
  }

  if (hasOpenLifts) {
    addToActiveResortCache(resortKey, timezone);
  }

  return { liftCount: liftRecords.length, hasOpenLifts };
}

/**
 * Fetch lift data from DOR API (Snowbird, Copper, Killington)
 */
async function fetchDorData(resort) {
  const { baseUrl, endpoint } = resort.apiConfig;
  const url = `${baseUrl}${endpoint}`;

  console.log(`  📡 Fetching DOR data from: ${url}`);

  return new Promise((resolve, reject) => {
    const https = require('https');
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

    req.end();
  });
}

/**
 * Normalize DOR lift type to standard format
 */
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

/**
 * Normalize DOR status to standard format
 */
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

/**
 * Save DOR lift data for a resort
 */
function saveDorLiftData(resortKey, dorData, timestamp) {
  const resort = RESORTS[resortKey];
  const timezone = resort.timezone;
  const localDate = seasonUtils.getResortLocalDate(timezone);
  const localTime = seasonUtils.getResortLocalTime(timezone);

  const liftsDir = path.join('data', resortKey, 'lifts');
  fileStorage.ensureDirectoryExists(liftsDir);

  const outputFile = path.join(liftsDir, `${localDate}.ndjson`);

  let liftRecords = [];
  let hasOpenLifts = false;

  // DOR stores lifts in a "lift" array
  if (dorData.lift && Array.isArray(dorData.lift)) {
    for (const lift of dorData.lift) {
      const status = normalizeDorStatus(lift.status);

      const liftRecord = {
        timestamp: timestamp,
        localTime: localTime,
        resort: resortKey,
        liftId: `dor:${lift.id}`,
        name: lift.name,
        status: status,
        type: normalizeDorLiftType(lift.type),
        waitMinutes: lift.wait_time ? parseInt(lift.wait_time) : null,
        openTime: null,
        closeTime: null,
        mountain: lift.sector?.name || null,
        vertical: lift.vertical || null,
        hours: lift.hours || null,
      };

      // Parse hours string like "9 am - 3:45 pm" or "9A-4P"
      if (lift.hours) {
        const match = lift.hours.match(/(\d+(?::\d+)?\s*(?:AM|PM|A|P)?)\s*-\s*(\d+(?::\d+)?\s*(?:AM|PM|A|P)?)/i);
        if (match) {
          liftRecord.openTime = match[1].trim();
          liftRecord.closeTime = match[2].trim();
        }
      }

      liftRecords.push(liftRecord);

      if (status === 'Open' || status === 'Scheduled') {
        hasOpenLifts = true;
      }
    }
  }

  if (liftRecords.length > 0) {
    const ndjsonLines = liftRecords.map(record => JSON.stringify(record)).join('\n') + '\n';
    fs.appendFileSync(outputFile, ndjsonLines);
    console.log(`✓ Saved ${liftRecords.length} DOR lift records to ${outputFile}`);

    const openLifts = liftRecords.filter(r => r.status === 'Open' || r.status === 'Scheduled');
    console.log(`  Open lifts: ${openLifts.length}/${liftRecords.length}`);
  }

  if (hasOpenLifts) {
    addToActiveResortCache(resortKey, timezone);
  }

  return { liftCount: liftRecords.length, hasOpenLifts };
}

/**
 * Fetch lift data from Zaneray API (Jackson Hole)
 */
async function fetchZanerayData(resort) {
  const { apiUrl } = resort.apiConfig;

  console.log(`  📡 Fetching Zaneray data from: ${apiUrl}`);

  return new Promise((resolve, reject) => {
    const https = require('https');
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

    req.end();
  });
}

/**
 * Normalize Zaneray lift type to standard format
 */
function normalizeZanerayLiftType(type) {
  if (!type) return null;
  const upperType = type.toUpperCase();
  if (upperType.includes('GONDOLA')) return 'Gondola';
  if (upperType.includes('TRAM')) return 'Tram';
  if (upperType.includes('CHAIRLIFT') || upperType.includes('QUAD') || upperType.includes('TRIPLE') || upperType.includes('DOUBLE')) return 'Chair';
  if (upperType.includes('SURFACE') || upperType.includes('T-BAR') || upperType.includes('PLATTER')) return 'Surface';
  if (upperType.includes('CARPET') || upperType.includes('CONVEYOR')) return 'Carpet';
  return 'Chair'; // Default to Chair for unknown types
}

/**
 * Normalize Zaneray status to standard format
 */
function normalizeZanerayStatus(status) {
  if (!status) return 'Closed';
  const upperStatus = status.toUpperCase();
  if (upperStatus === 'OPEN') return 'Open';
  if (upperStatus === 'CLOSED') return 'Closed';
  if (upperStatus === 'HOLD' || upperStatus === 'ON_HOLD') return 'Hold';
  if (upperStatus === 'SCHEDULED') return 'Scheduled';
  if (upperStatus.includes('WIND')) return 'Windhold';
  return status; // Return original if unknown
}

/**
 * Save Zaneray lift data for a resort
 */
function saveZanerayLiftData(resortKey, zanerayData, timestamp) {
  const resort = RESORTS[resortKey];
  const timezone = resort.timezone;
  const localDate = seasonUtils.getResortLocalDate(timezone);
  const localTime = seasonUtils.getResortLocalTime(timezone);

  const liftsDir = path.join('data', resortKey, 'lifts');
  fileStorage.ensureDirectoryExists(liftsDir);

  const outputFile = path.join(liftsDir, `${localDate}.ndjson`);

  let liftRecords = [];
  let hasOpenLifts = false;

  // Zaneray stores lifts as an object with camelCase keys
  if (zanerayData.lifts && typeof zanerayData.lifts === 'object') {
    for (const [liftKey, lift] of Object.entries(zanerayData.lifts)) {
      const status = normalizeZanerayStatus(lift.openingStatus);

      const liftRecord = {
        timestamp: timestamp,
        localTime: localTime,
        resort: resortKey,
        liftId: `zaneray:${lift.id || liftKey}`,
        name: lift.name,
        status: status,
        type: normalizeZanerayLiftType(lift.liftType),
        waitMinutes: null, // Zaneray doesn't provide wait times
        openTime: null,
        closeTime: null,
        mountain: null,
        departureAltitude: lift.departureAltitude?.value || null,
        arrivalAltitude: lift.arrivalAltitude?.value || null,
        speed: lift.speed?.value || null,
        message: lift.message || null,
      };

      liftRecords.push(liftRecord);

      if (status === 'Open' || status === 'Scheduled') {
        hasOpenLifts = true;
      }
    }
  }

  if (liftRecords.length > 0) {
    const ndjsonLines = liftRecords.map(record => JSON.stringify(record)).join('\n') + '\n';
    fs.appendFileSync(outputFile, ndjsonLines);
    console.log(`✓ Saved ${liftRecords.length} Zaneray lift records to ${outputFile}`);

    const openLifts = liftRecords.filter(r => r.status === 'Open' || r.status === 'Scheduled');
    console.log(`  Open lifts: ${openLifts.length}/${liftRecords.length}`);
  }

  if (hasOpenLifts) {
    addToActiveResortCache(resortKey, timezone);
  }

  return { liftCount: liftRecords.length, hasOpenLifts };
}

/**
 * Convert time string (HH:mm or h:mm a) to minutes since midnight
 */
function timeToMinutes(timeStr) {
  if (!timeStr) return null;

  // Handle formats like "8:30am" or "4:00pm"
  let match = timeStr.match(/(\d+):(\d+)\s*(am|pm)?/i);
  if (!match) return null;

  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const meridiem = match[3]?.toLowerCase();

  if (meridiem) {
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
  }

  return hours * 60 + minutes;
}

/**
 * Check if current time is in "dead hours" when ski resorts are closed
 * Dead hours: 10 PM - 7 AM local time
 * Extended from 6 PM to 10 PM to ensure we capture closing transitions for all lifts
 */
function isInDeadHours(timezone) {
  const hour = seasonUtils.getResortLocalHour(timezone);
  // Dead hours: 10 PM (22:00) to 7 AM (07:00) in the resort's local timezone
  return hour >= 22 || hour < 7;
}

/**
 * Check if we're in discovery window (7 AM - 12 PM local)
 */
function isInDiscoveryWindow(timezone) {
  const hour = seasonUtils.getResortLocalHour(timezone);
  return hour >= 7 && hour < 12;
}

/**
 * Load the active resort cache
 */
function loadActiveResortCache() {
  const cacheDir = path.join('cache');
  const cachePath = path.join(cacheDir, 'active-resorts.json');

  if (!fs.existsSync(cachePath)) {
    return new Map();
  }

  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const cacheMap = new Map();
    if (data.resorts && Array.isArray(data.resorts)) {
      data.resorts.forEach(entry => {
        if (entry.resortKey && entry.localDate) {
          cacheMap.set(entry.resortKey, entry.localDate);
        }
      });
    }
    return cacheMap;
  } catch (error) {
    return new Map();
  }
}

/**
 * Save a resort to the active cache
 */
function addToActiveResortCache(resortKey, timezone) {
  const localDate = seasonUtils.getResortLocalDate(timezone);
  const cacheDir = path.join('cache');
  const cachePath = path.join(cacheDir, 'active-resorts.json');

  fileStorage.ensureDirectoryExists(cacheDir);

  let cache = { resorts: [] };
  if (fs.existsSync(cachePath)) {
    try {
      cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch (error) {
      // Ignore, will create new cache
    }
  }

  if (!Array.isArray(cache.resorts)) {
    cache.resorts = [];
  }

  const existingIndex = cache.resorts.findIndex(r => r.resortKey === resortKey);

  if (existingIndex >= 0) {
    cache.resorts[existingIndex].localDate = localDate;
  } else {
    cache.resorts.push({ resortKey, localDate });
  }

  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
}

/**
 * Determine if we should check a resort for lift data
 * Simpler than Vail version since HTTP API is fast
 */
function shouldCheckResort(resortKey, resort, activeCache) {
  const timezone = resort.timezone;
  const localDate = seasonUtils.getResortLocalDate(timezone);

  // TIER 1: Dead hours - skip
  if (isInDeadHours(timezone)) {
    return { shouldCheck: false, reason: 'dead_hours', tier: 1 };
  }

  // TIER 2: Discovery window - check all in-season resorts
  if (isInDiscoveryWindow(timezone)) {
    return { shouldCheck: true, reason: 'discovery_window', tier: 2 };
  }

  // TIER 3: Active cache - resort showed lift activity today
  if (activeCache.has(resortKey)) {
    const cachedDate = activeCache.get(resortKey);
    if (cachedDate === localDate) {
      return { shouldCheck: true, reason: 'active_cache', tier: 3 };
    }
  }

  // TIER 4: Check if we have prior lift data from today
  const liftsDir = path.join('data', resortKey, 'lifts');
  const todayFile = path.join(liftsDir, `${localDate}.ndjson`);

  if (!fs.existsSync(todayFile)) {
    return { shouldCheck: false, reason: 'no_prior_data', tier: 4 };
  }

  try {
    const lines = fs.readFileSync(todayFile, 'utf8').trim().split('\n');
    if (lines.length === 0) {
      return { shouldCheck: false, reason: 'empty_data', tier: 4 };
    }

    const lastRecord = JSON.parse(lines[lines.length - 1]);
    const lastTimestamp = lastRecord.timestamp;

    const recentRecords = lines
      .map(line => JSON.parse(line))
      .filter(record => record.timestamp === lastTimestamp);

    const openLifts = recentRecords.filter(r =>
      (r.status === 'Open' || r.status === 'Scheduled') &&
      r.openTime && r.closeTime
    );

    if (openLifts.length > 0) {
      const openTimes = openLifts.map(r => timeToMinutes(r.openTime));
      const closeTimes = openLifts.map(r => timeToMinutes(r.closeTime));

      const earliestOpen = Math.min(...openTimes) - PRE_OPEN_BUFFER_MINUTES;
      const latestClose = Math.max(...closeTimes);
      const hardStop = latestClose + POST_CLOSE_GRACE_MINUTES;
      const currentMinutes = timeToMinutes(seasonUtils.getResortLocalTime(timezone));

      if (currentMinutes < earliestOpen) {
        return { shouldCheck: false, reason: 'before_operating_hours', tier: 4 };
      }

      if (currentMinutes <= latestClose) {
        return { shouldCheck: true, reason: 'within_operating_hours', tier: 4 };
      }

      if (currentMinutes <= hardStop) {
        // Always check during grace period to capture closing transitions
        return { shouldCheck: true, reason: 'post_close_grace', tier: 4 };
      }
    }

    return { shouldCheck: false, reason: 'past_grace_period', tier: 4 };
  } catch (error) {
    return { shouldCheck: true, reason: 'data_read_error', tier: 4 };
  }
}

/**
 * Get today's lift hours from Inspector Hours object
 * Inspector provides full weekly schedule: { Monday: { Open: "8:30am", Close: "4:00pm" }, ... }
 */
function getTodayLiftHours(hoursObj, timezone) {
  if (!hoursObj) return { openTime: null, closeTime: null };

  const { formatInTimeZone } = require('date-fns-tz');
  const now = new Date();
  // Use 'EEEE' to get full day name directly (e.g., "Monday", "Tuesday")
  // Note: 'i' returns ISO week number (1-53), NOT day of week
  const dayName = formatInTimeZone(now, timezone, 'EEEE');

  if (hoursObj[dayName]) {
    return {
      openTime: hoursObj[dayName].Open || null,
      closeTime: hoursObj[dayName].Close || null
    };
  }

  return { openTime: null, closeTime: null };
}

/**
 * Process and save lift data for a resort
 */
function saveLiftData(resortKey, inspectorData, timestamp) {
  const resort = RESORTS[resortKey];
  const timezone = resort.timezone;
  const localDate = seasonUtils.getResortLocalDate(timezone);
  const localTime = seasonUtils.getResortLocalTime(timezone);
  const getLiftId = (lift, areaName) => {
    return (
      lift.LiftId ||
      lift.Id ||
      lift.liftId ||
      `${(areaName || 'unknown').toLowerCase()}:${(lift.Name || 'unknown').toLowerCase()}`
    );
  };

  const liftsDir = path.join('data', resortKey, 'lifts');
  fileStorage.ensureDirectoryExists(liftsDir);

  const outputFile = path.join(liftsDir, `${localDate}.ndjson`);

  let liftRecords = [];
  let hasOpenLifts = false;

  // Extract all lifts from mountain areas
  if (inspectorData.MountainAreas && inspectorData.MountainAreas.length > 0) {
    inspectorData.MountainAreas.forEach(area => {
      if (area.Lifts && area.Lifts.length > 0) {
        area.Lifts.forEach(lift => {
          const hours = getTodayLiftHours(lift.Hours, timezone);
          const liftId = getLiftId(lift, area.Name);

          // Parse wait time (handle "--" or numeric values)
          let waitMinutes = null;
          if (lift.WaitTime && lift.WaitTime !== '--') {
            const parsed = parseInt(lift.WaitTime);
            if (!isNaN(parsed)) {
              waitMinutes = parsed;
            }
          }

          // Normalize to Vail format with Inspector extensions
            const liftRecord = {
              timestamp: timestamp,
              localTime: localTime,
              resort: resortKey,
              liftId: liftId,
              name: lift.Name,
              status: lift.Status,
              type: formatLiftType(lift.LiftType),
              waitMinutes: waitMinutes,
              openTime: hours.openTime,
            closeTime: hours.closeTime,
            mountain: area.Name,

            // Inspector-specific fields (preserve extra data)
            firstTracks: lift.FirstTracks || null,
            elevationTop: lift.ElevationTop || null,
            elevationBottom: lift.ElevationBottom || null,
            verticalRise: lift.VerticalRise || null,
            liftLength: lift.LiftLength || null
          };

          liftRecords.push(liftRecord);

          if (lift.Status === 'Open') {
            hasOpenLifts = true;
          }
        });
      }
    });
  }

  // Append to NDJSON file
  if (liftRecords.length > 0) {
    const ndjsonLines = liftRecords.map(record => JSON.stringify(record)).join('\n') + '\n';
    fs.appendFileSync(outputFile, ndjsonLines);
    console.log(`✓ Saved ${liftRecords.length} lift records to ${outputFile}`);

    // Print summary
    const openLifts = liftRecords.filter(r => r.status === 'Open');
    const liftsWithWaits = openLifts.filter(r => r.waitTime && r.waitTime > 0);

    console.log(`  Open lifts: ${openLifts.length}/${liftRecords.length}`);
    if (liftsWithWaits.length > 0) {
      console.log(`  Lifts with wait times:`);
      liftsWithWaits.forEach(lift => {
        console.log(`    - ${lift.name}: ${lift.waitTime} min`);
      });
    }
  }

  // Add to active cache if we found open lifts
  if (hasOpenLifts) {
    addToActiveResortCache(resortKey, timezone);
  }

  return { liftCount: liftRecords.length, hasOpenLifts };
}

/**
 * Scrape Inspector resorts for lift data
 */
async function scrapeLiftData(resortsToCheck) {
  const scrapedData = [];

  console.log(`\n📦 Fetching all Ikon resort data from Inspector API...`);

  const timestamp = new Date().toISOString();

  try {
    // Fetch all resort data in one API call
    const apiResponse = await fetchAllInspectorData();

    if (!apiResponse || !apiResponse.Resorts || apiResponse.Resorts.length === 0) {
      console.error('❌ No resort data in API response');
      return scrapedData;
    }

    console.log(`✓ Received data for ${apiResponse.Resorts.length} resorts from API`);
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Processing ${resortsToCheck.length} configured resort(s)...`);
    console.log('='.repeat(80));

    // Process each configured Ikon resort
    resortsToCheck.forEach(resort => {
      const inspectorName = resort.inspectorName || resort.name;

      // Find matching resort in API data (exact name match)
      const ikonResortData = apiResponse.Resorts.find(r => r.Name === inspectorName);

      if (!ikonResortData) {
        console.error(`\n⚠️  ${resort.name}: No matching data found (looking for "${inspectorName}")`);
        return;
      }

      console.log(`\n[${resort.name}]`);
      const result = saveLiftData(resort.key, ikonResortData, timestamp);
      scrapedData.push({ resortKey: resort.key, ...result });
    });

  } catch (error) {
    console.error(`❌ Error fetching Ikon data from Inspector API:`, error.message);
  }

  return scrapedData;
}

/**
 * Main execution function
 */
async function main() {
  console.log('🎿 Ikon Pass Lift Scraper - HTTP API');
  console.log('='.repeat(80));
  console.log(`Run time: ${new Date().toISOString()}`);
  console.log(`API URL: ${INSPECTOR_API_URL}`);
  console.log('='.repeat(80));

  // Get Ikon resorts (including custom API providers like ReportPal)
  const ikonResorts = configLoader.getResortsByProvider(config, 'ikon', false);

  if (ikonResorts.length === 0) {
    console.log('\n⚠️  No Ikon resorts found in config.json\n');
    return;
  }

  // Filter to in-season resorts only
  const inSeasonResorts = ikonResorts.filter(resort =>
    seasonUtils.isResortInSeason(resort, config)
  );

  console.log(`\n📋 Found ${inSeasonResorts.length} in-season Ikon resort(s)`);

  // Load active cache
  const activeCache = loadActiveResortCache();

  // Determine which resorts to check
  const resortsToCheck = [];
  const skippedResorts = [];

  inSeasonResorts.forEach(resort => {
    // Always check resorts with custom APIs if not in dead hours
    if (resort.apiProvider === 'aspensnowmass' || resort.apiProvider === 'reportpal' || resort.apiProvider === 'zaneray' || resort.apiProvider === 'dor') {
      if (!isInDeadHours(resort.timezone)) {
        resortsToCheck.push(resort);
      } else {
        skippedResorts.push({ resort, reason: 'dead_hours' });
      }
      return;
    }

    const decision = shouldCheckResort(resort.key, resort, activeCache);

    if (decision.shouldCheck) {
      resortsToCheck.push(resort);
    } else {
      skippedResorts.push({ resort, reason: decision.reason });
    }
  });

  // Print summary of decisions
  if (skippedResorts.length > 0) {
    console.log(`\n⏭️  Skipping ${skippedResorts.length} resort(s):`);
    skippedResorts.forEach(({ resort, reason }) => {
      const localTime = seasonUtils.getResortLocalTimeFormatted(resort.timezone);
      console.log(`   ${resort.name}: ${reason} (local time: ${localTime})`);
    });
  }

  if (resortsToCheck.length === 0) {
    console.log('\n✅ No resorts need checking at this time\n');
    return;
  }

  console.log(`\n✓ Will check ${resortsToCheck.length} resort(s)`);

  // Separate resorts by API provider
  const aspenResorts = resortsToCheck.filter(r => r.apiProvider === 'aspensnowmass');
  const reportpalResorts = resortsToCheck.filter(r => r.apiProvider === 'reportpal');
  const zanerayResorts = resortsToCheck.filter(r => r.apiProvider === 'zaneray');
  const dorResorts = resortsToCheck.filter(r => r.apiProvider === 'dor');
  const inspectorResorts = resortsToCheck.filter(r => !r.apiProvider || r.apiProvider === 'inspector');

  // Scrape Inspector resorts
  const scrapedData = await scrapeLiftData(inspectorResorts);

  // Scrape Aspen resorts
  const timestamp = new Date().toISOString();
  for (const resort of aspenResorts) {
    const mountainId = resort.apiConfig?.mountainId;
    if (!mountainId) {
      console.error(`\n⚠️  ${resort.name}: No mountainId configured for Aspen API`);
      continue;
    }

    console.log(`\n[${resort.name}] (Aspen API)`);
    try {
      const aspenData = await fetchAspenData(mountainId);
      const result = saveAspenLiftData(resort.key, aspenData, timestamp);
      scrapedData.push({ resortKey: resort.key, ...result });
    } catch (error) {
      console.error(`❌ ${resort.name}: ${error.message}`);
    }
  }

  // Scrape ReportPal resorts (Big Sky, Sugarloaf, Sunday River, Loon, Cypress)
  for (const resort of reportpalResorts) {
    if (!resort.apiConfig?.baseUrl || !resort.apiConfig?.resortCode) {
      console.error(`\n⚠️  ${resort.name}: No apiConfig (baseUrl/resortCode) for ReportPal API`);
      continue;
    }

    console.log(`\n[${resort.name}] (ReportPal API)`);
    try {
      const reportpalData = await fetchReportPalData(resort);
      const result = saveReportPalLiftData(resort.key, reportpalData, timestamp);
      scrapedData.push({ resortKey: resort.key, ...result });
    } catch (error) {
      console.error(`❌ ${resort.name}: ${error.message}`);
    }
  }

  // Scrape Zaneray resorts (Jackson Hole)
  for (const resort of zanerayResorts) {
    if (!resort.apiConfig?.apiUrl) {
      console.error(`\n⚠️  ${resort.name}: No apiConfig.apiUrl for Zaneray API`);
      continue;
    }

    console.log(`\n[${resort.name}] (Zaneray API)`);
    try {
      const zanerayData = await fetchZanerayData(resort);
      const result = saveZanerayLiftData(resort.key, zanerayData, timestamp);
      scrapedData.push({ resortKey: resort.key, ...result });
    } catch (error) {
      console.error(`❌ ${resort.name}: ${error.message}`);
    }
  }

  // Scrape DOR resorts (Snowbird, Copper, Killington)
  for (const resort of dorResorts) {
    if (!resort.apiConfig?.baseUrl || !resort.apiConfig?.endpoint) {
      console.error(`\n⚠️  ${resort.name}: No apiConfig (baseUrl/endpoint) for DOR API`);
      continue;
    }

    console.log(`\n[${resort.name}] (DOR API)`);
    try {
      const dorData = await fetchDorData(resort);
      const result = saveDorLiftData(resort.key, dorData, timestamp);
      scrapedData.push({ resortKey: resort.key, ...result });
    } catch (error) {
      console.error(`❌ ${resort.name}: ${error.message}`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 SUMMARY');
  console.log('='.repeat(80));

  const totalLifts = scrapedData.reduce((sum, r) => sum + r.liftCount, 0);
  const resortsWithOpenLifts = scrapedData.filter(r => r.hasOpenLifts).length;

  console.log(`Resorts checked: ${scrapedData.length}`);
  console.log(`Total lift records: ${totalLifts}`);
  console.log(`Resorts with open lifts: ${resortsWithOpenLifts}`);
  console.log('='.repeat(80));

  console.log('\n✅ Ikon lift scraping complete!\n');
}

main();
