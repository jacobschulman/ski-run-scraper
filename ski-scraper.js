// ski-scraper.js - Multi-resort grooming data extractor using Puppeteer
// Now with historical data tracking and configurable resorts

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { formatInTimeZone, toZonedTime } = require('date-fns-tz');
const {
  initializeDatabase,
  getOrCreateResort,
  saveTerrainStatus,
  saveSnowConditions,
  closeDatabase
} = require('./database');

// Load configuration
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const RESORTS = config.resorts.reduce((acc, resort) => {
  acc[resort.key] = resort;
  return acc;
}, {});

// Initialize database connection
let db = null;
function getDb() {
  if (!db) {
    db = initializeDatabase();
  }
  return db;
}

/**
 * Check if we're past the season end date
 * Ski seasons span two calendar years (Nov-May), so we need to check:
 * - If current month >= July: season ends next year
 * - If current month < July: season ends this year
 */
function isSeasonActive() {
  const now = new Date();
  const [endMonth, endDay] = config.season.endDate.split('-').map(Number);

  // If we're in the second half of the year (July onwards),
  // the season ends in the next calendar year
  const seasonEndYear = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  const seasonEndDate = new Date(seasonEndYear, endMonth - 1, endDay);

  return now < seasonEndDate;
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDate() {
  const now = new Date();
  return now.toISOString().split('T')[0];
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
 * Get current date in YYYY-MM-DD format for a specific timezone
 */
function getResortLocalDate(timezone) {
  const now = new Date();
  return formatInTimeZone(now, timezone, 'yyyy-MM-dd');
}

/**
 * Get current hour (0-23) in a specific timezone
 */
function getResortLocalHour(timezone) {
  const now = new Date();
  return parseInt(formatInTimeZone(now, timezone, 'H'));
}

/**
 * Get current time formatted for display in a specific timezone
 */
function getResortLocalTimeFormatted(timezone) {
  const now = new Date();
  return formatInTimeZone(now, timezone, 'h:mm a zzz');
}

/**
 * Check if a resort is currently in season
 * Uses resort-specific seasonStart/seasonEnd or falls back to defaults from config
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
  // Determine which year the season started and ends
  let seasonStartYear, seasonEndYear;

  if (currentMonth >= startMonth) {
    // We're in the second half of the year (e.g., Nov-Dec)
    // Season started this year, ends next year
    seasonStartYear = currentYear;
    seasonEndYear = currentYear + 1;
  } else {
    // We're in the first half of the year (e.g., Jan-Jun)
    // Season started last year, ends this year
    seasonStartYear = currentYear - 1;
    seasonEndYear = currentYear;
  }

  const seasonStartDate = new Date(seasonStartYear, startMonth - 1, startDay);
  const seasonEndDate = new Date(seasonEndYear, endMonth - 1, endDay);
  const currentDate = new Date(currentYear, currentMonth - 1, currentDay);

  return currentDate >= seasonStartDate && currentDate < seasonEndDate;
}

/**
 * Check if a resort has already been scraped today
 * Checks in the resort's local timezone
 */
function hasBeenScrapedToday(resort, dataType = 'terrain') {
  const localDate = getResortLocalDate(resort.timezone);
  const dataDir = path.join('data', resort.key, dataType);
  const todayFile = path.join(dataDir, `${localDate}.json`);

  return fs.existsSync(todayFile);
}

/**
 * Check if current time is within the scraping window for a resort
 */
function isInScrapingWindow(resort) {
  const currentHour = getResortLocalHour(resort.timezone);
  const targetHour = resort.targetHour !== undefined ? resort.targetHour : config.schedule.targetHour;
  const windowHours = config.schedule.scrapingWindowHours;

  // Check if current hour is within [targetHour, targetHour + windowHours)
  // e.g., if target is 7 and window is 3, allow 7, 8, 9
  return currentHour >= targetHour && currentHour < (targetHour + windowHours);
}

/**
 * Determine if a resort should be scraped for a specific data type
 * Logic: Scrape if in season, has URL, not scraped yet, and we're at or past the target hour
 * This allows catch-up scraping if a previous run was missed
 */
function shouldScrapeResort(resort, dataType = 'terrain') {
  const currentHour = getResortLocalHour(resort.timezone);
  const targetHour = resort.targetHour !== undefined ? resort.targetHour : config.schedule.targetHour;
  const hasBeenScraped = hasBeenScrapedToday(resort, dataType);

  const checks = {
    inSeason: isResortInSeason(resort),
    hasUrl: dataType === 'terrain' ? !!resort.terrainUrl : !!resort.snowReportUrl,
    notScraped: !hasBeenScraped,
    isPastTargetHour: currentHour >= targetHour
  };

  // Scrape if: in season, has URL, not scraped today, and at/past target hour
  // This allows scraping during the window (7-10 AM) AND catch-up scraping after the window if file doesn't exist
  return checks.inSeason && checks.hasUrl && checks.notScraped && checks.isPastTargetHour;
}

/**
 * Get detailed status for a resort (for logging)
 */
function getResortStatus(resort) {
  const localTime = getResortLocalTimeFormatted(resort.timezone);
  const inSeason = isResortInSeason(resort);
  const inWindow = isInScrapingWindow(resort);
  const terrainScraped = hasBeenScrapedToday(resort, 'terrain');
  const snowScraped = hasBeenScrapedToday(resort, 'snow');
  const currentHour = getResortLocalHour(resort.timezone);
  const targetHour = resort.targetHour !== undefined ? resort.targetHour : config.schedule.targetHour;
  const windowHours = config.schedule.scrapingWindowHours;

  return {
    localTime,
    inSeason,
    inWindow,
    terrainScraped,
    snowScraped,
    currentHour,
    targetHour,
    windowHours,
    shouldScrapeTerrain: shouldScrapeResort(resort, 'terrain'),
    shouldScrapeSnow: shouldScrapeResort(resort, 'snow')
  };
}

/**
 * Scrape grooming and lift data from a resort
 */
async function scrapeGroomingData(resortKey, url) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Scraping ${RESORTS[resortKey].name}...`);
  console.log('='.repeat(50));

  const browser = await puppeteer.launch({
    headless: 'new', // Use new headless mode
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

    console.log('Loading page...');

    // Try loading with a more lenient wait strategy
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (e) {
      console.log('Initial load issue:', e.message);
      // Try to continue anyway
    }

    // Give the page extra time to settle
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Wait for the script tag or FR object to be available
    console.log('Waiting for data to load...');
    await page.waitForFunction(
      () => typeof FR !== 'undefined' && FR.TerrainStatusFeed,
      { timeout: 45000 }
    ).catch(() => console.log('FR.TerrainStatusFeed not found via wait'));

    // Extract the FR.TerrainStatusFeed data (includes both trails and lifts)
    const data = await page.evaluate(() => {
      if (typeof FR !== 'undefined' && FR.TerrainStatusFeed) {
        return FR.TerrainStatusFeed;
      }
      return null;
    });

    return data;

  } finally {
    await browser.close();
  }
}

/**
 * Scrape snow report data from a resort
 */
async function scrapeSnowReport(resortKey, url) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Scraping Snow Report for ${RESORTS[resortKey].name}...`);
  console.log('='.repeat(50));

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

    console.log('Loading snow report page...');

    // Try loading with a more lenient wait strategy
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (e) {
      console.log('Initial load issue:', e.message);
      // Try to continue anyway
    }

    // Give the page extra time to settle
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Wait for the FR object to be available
    console.log('Waiting for snow data to load...');
    await page.waitForFunction(
      () => typeof FR !== 'undefined' && FR.snowReportData,
      { timeout: 45000 }
    ).catch(() => console.log('FR.snowReportData not found via wait'));

    // Extract the snow report data and forecast data
    const data = await page.evaluate(() => {
      if (typeof FR !== 'undefined' && FR.snowReportData) {
        return {
          snowReport: FR.snowReportData,
          forecasts: FR.forecasts || null
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
 * Save data in timestamped format and print summary
 */
function saveResortData(resortKey, data) {
  if (!data) {
    console.log('✗ Could not find FR.TerrainStatusFeed');
    return null;
  }

  const resortName = RESORTS[resortKey].name;
  const resortTimezone = RESORTS[resortKey].timezone || 'America/Denver';
  const today = getTodayDate();

  // Ensure data directory structure exists
  const terrainDir = path.join('data', resortKey, 'terrain');
  ensureDirectoryExists(terrainDir);

  // Save timestamped file
  const timestampedFile = path.join(terrainDir, `${today}.json`);
  fs.writeFileSync(timestampedFile, JSON.stringify(data, null, 2));
  console.log(`✓ Saved data to ${timestampedFile}`);

  // Save to database
  const database = getDb();
  getOrCreateResort(database, resortKey, resortName, resortTimezone, (err, resortId) => {
    if (err) {
      console.error('  ⚠️  Database error (resort):', err.message);
    } else {
      saveTerrainStatus(database, resortId, today, { FMR: data }, (err, count) => {
        if (err) {
          console.error('  ⚠️  Database error (terrain):', err.message);
        } else if (count > 0) {
          console.log(`✓ Saved ${count} terrain records to database`);
        }

        // Generate trail-specific JSON files after saving to database
        // Only for Vail for now (we'll expand to other resorts later)
        if (resortKey === 'vail') {
          generateTrailData(resortKey, resortId, today, data);
        }
      });
    }
  });

  // Print summary
  console.log('\n📊 Data Summary:');
  console.log(`   Resort: ${resortName}`);
  console.log(`   Resort ID: ${data.ResortId}`);
  console.log(`   Date: ${data.Date}`);
  console.log(`   Grooming Areas: ${data.GroomingAreas ? data.GroomingAreas.length : 0}`);
  console.log(`   Lifts: ${data.Lifts ? data.Lifts.length : 0}`);

  // Count total trails
  if (data.GroomingAreas) {
    let totalTrails = 0;
    let groomedTrails = 0;
    const groomedList = [];

    data.GroomingAreas.forEach(area => {
      area.Trails.forEach(trail => {
        totalTrails++;
        if (trail.IsGroomed) {
          groomedTrails++;
          groomedList.push(`${area.Name} - ${trail.Name}`);
        }
      });
    });

    console.log(`   Total Trails: ${totalTrails}`);
    console.log(`   Groomed: ${groomedTrails}`);
    console.log(`   Not Groomed: ${totalTrails - groomedTrails}`);

    if (groomedTrails > 0) {
      console.log('\n✓ Currently Groomed Trails:');
      groomedList.forEach(trail => console.log(`   - ${trail}`));
    }
  }

  return { resortKey, date: today, data };
}

/**
 * Save snow report data in clean, structured format
 */
function saveSnowData(resortKey, rawData) {
  if (!rawData || !rawData.snowReport) {
    console.log('✗ Could not find FR.snowReportData');
    return null;
  }

  const resortName = RESORTS[resortKey].name;
  const today = getTodayDate();
  const now = new Date();

  const snow = rawData.snowReport;
  const forecasts = rawData.forecasts;

  // Build clean, structured data format
  const cleanData = {
    resort: resortKey,
    resortName: resortName,
    date: today,
    timestamp: now.toISOString(),
    lastUpdated: snow.LastUpdatedText || null,
    conditions: snow.OverallSnowConditions || null,
    snowfall: {
      overnight_inches: parseFloat(snow.OvernightSnowfall?.Inches) || 0,
      overnight_cm: parseFloat(snow.OvernightSnowfall?.Centimeters) || 0,
      "24hour_inches": parseFloat(snow.TwentyFourHourSnowfall?.Inches) || 0,
      "24hour_cm": parseFloat(snow.TwentyFourHourSnowfall?.Centimeters) || 0,
      "48hour_inches": parseFloat(snow.FortyEightHourSnowfall?.Inches) || 0,
      "48hour_cm": parseFloat(snow.FortyEightHourSnowfall?.Centimeters) || 0,
      "7day_inches": parseFloat(snow.SevenDaySnowfall?.Inches) || 0,
      "7day_cm": parseFloat(snow.SevenDaySnowfall?.Centimeters) || 0,
      season_total_inches: parseFloat(snow.CurrentSeason?.Inches) || 0,
      season_total_cm: parseFloat(snow.CurrentSeason?.Centimeters) || 0
    },
    baseDepth: {
      inches: parseFloat(snow.BaseDepth?.Inches) || 0,
      cm: parseFloat(snow.BaseDepth?.Centimeters) || 0
    },
    forecast: null
  };

  // Process forecast data if available
  if (forecasts && Array.isArray(forecasts) && forecasts.length > 0) {
    cleanData.forecast = {
      locations: forecasts.map(location => {
        const forecastData = location.ForecastData || [];
        const today = forecastData.length > 0 ? forecastData[0] : null;

        return {
          name: location.Location || 'Unknown',
          elevation: location.Elevation || null,
          today: today ? {
            high_f: parseInt(today.HighTempStandard) || null,
            high_c: parseInt(today.HighTempMetric) || null,
            low_f: parseInt(today.LowTempStandard) || null,
            low_c: parseInt(today.LowTempMetric) || null,
            description: today.WeatherShortDescription || null,
            wind: today.Wind || null,
            wind_speed: today.WindSpeed || null,
            snowfall_day_inches: parseFloat(today.SnowFallDayStandard) || 0,
            snowfall_night_inches: parseFloat(today.SnowFallNightStandard) || 0
          } : null,
          forecast_days: forecastData.slice(0, 5).map(day => ({
            date: day.Date || null,
            high_f: parseInt(day.HighTempStandard) || null,
            high_c: parseInt(day.HighTempMetric) || null,
            low_f: parseInt(day.LowTempStandard) || null,
            low_c: parseInt(day.LowTempMetric) || null,
            description: day.WeatherShortDescription || null,
            snowfall_day_inches: parseFloat(day.SnowFallDayStandard) || 0,
            snowfall_night_inches: parseFloat(day.SnowFallNightStandard) || 0
          }))
        };
      })
    };
  }

  // Ensure directory structure exists
  const snowDir = path.join('data', resortKey, 'snow');
  ensureDirectoryExists(snowDir);

  // Save timestamped file
  const timestampedFile = path.join(snowDir, `${today}.json`);
  fs.writeFileSync(timestampedFile, JSON.stringify(cleanData, null, 2));
  console.log(`✓ Saved snow data to ${timestampedFile}`);

  // Also save as latest.json in the snow directory
  const latestFile = path.join(snowDir, 'latest.json');
  fs.writeFileSync(latestFile, JSON.stringify(cleanData, null, 2));
  console.log(`✓ Updated ${latestFile}`);

  // Save to database
  const database = getDb();
  const resortTimezone = RESORTS[resortKey].timezone || 'America/Denver';
  getOrCreateResort(database, resortKey, resortName, resortTimezone, (err, resortId) => {
    if (err) {
      console.error('  ⚠️  Database error (resort):', err.message);
    } else {
      const snowDataForDb = {
        overnightSnowfall: { inches: cleanData.snowfall.overnight_inches },
        baseDepth: { inches: cleanData.baseDepth.inches },
        newSnow24Hours: { inches: cleanData.snowfall['24hour_inches'] },
        newSnow48Hours: { inches: cleanData.snowfall['48hour_inches'] },
        newSnow7Days: { inches: cleanData.snowfall['7day_inches'] },
        seasonTotal: { inches: cleanData.snowfall.season_total_inches },
        currentConditions: { weather: cleanData.conditions }
      };

      saveSnowConditions(database, resortId, today, snowDataForDb, (err, id) => {
        if (err) {
          console.error('  ⚠️  Database error (snow):', err.message);
        } else if (id) {
          console.log(`✓ Saved snow conditions to database`);
        }
      });
    }
  });

  // Print summary
  console.log('\n❄️  Snow Report Summary:');
  console.log(`   Resort: ${resortName}`);
  console.log(`   Conditions: ${cleanData.conditions}`);
  console.log(`   Base Depth: ${cleanData.baseDepth.inches}" (${cleanData.baseDepth.cm}cm)`);
  console.log(`   24hr Snowfall: ${cleanData.snowfall['24hour_inches']}" (${cleanData.snowfall['24hour_cm']}cm)`);
  console.log(`   7-day Snowfall: ${cleanData.snowfall['7day_inches']}" (${cleanData.snowfall['7day_cm']}cm)`);
  console.log(`   Season Total: ${cleanData.snowfall.season_total_inches}" (${cleanData.snowfall.season_total_cm}cm)`);

  if (cleanData.forecast && cleanData.forecast.locations.length > 0) {
    console.log(`\n🌡️  Today's Forecast:`);
    cleanData.forecast.locations.forEach(loc => {
      if (loc.today) {
        console.log(`   ${loc.name}: ${loc.today.low_f}°F - ${loc.today.high_f}°F (${loc.today.description})`);
      }
    });
  }

  return { resortKey, date: today, data: cleanData };
}

/**
 * Scrape a single resort (terrain and/or snow data)
 */
async function scrapeResort(resortKey, options = {}) {
  const resort = RESORTS[resortKey];
  if (!resort) {
    console.error(`Unknown resort: ${resortKey}`);
    console.error(`Available resorts: ${Object.keys(RESORTS).join(', ')}`);
    return null;
  }

  const result = { resortKey, terrain: null, snow: null };

  // Determine URLs (backward compatibility with old 'url' field)
  const terrainUrl = resort.terrainUrl || resort.url;
  const snowUrl = resort.snowReportUrl;

  // Scrape terrain data if URL exists and not disabled
  if (terrainUrl && options.terrain !== false) {
    try {
      const data = await scrapeGroomingData(resortKey, terrainUrl);
      result.terrain = saveResortData(resortKey, data);
    } catch (error) {
      console.error(`Error scraping terrain for ${resort.name}:`, error.message);
    }
  }

  // Scrape snow data if URL exists and not disabled
  if (snowUrl && options.snow !== false) {
    try {
      const data = await scrapeSnowReport(resortKey, snowUrl);
      result.snow = saveSnowData(resortKey, data);
    } catch (error) {
      console.error(`Error scraping snow report for ${resort.name}:`, error.message);
    }
  }

  return result;
}

/**
 * Generate latest.json with most recent terrain data from all resorts
 */
function generateLatestFile(scrapedData) {
  const latest = {};

  scrapedData.forEach(result => {
    if (result && result.terrain && result.terrain.data) {
      latest[result.resortKey] = {
        date: result.terrain.date,
        name: RESORTS[result.resortKey].name,
        data: result.terrain.data
      };
    }
  });

  ensureDirectoryExists('data');
  fs.writeFileSync('data/latest.json', JSON.stringify(latest, null, 2));
  console.log('\n✓ Generated data/latest.json (aggregated terrain data)');
}

/**
 * Generate latest-snow.json with most recent snow data from all resorts
 */
function generateLatestSnowFile(scrapedData) {
  const latest = {};

  scrapedData.forEach(result => {
    if (result && result.snow && result.snow.data) {
      latest[result.resortKey] = {
        date: result.snow.date,
        name: RESORTS[result.resortKey].name,
        data: result.snow.data
      };
    }
  });

  if (Object.keys(latest).length > 0) {
    ensureDirectoryExists('data');
    fs.writeFileSync('data/latest-snow.json', JSON.stringify(latest, null, 2));
    console.log('✓ Generated data/latest-snow.json (aggregated snow data)');
  }
}

/**
 * Generate index.json manifest of all available data files
 */
function generateIndexFile() {
  const index = {
    resorts: {},
    lastUpdated: new Date().toISOString()
  };

  const dataDir = 'data';
  if (!fs.existsSync(dataDir)) {
    return;
  }

  // Scan each resort directory
  Object.keys(RESORTS).forEach(resortKey => {
    const terrainDir = path.join(dataDir, resortKey, 'terrain');
    if (fs.existsSync(terrainDir)) {
      const files = fs.readdirSync(terrainDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse(); // Most recent first

      index.resorts[resortKey] = {
        name: RESORTS[resortKey].name,
        files: files,
        latest: files[0] || null,
        count: files.length
      };
    }
  });

  fs.writeFileSync('data/index.json', JSON.stringify(index, null, 2));
  console.log('✓ Generated data/index.json (file manifest)');
}

/**
 * Convert trail name to URL-safe slug
 */
function slugifyTrailName(name) {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-')      // Replace spaces with hyphens
    .replace(/--+/g, '-')      // Replace multiple hyphens with single
    .trim();
}

/**
 * Sanitize trail name by removing pagination text and other artifacts
 * Fixes issues like "Black Forest 0   5073\t Items per page : 20 1 - 20 of 54"
 */
function sanitizeTrailName(name) {
  return name
    // Remove pagination text pattern: "0   5073\t Items per page : 20 1 - 20 of 54"
    .replace(/\s*\d+\s+\d+\s*\t\s*Items per page\s*:\s*\d+\s+\d+\s*-\s*\d+\s+of\s+\d+.*$/i, '')
    .trim();
}

/**
 * Get the start date of the current ski season for a resort
 */
function getSeasonStartDate(resort) {
  const timezone = resort.timezone || 'America/Denver';
  const localDate = getResortLocalDate(timezone);
  const [currentYear, currentMonth] = localDate.split('-').map(Number);

  const seasonStart = resort.seasonStart || config.schedule.defaultSeasonStart;
  const [startMonth, startDay] = seasonStart.split('-').map(Number);

  // Determine which year the season started
  let seasonStartYear;
  if (currentMonth >= startMonth) {
    // We're in the second half of the year (e.g., Nov-Dec)
    seasonStartYear = currentYear;
  } else {
    // We're in the first half of the year (e.g., Jan-Jun)
    // Season started last year
    seasonStartYear = currentYear - 1;
  }

  const year = String(seasonStartYear);
  const month = String(startMonth).padStart(2, '0');
  const day = String(startDay).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Calculate grooming streak for a trail
 * Returns { currentStreak, longestStreak, lastGroomedDate }
 */
function calculateGroomingStreaks(records) {
  if (!records || records.length === 0) {
    return { currentStreak: 0, longestStreak: 0, lastGroomedDate: null };
  }

  // Sort by date descending (most recent first)
  const sorted = records.slice().sort((a, b) => b.date.localeCompare(a.date));

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;
  let lastGroomedDate = null;

  // Find last groomed date
  for (const record of sorted) {
    if (record.grooming_status) {
      lastGroomedDate = record.date;
      break;
    }
  }

  // Calculate current streak (from most recent date backwards)
  for (const record of sorted) {
    if (record.grooming_status) {
      currentStreak++;
    } else {
      break; // Streak broken
    }
  }

  // Calculate longest streak
  for (const record of sorted.reverse()) { // Go chronologically forward
    if (record.grooming_status) {
      tempStreak++;
      longestStreak = Math.max(longestStreak, tempStreak);
    } else {
      tempStreak = 0;
    }
  }

  return { currentStreak, longestStreak, lastGroomedDate };
}

/**
 * Calculate grooming statistics by day of week
 */
function calculateDayOfWeekStats(records) {
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const stats = daysOfWeek.map(day => ({ day, groomed: 0, total: 0 }));

  records.forEach(record => {
    const date = new Date(record.date);
    const dayIndex = date.getDay();
    stats[dayIndex].total++;
    if (record.grooming_status) {
      stats[dayIndex].groomed++;
    }
  });

  return stats.map(s => ({
    day: s.day,
    percentage: s.total > 0 ? Math.round((s.groomed / s.total) * 100) : 0,
    groomed: s.groomed,
    total: s.total
  }));
}

/**
 * Generate trail-specific JSON files with historical data and statistics
 */
function generateTrailData(resortKey, resortId, date, terrainData) {
  if (!terrainData || !terrainData.GroomingAreas) {
    return;
  }

  const resort = RESORTS[resortKey];
  const seasonStartDate = getSeasonStartDate(resort);
  const database = getDb();

  console.log(`\n📄 Generating trail data files for ${resort.name}...`);
  console.log(`   Season start: ${seasonStartDate}`);

  // Ensure trails directory exists
  const trailsDataDir = path.join('data', resortKey, 'trails', 'data');
  ensureDirectoryExists(trailsDataDir);

  let trailCount = 0;

  // Process each grooming area and trail
  terrainData.GroomingAreas.forEach(area => {
    if (!area.Trails) return;

    area.Trails.forEach(trail => {
      const trailName = sanitizeTrailName(trail.Name);
      const trailSlug = slugifyTrailName(trailName);

      // Query database for historical data for this trail (current season only)
      database.all(
        `SELECT date, status, grooming_status, grooming_type, raw_data
         FROM terrain_status
         WHERE resort_id = ? AND item_name = ? AND item_type = 'trail' AND date >= ?
         ORDER BY date DESC`,
        [resortId, trailName, seasonStartDate],
        (err, rows) => {
          if (err) {
            console.error(`  ⚠️  Error querying trail data for ${trailName}:`, err.message);
            return;
          }

          // Calculate statistics
          const daysTracked = rows.length;
          const daysGroomed = rows.filter(r => r.grooming_status).length;
          const groomingPercentage = daysTracked > 0 ? Math.round((daysGroomed / daysTracked) * 100) : 0;

          const streaks = calculateGroomingStreaks(rows);
          const dayOfWeekStats = calculateDayOfWeekStats(rows);

          // Build historical records array (last 90 days max for reasonable file size)
          const historicalRecords = rows.slice(0, 90).map(row => ({
            date: row.date,
            isOpen: row.status === 'Open',
            isGroomed: !!row.grooming_status,
            groomingStatus: row.grooming_status || null,
            groomingType: row.grooming_type || null
          }));

          // Create trail data object
          const trailData = {
            trailName: trailName,
            trailSlug: trailSlug,
            resort: resortKey,
            resortName: resort.name,
            area: area.Name,
            difficulty: trail.Difficulty || 'Unknown',
            trailType: trail.TrailType || 'Skiing',

            // Current status (from today's scrape)
            currentStatus: {
              date: date,
              isOpen: trail.IsOpen,
              isGroomed: trail.IsGroomed,
              groomingStatus: trail.GroomingStatus || null,
              status: trail.Status || null
            },

            // Statistics
            stats: {
              seasonStartDate: seasonStartDate,
              daysTracked: daysTracked,
              daysGroomed: daysGroomed,
              groomingPercentage: groomingPercentage,
              currentStreak: streaks.currentStreak,
              longestStreak: streaks.longestStreak,
              lastGroomed: streaks.lastGroomedDate,
              dayOfWeek: dayOfWeekStats
            },

            // Historical data (last 90 days)
            history: historicalRecords,

            // Metadata
            generated: new Date().toISOString()
          };

          // Save trail JSON file
          const trailFile = path.join(trailsDataDir, `${trailSlug}.json`);
          fs.writeFileSync(trailFile, JSON.stringify(trailData, null, 2));

          trailCount++;
        }
      );
    });
  });

  // Give database queries time to complete, then print summary
  setTimeout(() => {
    console.log(`✓ Generated ${trailCount} trail data files`);

    // Also generate a trails index file
    generateTrailsIndex(resortKey);
  }, 1000);
}

/**
 * Generate trails index file with metadata for all trails
 */
function generateTrailsIndex(resortKey) {
  const trailsDataDir = path.join('data', resortKey, 'trails', 'data');

  if (!fs.existsSync(trailsDataDir)) {
    return;
  }

  const trailFiles = fs.readdirSync(trailsDataDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  const trailsIndex = {
    resort: resortKey,
    resortName: RESORTS[resortKey].name,
    trailCount: trailFiles.length,
    trails: [],
    lastUpdated: new Date().toISOString()
  };

  // Read each trail file and extract key metadata
  trailFiles.forEach(file => {
    try {
      const trailData = JSON.parse(fs.readFileSync(path.join(trailsDataDir, file), 'utf8'));
      trailsIndex.trails.push({
        name: trailData.trailName,
        slug: trailData.trailSlug,
        area: trailData.area,
        difficulty: trailData.difficulty,
        isGroomedToday: trailData.currentStatus.isGroomed,
        isOpen: trailData.currentStatus.isOpen,
        groomingPercentage: trailData.stats.groomingPercentage,
        currentStreak: trailData.stats.currentStreak
      });
    } catch (e) {
      console.error(`  ⚠️  Error reading trail file ${file}:`, e.message);
    }
  });

  // Sort trails by area, then name
  trailsIndex.trails.sort((a, b) => {
    if (a.area !== b.area) return a.area.localeCompare(b.area);
    return a.name.localeCompare(b.name);
  });

  const indexFile = path.join('data', resortKey, 'trails', 'index.json');
  fs.writeFileSync(indexFile, JSON.stringify(trailsIndex, null, 2));
  console.log(`✓ Generated trails/index.json for ${RESORTS[resortKey].name}`);
}

/**
 * Main execution function
 */
async function main() {
  console.log('🎿 Ski Run Scraper (Timezone-Aware)');
  console.log('='.repeat(80));
  console.log(`Run time: ${new Date().toISOString()}`);
  console.log(`Check interval: Every ${config.schedule.checkIntervalHours} hours`);
  console.log(`Target scraping time: ${config.schedule.targetHour}:00 local (${config.schedule.scrapingWindowHours} hour window)`);
  console.log('='.repeat(80));

  // Get resort from command line argument, default to all
  const args = process.argv.slice(2);
  const resortArg = args[0];

  let resortsToCheck = [];

  if (resortArg && resortArg !== 'all') {
    // Check single resort
    if (RESORTS[resortArg]) {
      resortsToCheck = [RESORTS[resortArg]];
    } else {
      console.error(`\n❌ Unknown resort: ${resortArg}`);
      console.error(`Available resorts: ${Object.keys(RESORTS).join(', ')}\n`);
      return;
    }
  } else {
    // Check all resorts
    resortsToCheck = Object.values(RESORTS);
  }

  console.log(`\n📋 Checking ${resortsToCheck.length} resort(s)...\n`);

  // Analyze each resort and determine what to scrape
  const scrapedData = [];
  let scrapedCount = 0;
  let skippedCount = 0;

  for (const resort of resortsToCheck) {
    const status = getResortStatus(resort);

    console.log(`[${resort.name}]`);
    console.log(`  🕐 Local time: ${status.localTime}`);
    console.log(`  📅 Season: ${status.inSeason ? '✓ Active' : '✗ Out of season'}`);
    console.log(`  ⏰ Window: ${status.inWindow ? `✓ In range (${status.targetHour}:00-${status.targetHour + status.windowHours}:00)` : `✗ Outside range (current: ${status.currentHour}:00, target: ${status.targetHour}:00-${status.targetHour + status.windowHours}:00)`}`);
    console.log(`  🎿 Terrain: ${status.terrainScraped ? '✗ Already scraped today' : '○ Not scraped yet'}`);
    console.log(`  ❄️  Snow: ${status.snowScraped ? '✗ Already scraped today' : '○ Not scraped yet'}`);

    // Determine what to scrape
    const shouldScrapeTerrain = status.shouldScrapeTerrain;
    const shouldScrapeSnow = status.shouldScrapeSnow;

    if (shouldScrapeTerrain || shouldScrapeSnow) {
      console.log(`  → ACTION: Scraping ${shouldScrapeTerrain ? 'terrain' : ''}${shouldScrapeTerrain && shouldScrapeSnow ? ' & ' : ''}${shouldScrapeSnow ? 'snow' : ''}`);

      const options = {
        terrain: shouldScrapeTerrain,
        snow: shouldScrapeSnow
      };

      const result = await scrapeResort(resort.key, options);
      if (result) scrapedData.push(result);
      scrapedCount++;
    } else {
      let reason = '';
      if (!status.inSeason) {
        reason = 'out of season';
      } else if (!status.inWindow) {
        reason = `outside scraping window (${status.targetHour}:00-${status.targetHour + status.windowHours}:00)`;
      } else if (status.terrainScraped && status.snowScraped) {
        reason = 'already scraped today';
      } else {
        reason = 'no eligible data to scrape';
      }
      console.log(`  → SKIPPING: ${reason}`);
      skippedCount++;
    }
    console.log('');
  }

  // Summary
  console.log('='.repeat(80));
  console.log(`📊 Summary: ${scrapedCount} resort(s) scraped, ${skippedCount} skipped`);
  console.log('='.repeat(80));

  // Generate aggregated files
  if (scrapedData.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('Generating aggregated data files...');
    console.log('='.repeat(80));
    generateLatestFile(scrapedData);
    generateLatestSnowFile(scrapedData);
    generateIndexFile();
  }

  console.log('\n✅ Scraping complete!\n');

  // Close database connection
  if (db) {
    closeDatabase(db);
    console.log('🔒 Database connection closed\n');
  }
}

main();
