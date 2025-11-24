// lift-scraper.js - Real-time lift wait-time tracker
// Runs frequently (every 5 minutes by default) to capture lift status and wait times
// Only records data during lift operating hours

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { formatInTimeZone } = require('date-fns-tz');

// Load configuration
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const RESORTS = config.resorts.reduce((acc, resort) => {
  acc[resort.key] = resort;
  return acc;
}, {});

/**
 * Get all resorts that are currently in season
 * This automatically scales - no need to manually maintain a list
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
 * Discovery mode: 7:15 AM - 10:00 AM local time
 * During this window, we check ALL in-season resorts to find which are opening
 */
function isInDiscoveryWindow(timezone) {
  const { hour, minute } = getResortLocalHourMinute(timezone);
  const currentMinutes = hour * 60 + minute;

  const discoveryStart = 7 * 60 + 15; // 7:15 AM
  const discoveryEnd = 10 * 60; // 10:00 AM

  return currentMinutes >= discoveryStart && currentMinutes < discoveryEnd;
}

/**
 * Load the active resort cache for today
 * Returns a Set of resort keys that have shown activity today
 */
function loadActiveResortCache() {
  const today = new Date().toISOString().split('T')[0];
  const cacheDir = path.join('cache');
  const cachePath = path.join(cacheDir, `active-resorts-${today}.json`);

  if (!fs.existsSync(cachePath)) {
    return new Set();
  }

  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return new Set(data.resorts || []);
  } catch (error) {
    console.log(`⚠️  Could not read active resort cache: ${error.message}`);
    return new Set();
  }
}

/**
 * Save a resort to the active cache for today
 */
