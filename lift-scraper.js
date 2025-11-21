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

    // Give the page extra time to settle
    await new Promise(resolve => setTimeout(resolve, 3000));

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

  // Automatically get all resorts that are in season
  const inSeasonResorts = getInSeasonResorts();
  const resortKeys = inSeasonResorts.map(r => r.key);

  console.log(`📍 Found ${inSeasonResorts.length} in-season resorts (out of ${config.resorts.length} total)`);
  console.log(`🎿 Checking: ${resortKeys.join(', ')}`);

  const results = [];

  // Process resorts in parallel batches to speed up execution
  // Process 5 resorts at a time to balance speed vs resource usage
  const BATCH_SIZE = 5;

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
