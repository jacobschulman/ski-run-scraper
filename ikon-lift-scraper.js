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

  // Get Ikon resorts
  const ikonResorts = configLoader.getResortsByProvider(config, 'ikon');

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

  // Scrape the resorts
  const scrapedData = await scrapeLiftData(resortsToCheck);

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