function addToActiveResortCache(resortKey) {
  const today = new Date().toISOString().split('T')[0];
  const cacheDir = path.join('cache');
  const cachePath = path.join(cacheDir, `active-resorts-${today}.json`);

  ensureDirectoryExists(cacheDir);

  // Load existing cache
  let cache = { date: today, resorts: [] };
  if (fs.existsSync(cachePath)) {
    try {
      cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch (error) {
      // Ignore, will create new cache
    }
  }

  // Add resort if not already in cache
  if (!cache.resorts.includes(resortKey)) {
    cache.resorts.push(resortKey);
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
  }
}

/**
 * Check if current time is in "dead hours" when ski resorts are definitely closed
 * Dead hours: 6 PM - 7 AM local time (no ski resorts operate during these hours)
 * This check is timezone-aware - uses the resort's local time
 */
function isInDeadHours(timezone) {
  const { hour } = getResortLocalHourMinute(timezone);
  // Dead hours: 6 PM (18:00) to 7 AM (07:00) in the resort's local timezone
  return hour >= 18 || hour < 7;
}

/**
 * Systematic multi-tier resort filtering for scalability
 *
 * TIER 1: Dead Hours (6 PM - 7 AM local) - Skip ALL resorts
 * TIER 2: Discovery Window (7:15 AM - 10 AM local) - Check ALL in-season resorts
 * TIER 3: Active Cache - Resort confirmed operational today
 * TIER 4: Operating Hours - Use actual lift times from prior data
 *
 * All checks are timezone-aware using each resort's local time
 */
function shouldCheckResort(resortKey, resort, activeCache) {
  const timezone = resort.timezone;

  // TIER 1: Dead hours - no ski resort operates 6 PM - 7 AM (local time)
  // This is the first check to quickly filter out resorts that are definitely closed
  if (isInDeadHours(timezone)) {
    return { shouldCheck: false, reason: 'dead_hours', tier: 1 };
  }

  // TIER 2: Discovery window (7:15 AM - 10 AM local time)
  // During this window, check ALL in-season resorts to discover which are opening
  // This runs once per day in each resort's morning to detect new openings
  if (isInDiscoveryWindow(timezone)) {
    return { shouldCheck: true, reason: 'discovery_window', tier: 2 };
  }

  // TIER 3: Active cache - resort has shown lift activity today
  // Once a resort shows open lifts, we cache it and keep checking throughout the day
  if (activeCache.has(resortKey)) {
    return { shouldCheck: true, reason: 'active_cache', tier: 3 };
  }

  // TIER 4: Operating hours from prior lift data
  // Check if we have recent data showing lifts were open/scheduled
  // Use actual open/close times with buffers to determine if we should check now
  const localDate = getResortLocalDate(timezone);
  const liftsDir = path.join('data', resortKey, 'lifts');
  const todayFile = path.join(liftsDir, `${localDate}.ndjson`);

  if (!fs.existsSync(todayFile)) {
    return { shouldCheck: false, reason: 'no_prior_data', tier: 4 };
  }

  try {
    // Read the most recent lift data from today
    const lines = fs.readFileSync(todayFile, 'utf8').trim().split('\n');
    if (lines.length === 0) {
      return { shouldCheck: false, reason: 'empty_data', tier: 4 };
    }

    // Parse the last record to get most recent status
    const lastRecord = JSON.parse(lines[lines.length - 1]);

    // If we saw activity recently, keep checking if within operating window
    if (lastRecord.status === 'Open' || lastRecord.status === 'Scheduled') {
      // Check if we're within operating window (with 30 min before, 15 min after buffers)
      if (lastRecord.openTime && lastRecord.closeTime) {
        const openMinutes = timeToMinutes(lastRecord.openTime) - 30; // 30 min before
        const closeMinutes = timeToMinutes(lastRecord.closeTime) + 15; // 15 min after
        const currentMinutes = timeToMinutes(getResortLocalTime(timezone));

        if (currentMinutes >= openMinutes && currentMinutes <= closeMinutes) {
          return { shouldCheck: true, reason: 'within_operating_hours', tier: 4 };
        }
      }
    }

    return { shouldCheck: false, reason: 'outside_operating_hours', tier: 4 };
  } catch (error) {
    // If we can't read data, err on the side of checking
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

  // Get season dates (use resort-specific or defaults)
  const seasonStart = resort.seasonStart || config.schedule.defaultSeasonStart;
  const seasonEnd = resort.seasonEnd || config.schedule.defaultSeasonEnd;

  const [startMonth, startDay] = seasonStart.split('-').map(Number);
  const [endMonth, endDay] = seasonEnd.split('-').map(Number);

  // Ski seasons span two calendar years (e.g., Nov 2024 - May 2025)
  let seasonStartYear, seasonEndYear;

  if (currentMonth >= startMonth) {
    // We're in the second half of the year (e.g., Nov-Dec)
    seasonStartYear = currentYear;
    seasonEndYear = currentYear + 1;
  } else {
    // We're in the first half of the year (e.g., Jan-Jun)
    seasonStartYear = currentYear - 1;
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
 * Check if current time is within lift operating hours
 * Uses the earliest open time and latest close time from all lifts
 */
function getLiftOperatingWindow(lifts, timezone) {
  if (!lifts || lifts.length === 0) {
    return { isOpen: false, reason: 'No lift data available' };
  }

  // Extract open and close times from all lifts
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

  // Get the operating window (earliest open to latest close)
  const minOpenMinutes = Math.min(...openTimes);
  const maxCloseMinutes = Math.max(...closeTimes);

  // Get current time in resort's timezone
  const now = new Date();
  const localTimeStr = formatInTimeZone(now, timezone, 'HH:mm');
  const currentMinutes = timeToMinutes(localTimeStr);

  const isOpen = currentMinutes >= minOpenMinutes && currentMinutes <= maxCloseMinutes;

  return {
    isOpen,
    openTime: `${Math.floor(minOpenMinutes / 60).toString().padStart(2, '0')}:${(minOpenMinutes % 60).toString().padStart(2, '0')}`,
    closeTime: `${Math.floor(maxCloseMinutes / 60).toString().padStart(2, '0')}:${(maxCloseMinutes % 60).toString().padStart(2, '0')}`,
    currentTime: localTimeStr,
    reason: isOpen ? 'Within operating hours' : `Outside operating hours (${localTimeStr} not in ${Math.floor(minOpenMinutes/60)}:${String(minOpenMinutes%60).padStart(2,'0')} - ${Math.floor(maxCloseMinutes/60)}:${String(maxCloseMinutes%60).padStart(2,'0')})`
  };
}

/**
 * Ensure directory exists, create if not
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Append a lift record to the NDJSON file for today
 */
function appendLiftRecord(resortKey, localDate, record) {
  const liftsDir = path.join('data', resortKey, 'lifts');
  ensureDirectoryExists(liftsDir);

  const filePath = path.join(liftsDir, `${localDate}.ndjson`);
  const line = JSON.stringify(record) + '\n';

  fs.appendFileSync(filePath, line, 'utf8');
}

/**
 * Scrape lift data from a resort
 * Reuses the same terrain scraping logic to get lift information
 */
async function scrapeLiftData(resortKey, url) {
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
    const page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Try loading with a more lenient wait strategy
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (e) {
      console.log(`  ⚠️  Initial load issue: ${e.message}`);
    }

    // Give the page extra time to settle (randomized 2-5 seconds)
    const settleTime = 2000 + Math.floor(Math.random() * 3000);
    await new Promise(resolve => setTimeout(resolve, settleTime));

    // Wait for the FR object to be available
    await page.waitForFunction(
      () => typeof FR !== 'undefined' && FR.TerrainStatusFeed,
      { timeout: 45000 }
    ).catch(() => {
      throw new Error('FR.TerrainStatusFeed not found');
    });

    // Extract just the Lifts data
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
    await browser.close();
  }
}

/**
 * Process and record lift data for a single resort
 */
async function processResort(resortKey) {
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

  // Check if resort is in season
  if (!isResortInSeason(resort)) {
    console.log(`  ⏭️  Out of season - skipping`);
    return { resortKey, status: 'out_of_season', liftsRecorded: 0 };
  }

  // Check if resort has terrain URL
  const terrainUrl = resort.terrainUrl || resort.url;
  if (!terrainUrl) {
    console.log(`  ❌ No terrain URL configured - skipping`);
    return { resortKey, status: 'no_url', liftsRecorded: 0 };
  }

  // Scrape lift data
  console.log(`  📡 Fetching lift data...`);
  let liftData;
  try {
    liftData = await scrapeLiftData(resortKey, terrainUrl);
  } catch (error) {
    console.log(`  ❌ Error scraping: ${error.message}`);
    return { resortKey, status: 'scrape_error', liftsRecorded: 0, error: error.message };
  }

  if (!liftData || !liftData.Lifts || liftData.Lifts.length === 0) {
    console.log(`  ⚠️  No lift data available`);
    return { resortKey, status: 'no_data', liftsRecorded: 0 };
  }

  console.log(`  ✓ Found ${liftData.Lifts.length} lifts`);

  // Check if we're within operating hours
  const operatingWindow = getLiftOperatingWindow(liftData.Lifts, resort.timezone);

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
  console.log(`  ✅ Within operating hours - recording data`);

  // Record each lift's current state
  const timestamp = new Date().toISOString();
  const localDate = getResortLocalDate(resort.timezone);
  const localTimeStr = getResortLocalTime(resort.timezone);

  let liftsWithWaitTimes = 0;
  let closedLifts = 0;
  let openLifts = 0;

  for (const lift of liftData.Lifts) {
    // Create lift record
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

    // Append to NDJSON file
    appendLiftRecord(resortKey, localDate, record);

    // Track statistics
    if (lift.WaitTimeInMinutes && lift.WaitTimeInMinutes > 0) {
      liftsWithWaitTimes++;
    }

    if (lift.Status === 'Open') {
      openLifts++;
    } else if (lift.Status === 'Closed') {
      closedLifts++;
    }
  }

  // Print summary
  console.log(`  📊 Summary:`);
  console.log(`     • ${openLifts} lifts open`);
  if (closedLifts > 0) {
    console.log(`     • ${closedLifts} lifts closed`);
  }
  if (liftsWithWaitTimes > 0) {
    console.log(`     • ${liftsWithWaitTimes} lifts with wait times`);
  }
  console.log(`  💾 Saved ${liftData.Lifts.length} lift records to ${localDate}.ndjson`);

  // Add resort to active cache if we recorded data with open lifts
  if (openLifts > 0) {
    addToActiveResortCache(resortKey);
    console.log(`  ✓ Added to active resort cache`);
  }

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
 * Main function - process all in-season resorts
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     🎿 Real-Time Lift Wait-Time Tracker 🎿                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n⏱️  Run started at ${new Date().toISOString()}`);

  // Load active resort cache for today
  const activeCache = loadActiveResortCache();
  console.log(`📦 Active resort cache: ${activeCache.size} resorts from earlier today`);

  // Automatically get all resorts that are in season
  const inSeasonResorts = getInSeasonResorts();

  // Filter resorts based on multi-tier systematic checks
  // TIER 1: Dead hours (6 PM - 7 AM local)
  // TIER 2: Discovery window (7:15 AM - 10 AM local)
  // TIER 3: Active cache (resort operational today)
  // TIER 4: Operating hours (from actual lift data)
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

  // Randomize resort order to avoid predictable scraping patterns
  const resortKeys = resortsToCheck
    .map(r => r.resort.key)
    .sort(() => Math.random() - 0.5);

  console.log(`📍 Found ${inSeasonResorts.length} in-season resorts (out of ${config.resorts.length} total)`);
  console.log(`✅ Checking ${resortsToCheck.length} resorts`);
  if (resortsSkipped.length > 0) {
    console.log(`⏭️  Skipping ${resortsSkipped.length} resorts`);

    // Group skipped resorts by reason for better visibility
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

    // Show check reasons
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

  // Process resorts in parallel batches to speed up execution
  // Randomize batch size between 3-7 resorts to vary traffic patterns
  const BATCH_SIZE = 3 + Math.floor(Math.random() * 5);

  for (let i = 0; i < resortKeys.length; i += BATCH_SIZE) {
    const batch = resortKeys.slice(i, i + BATCH_SIZE);
    console.log(`\n📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(resortKeys.length / BATCH_SIZE)} (${batch.length} resorts in parallel)...`);

    // Process this batch in parallel
    const batchPromises = batch.map(async (resortKey) => {
      try {
        return await processResort(resortKey);
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

  // Print final summary
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
}

// Run the scraper
main().catch(error => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
