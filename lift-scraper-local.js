// lift-scraper-local.js - Local high-frequency lift tracking
// Identical logic to lift-scraper.js but writes to data-local/ to avoid conflicts with GitHub Actions
// Uses the same smart multi-tier filtering to avoid scraping closed resorts

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { formatInTimeZone } = require('date-fns-tz');

// Use local data directory (separate from GitHub Actions)
const DATA_DIR = 'data-local';
const CACHE_DIR = 'cache-local';

// Load configuration
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const RESORTS = config.resorts.reduce((acc, resort) => {
  acc[resort.key] = resort;
  return acc;
}, {});

/**
 * Get all resorts that are currently in season
 */
function getInSeasonResorts() {
  return config.resorts.filter(resort => isResortInSeason(resort));
}

/**
 * Get current date in YYYY-MM-DD format for a specific timezone
 */
function getResortLocalDate(timezone) {
  const now = new Date();
  return formatInTimeZone(now, timezone, 'yyyy-MM-dd');
}

/**
 * Get current time formatted for display in a specific timezone
 */
function getResortLocalTime(timezone) {
  const now = new Date();
  return formatInTimeZone(now, timezone, 'HH:mm:ss');
}

/**
 * Get current time formatted for logging in a specific timezone
 */
function getResortLocalTimeFormatted(timezone) {
  const now = new Date();
  return formatInTimeZone(now, timezone, 'h:mm a zzz');
}

/**
 * Get current hour and minute in a specific timezone
 */
function getResortLocalHourMinute(timezone) {
  const now = new Date();
  const hour = parseInt(formatInTimeZone(now, timezone, 'H'));
  const minute = parseInt(formatInTimeZone(now, timezone, 'm'));
  return { hour, minute };
}

/**
 * Check if we're in discovery mode for a resort
 * Discovery mode: 7:00 AM - 12:00 PM local time
 */
function isInDiscoveryWindow(timezone) {
  const { hour, minute } = getResortLocalHourMinute(timezone);
  const currentMinutes = hour * 60 + minute;

  const discoveryStart = 7 * 60; // 7:00 AM
  const discoveryEnd = 12 * 60; // 12:00 PM (noon)

  return currentMinutes >= discoveryStart && currentMinutes < discoveryEnd;
}

/**
 * Load the active resort cache (local version)
 */
function loadActiveResortCache() {
  const cachePath = path.join(CACHE_DIR, 'active-resorts.json');

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
    console.log(`⚠️  Could not read active resort cache: ${error.message}`);
    return new Map();
  }
}

/**
 * Save a resort to the active cache (local version)
 */
