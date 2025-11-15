// ski-scraper.js - Multi-resort grooming data extractor using Puppeteer
// Now with historical data tracking and configurable resorts

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Load configuration
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const RESORTS = config.resorts.reduce((acc, resort) => {
  acc[resort.key] = resort;
  return acc;
}, {});

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
  const today = getTodayDate();

  // Ensure data directory structure exists
  const terrainDir = path.join('data', resortKey, 'terrain');
  ensureDirectoryExists(terrainDir);

  // Save timestamped file
  const timestampedFile = path.join(terrainDir, `${today}.json`);
  fs.writeFileSync(timestampedFile, JSON.stringify(data, null, 2));
  console.log(`✓ Saved data to ${timestampedFile}`);

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
 * Main execution function
 */
async function main() {
  console.log('🎿 Ski Run Scraper');
  console.log('='.repeat(50));

  // Check if season is active
  if (!isSeasonActive()) {
    console.log(`\n⏸️  Season ended on ${config.season.endDate}. Skipping scrape.`);
    console.log('Update config.json to change the season end date.\n');
    return;
  }

  // Get resort from command line argument, default to all
  const args = process.argv.slice(2);
  const resortArg = args[0];

  const scrapedData = [];

  if (resortArg && resortArg !== 'all') {
    // Scrape single resort
    const result = await scrapeResort(resortArg);
    if (result) scrapedData.push(result);
  } else {
    // Scrape all resorts
    console.log('Scraping all resorts...\n');
    for (const resortKey of Object.keys(RESORTS)) {
      const result = await scrapeResort(resortKey);
      if (result) scrapedData.push(result);
    }
  }

  // Generate aggregated files
  if (scrapedData.length > 0) {
    console.log('\n' + '='.repeat(50));
    console.log('Generating aggregated data files...');
    console.log('='.repeat(50));
    generateLatestFile(scrapedData);
    generateLatestSnowFile(scrapedData);
    generateIndexFile();
  }

  console.log('\n✅ Scraping complete!\n');
}

main();