function addToActiveResortCache(resortKey, timezone) {
  const localDate = getResortLocalDate(timezone);
  const cachePath = path.join(CACHE_DIR, 'active-resorts.json');

  ensureDirectoryExists(CACHE_DIR);

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
 * Check if current time is in "dead hours" when ski resorts are definitely closed
 * Dead hours: 6 PM - 7 AM local time
 */
function isInDeadHours(timezone) {
  const { hour } = getResortLocalHourMinute(timezone);
  return hour >= 18 || hour < 7;
}

/**
 * Systematic multi-tier resort filtering for scalability
 *
 * TIER 1: Dead Hours (6 PM - 7 AM local) - Skip ALL resorts
 * TIER 2: Discovery Window (7:00 AM - 12:00 PM local) - Check ALL in-season resorts
 * TIER 3: Active Cache - Resort confirmed operational today
 * TIER 4: Operating Hours - Use actual lift times from prior data
 */
function shouldCheckResort(resortKey, resort, activeCache) {
  const timezone = resort.timezone;
  const localDate = getResortLocalDate(timezone);

  // TIER 1: Dead hours - no ski resort operates 6 PM - 7 AM (local time)
  if (isInDeadHours(timezone)) {
    return { shouldCheck: false, reason: 'dead_hours', tier: 1 };
  }

  // TIER 2: Discovery window (7:00 AM - 12:00 PM local time)
  if (isInDiscoveryWindow(timezone)) {
    return { shouldCheck: true, reason: 'discovery_window', tier: 2 };
  }

  // TIER 3: Active cache - resort has shown lift activity today
  if (activeCache.has(resortKey)) {
    const cachedDate = activeCache.get(resortKey);
    if (cachedDate === localDate) {
      return { shouldCheck: true, reason: 'active_cache', tier: 3 };
    }
  }

  // TIER 4: Operating hours from prior lift data
  // Check local data first, fall back to GitHub Actions data
  const localLiftsDir = path.join(DATA_DIR, resortKey, 'lifts');
  const githubLiftsDir = path.join('data', resortKey, 'lifts');
  const todayFile = `${localDate}.ndjson`;

  let liftsDir = null;
  if (fs.existsSync(path.join(localLiftsDir, todayFile))) {
    liftsDir = localLiftsDir;
  } else if (fs.existsSync(path.join(githubLiftsDir, todayFile))) {
    liftsDir = githubLiftsDir;
  }

  if (!liftsDir) {
    return { shouldCheck: false, reason: 'no_prior_data', tier: 4 };
  }

  try {
    const filePath = path.join(liftsDir, todayFile);
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
    if (lines.length === 0) {
      return { shouldCheck: false, reason: 'empty_data', tier: 4 };
    }

    // Get the most recent timestamp
    const lastRecord = JSON.parse(lines[lines.length - 1]);
    const lastTimestamp = lastRecord.timestamp;

    // Get ALL records from the most recent scrape (same timestamp)
    const recentRecords = lines
      .map(line => JSON.parse(line))
      .filter(record => record.timestamp === lastTimestamp);

    // Find any lifts that are Open or Scheduled
    const openLifts = recentRecords.filter(r =>
      (r.status === 'Open' || r.status === 'Scheduled') &&
      r.openTime && r.closeTime
    );

    if (openLifts.length > 0) {
      // Get the earliest open time and latest close time from all open lifts
      const openTimes = openLifts.map(r => timeToMinutes(r.openTime));
      const closeTimes = openLifts.map(r => timeToMinutes(r.closeTime));

      const earliestOpen = Math.min(...openTimes) - 30; // 30 min before
      const latestClose = Math.max(...closeTimes) + 60; // 60 min after
      const currentMinutes = timeToMinutes(getResortLocalTime(timezone));

      if (currentMinutes >= earliestOpen && currentMinutes <= latestClose) {
        return { shouldCheck: true, reason: 'within_operating_hours', tier: 4 };
      }
    }

    return { shouldCheck: false, reason: 'outside_operating_hours', tier: 4 };
  } catch (error) {
    return { shouldCheck: true, reason: 'data_read_error', tier: 4 };
  }
}

/**
 * Check if a resort is currently in season
 */
function isResortInSeason(resort) {
  const timezone = resort.timezone;
  const localDate = getResortLocalDate(timezone);
  const [currentYear, currentMonth, currentDay] = localDate.split('-').map(Number);

  const seasonStart = resort.seasonStart || config.schedule.defaultSeasonStart;
  const seasonEnd = resort.seasonEnd || config.schedule.defaultSeasonEnd;

  const [startMonth, startDay] = seasonStart.split('-').map(Number);
  const [endMonth, endDay] = seasonEnd.split('-').map(Number);

  const seasonCrossesYear = startMonth > endMonth || (startMonth === endMonth && startDay > endDay);

  let seasonStartYear;
  let seasonEndYear;

  if (seasonCrossesYear) {
    if (currentMonth >= startMonth) {
      seasonStartYear = currentYear;
      seasonEndYear = currentYear + 1;
    } else {
      seasonStartYear = currentYear - 1;
      seasonEndYear = currentYear;
    }
  } else {
    seasonStartYear = currentYear;
    seasonEndYear = currentYear;
  }

  const seasonStartDate = new Date(seasonStartYear, startMonth - 1, startDay);
  const seasonEndDate = new Date(seasonEndYear, endMonth - 1, endDay);
  const currentDate = new Date(currentYear, currentMonth - 1, currentDay);

  return currentDate >= seasonStartDate && currentDate < seasonEndDate;
}

/**
 * Convert time string (HH:mm) to minutes since midnight
 */
function timeToMinutes(timeStr) {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Check if we have recent data showing lifts as "Open"
 */
function hasRecentOpenLifts(resortKey, timezone) {
  const localDate = getResortLocalDate(timezone);

  // Check local data first
  const localFile = path.join(DATA_DIR, resortKey, 'lifts', `${localDate}.ndjson`);
  const githubFile = path.join('data', resortKey, 'lifts', `${localDate}.ndjson`);

  const filePath = fs.existsSync(localFile) ? localFile :
                   fs.existsSync(githubFile) ? githubFile : null;

  if (!filePath) {
    return false;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(l => l.trim());

    if (lines.length === 0) {
      return false;
    }

    const lastLine = lines[lines.length - 1];
    const lastRecord = JSON.parse(lastLine);
    const lastTimestamp = lastRecord.timestamp;

    const lastScrapeRecords = lines
      .map(line => JSON.parse(line))
      .filter(record => record.timestamp === lastTimestamp);

    const hasOpenLifts = lastScrapeRecords.some(record => record.status === 'Open');

    return hasOpenLifts;
  } catch (error) {
    console.error(`  ⚠️  Error checking recent lift data: ${error.message}`);
    return false;
  }
}

/**
 * Check if current time is within lift operating hours
 */
function getLiftOperatingWindow(lifts, timezone, resortKey) {
  if (!lifts || lifts.length === 0) {
    return { isOpen: false, reason: 'No lift data available' };
  }

  const openTimes = lifts
    .map(l => l.OpenTime)
    .filter(Boolean)
    .map(timeToMinutes);

  const closeTimes = lifts
    .map(l => l.CloseTime)
    .filter(Boolean)
    .map(timeToMinutes);

  if (openTimes.length === 0 || closeTimes.length === 0) {
    return { isOpen: false, reason: 'No operating hours available' };
  }

  const minOpenMinutes = Math.min(...openTimes);
  const maxCloseMinutes = Math.max(...closeTimes);

  const now = new Date();
  const localTimeStr = formatInTimeZone(now, timezone, 'HH:mm');
  const currentMinutes = timeToMinutes(localTimeStr);

  const withinOperatingHours = currentMinutes >= minOpenMinutes && currentMinutes <= maxCloseMinutes;

  let isOpen = withinOperatingHours;
  let reason = '';

  if (withinOperatingHours) {
    reason = 'Within operating hours';
  } else if (currentMinutes < minOpenMinutes) {
    reason = `Before opening time (${localTimeStr} < ${Math.floor(minOpenMinutes/60)}:${String(minOpenMinutes%60).padStart(2,'0')})`;
  } else {
    const hasOpenLifts = hasRecentOpenLifts(resortKey, timezone);
    if (hasOpenLifts) {
      isOpen = true;
      reason = 'Past close time but lifts still showing as Open - continuing to capture status change';
    } else {
      reason = `Past close time and all lifts closed (${localTimeStr} > ${Math.floor(maxCloseMinutes/60)}:${String(maxCloseMinutes%60).padStart(2,'0')})`;
    }
  }

  return {
    isOpen,
    openTime: `${Math.floor(minOpenMinutes / 60).toString().padStart(2, '0')}:${(minOpenMinutes % 60).toString().padStart(2, '0')}`,
    closeTime: `${Math.floor(maxCloseMinutes / 60).toString().padStart(2, '0')}:${(maxCloseMinutes % 60).toString().padStart(2, '0')}`,
    currentTime: localTimeStr,
    reason
  };
}

/**
 * Ensure directory exists
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Append lift record to NDJSON file
 */
function appendLiftRecord(resortKey, localDate, record) {
  const liftsDir = path.join(DATA_DIR, resortKey, 'lifts');
  ensureDirectoryExists(liftsDir);

  const filePath = path.join(liftsDir, `${localDate}.ndjson`);
  const line = JSON.stringify(record) + '\n';

  fs.appendFileSync(filePath, line, 'utf8');
}

/**
 * Scrape lift data from a resort
 */
async function scrapeLiftData(resortKey, url, browser) {
  const page = await browser.newPage();

  try {
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (e) {
      console.log(`  ⚠️  Initial load issue: ${e.message}`);
    }

    const settleTime = 1000 + Math.floor(Math.random() * 2000);
    await new Promise(resolve => setTimeout(resolve, settleTime));

    await page.waitForFunction(
      () => typeof FR !== 'undefined' && FR.TerrainStatusFeed,
      { timeout: 45000 }
    ).catch(() => {
      throw new Error('FR.TerrainStatusFeed not found');
    });

    const data = await page.evaluate(() => {
      if (typeof FR !== 'undefined' && FR.TerrainStatusFeed) {
        return {
          Lifts: FR.TerrainStatusFeed.Lifts || [],
          Date: FR.TerrainStatusFeed.Date
        };
      }
      return null;
    });

    return data;

  } finally {
    await page.close();
  }
}

/**
 * Process and record lift data for a single resort
 */
async function processResort(resortKey, browser) {
  const resort = RESORTS[resortKey];

  if (!resort) {
    console.log(`❌ Unknown resort: ${resortKey}`);
    return null;
  }

  const resortName = resort.name;
  const localTime = getResortLocalTimeFormatted(resort.timezone);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`🎿 ${resortName} (${localTime})`);
  console.log('─'.repeat(60));

  if (!isResortInSeason(resort)) {
    console.log(`  ⏭️  Out of season - skipping`);
    return { resortKey, status: 'out_of_season', liftsRecorded: 0 };
  }

  const terrainUrl = resort.terrainUrl || resort.url;
  if (!terrainUrl) {
    console.log(`  ❌ No terrain URL configured - skipping`);
    return { resortKey, status: 'no_url', liftsRecorded: 0 };
  }

  console.log(`  📡 Fetching lift data...`);
  let liftData;
  try {
    liftData = await scrapeLiftData(resortKey, terrainUrl, browser);
  } catch (error) {
    console.log(`  ❌ Error scraping: ${error.message}`);
    return { resortKey, status: 'scrape_error', liftsRecorded: 0, error: error.message };
  }

  if (!liftData || !liftData.Lifts || liftData.Lifts.length === 0) {
    console.log(`  ⚠️  No lift data available`);
    return { resortKey, status: 'no_data', liftsRecorded: 0 };
  }

  console.log(`  ✓ Found ${liftData.Lifts.length} lifts`);

  const operatingWindow = getLiftOperatingWindow(liftData.Lifts, resort.timezone, resortKey);

  if (!operatingWindow.isOpen) {
    console.log(`  🌙 ${operatingWindow.reason}`);
    return {
      resortKey,
      status: 'outside_hours',
      liftsRecorded: 0,
      window: operatingWindow
    };
  }

  console.log(`  ⏰ Operating hours: ${operatingWindow.openTime} - ${operatingWindow.closeTime}`);
  console.log(`  ✅ ${operatingWindow.reason} - recording data`);

  const timestamp = new Date().toISOString();
  const localDate = getResortLocalDate(resort.timezone);
  const localTimeStr = getResortLocalTime(resort.timezone);

  let liftsWithWaitTimes = 0;
  let closedLifts = 0;
  let openLifts = 0;

  for (const lift of liftData.Lifts) {
    const record = {
      timestamp,
      localTime: localTimeStr,
      resort: resortKey,
      liftId: lift.SortOrder?.toString() || null,
      name: lift.Name,
      status: lift.Status,
      type: lift.Type,
      waitMinutes: lift.WaitTimeInMinutes,
      capacity: lift.Capacity,
      mountain: lift.Mountain,
      openTime: lift.OpenTime,
      closeTime: lift.CloseTime
    };

    appendLiftRecord(resortKey, localDate, record);

    if (lift.WaitTimeInMinutes && lift.WaitTimeInMinutes > 0) {
      liftsWithWaitTimes++;
    }

    if (lift.Status === 'Open') {
      openLifts++;
    } else if (lift.Status === 'Closed') {
      closedLifts++;
    }
  }

  console.log(`  📊 Summary:`);
  console.log(`     • ${openLifts} lifts open`);
  if (closedLifts > 0) {
    console.log(`     • ${closedLifts} lifts closed`);
  }
  if (liftsWithWaitTimes > 0) {
    console.log(`     • ${liftsWithWaitTimes} lifts with wait times`);
  }
  console.log(`  💾 Saved ${liftData.Lifts.length} lift records to ${localDate}.ndjson`);

  addToActiveResortCache(resortKey, resort.timezone);
  console.log(`  ✓ Added to active resort cache (${localDate})`);

  return {
    resortKey,
    status: 'success',
    liftsRecorded: liftData.Lifts.length,
    openLifts,
    closedLifts,
    liftsWithWaitTimes,
    localTime: operatingWindow.currentTime
  };
}

/**
 * Main function - process all in-season resorts with smart filtering
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     🎿 Local Lift Tracker (High-Frequency) 🎿            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n📂 Data directory: ${DATA_DIR}/`);
  console.log(`📦 Cache directory: ${CACHE_DIR}/`);
  console.log(`⏱️  Run started at ${new Date().toISOString()}`);

  console.log('🌐 Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  });

  try {
    const activeCache = loadActiveResortCache();
    console.log(`📦 Active resort cache: ${activeCache.size} resorts from earlier today`);

    const inSeasonResorts = getInSeasonResorts();

    // Use the SAME multi-tier filtering as the main scraper
    const resortsToCheck = [];
    const resortsSkipped = [];

    for (const resort of inSeasonResorts) {
      const checkDecision = shouldCheckResort(resort.key, resort, activeCache);

      if (checkDecision.shouldCheck) {
        resortsToCheck.push({ resort, reason: checkDecision.reason, tier: checkDecision.tier });
      } else {
        resortsSkipped.push({ resort, reason: checkDecision.reason, tier: checkDecision.tier });
      }
    }

    const resortKeys = resortsToCheck
      .map(r => r.resort.key)
      .sort(() => Math.random() - 0.5);

    console.log(`📍 Found ${inSeasonResorts.length} in-season resorts (out of ${config.resorts.length} total)`);
    console.log(`✅ Checking ${resortsToCheck.length} resorts`);
    if (resortsSkipped.length > 0) {
      console.log(`⏭️  Skipping ${resortsSkipped.length} resorts`);

      const skipReasons = {};
      resortsSkipped.forEach(s => {
        if (!skipReasons[s.reason]) {
          skipReasons[s.reason] = [];
        }
        skipReasons[s.reason].push(s.resort.name);
      });

      Object.entries(skipReasons).forEach(([reason, resorts]) => {
        console.log(`   • ${reason}: ${resorts.length} resorts`);
      });
    }

    if (resortsToCheck.length > 0) {
      console.log(`🎿 Will check: ${resortKeys.join(', ')}`);

      const checkReasons = {};
      resortsToCheck.forEach(c => {
        if (!checkReasons[c.reason]) {
          checkReasons[c.reason] = [];
        }
        checkReasons[c.reason].push(c.resort.name);
      });

      Object.entries(checkReasons).forEach(([reason, resorts]) => {
        console.log(`   • ${reason}: ${resorts.length} resorts`);
      });
    }

    const results = [];

    // Smaller batch size for continuous local scraping
    const BATCH_SIZE = 10 + Math.floor(Math.random() * 6);

    for (let i = 0; i < resortKeys.length; i += BATCH_SIZE) {
      const batch = resortKeys.slice(i, i + BATCH_SIZE);
      console.log(`\n📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(resortKeys.length / BATCH_SIZE)} (${batch.length} resorts in parallel)...`);

      const batchPromises = batch.map(async (resortKey) => {
        try {
          return await processResort(resortKey, browser);
        } catch (error) {
          console.log(`\n❌ Unexpected error processing ${resortKey}: ${error.message}`);
          return {
            resortKey,
            status: 'error',
            liftsRecorded: 0,
            error: error.message
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    console.log('\n' + '═'.repeat(60));
    console.log('📈 FINAL SUMMARY');
    console.log('═'.repeat(60));

    const successfulResorts = results.filter(r => r.status === 'success');
    const totalLiftsRecorded = results.reduce((sum, r) => sum + (r.liftsRecorded || 0), 0);

    console.log(`✅ Successfully recorded: ${successfulResorts.length}/${results.length} resorts`);
    console.log(`📊 Total lift snapshots: ${totalLiftsRecorded}`);

    if (successfulResorts.length > 0) {
      console.log(`\n🎿 Active resorts:`);
      successfulResorts.forEach(r => {
        const resort = RESORTS[r.resortKey];
        console.log(`   • ${resort.name}: ${r.liftsRecorded} lifts (${r.openLifts} open${r.liftsWithWaitTimes > 0 ? `, ${r.liftsWithWaitTimes} with waits` : ''})`);
      });
    }

    const skippedResorts = results.filter(r => r.status !== 'success');
    if (skippedResorts.length > 0) {
      console.log(`\n⏭️  Skipped/unavailable: ${skippedResorts.length} resorts`);
      skippedResorts.forEach(r => {
        const resort = RESORTS[r.resortKey];
        const reason = r.status === 'outside_hours' ? 'outside operating hours' :
                       r.status === 'out_of_season' ? 'out of season' :
                       r.status === 'no_url' ? 'no URL configured' :
                       r.status === 'no_data' ? 'no lift data' :
                       r.status === 'scrape_error' ? `scrape error` :
                       'unknown error';
        console.log(`   • ${resort.name}: ${reason}`);
      });
    }

    console.log(`\n⏱️  Run completed at ${new Date().toISOString()}`);
    console.log('═'.repeat(60) + '\n');
  } finally {
    await browser.close();
    console.log('🌐 Browser closed');
  }
}

// Run the scraper
main().catch(error => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
