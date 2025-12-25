// snow-scraper.js - Snow report scraper (runs hourly throughout the day)
// Separated from terrain scraping for better performance and scheduling
//
// ═══════════════════════════════════════════════════════════════════════════════
// DATA SOURCE DOCUMENTATION
// ═══════════════════════════════════════════════════════════════════════════════
//
// Vail Resorts:
//   - Method: Puppeteer (headless Chrome)
//   - Data Source: Each resort's snow report page (snowReportUrl in config.json)
//   - Provider: configured with provider: "vail" or no provider in config.json
//
// Ikon Pass Resorts:
//   - Method: Inspector API (https://mtnpowder.com/feed/v3.json)
//   - Data Source: Single HTTP call fetches all 123 Ikon resorts
//   - Provider: configured with provider: "ikon" in config.json
//
// Update Frequency: Every hour (updates throughout the day as conditions change)
//
// ═══════════════════════════════════════════════════════════════════════════════
// USAGE
// ═══════════════════════════════════════════════════════════════════════════════
//
// node snow-scraper.js [vail|ikon]
//
// Arguments:
//   vail - Scrape snow reports for Vail Resorts using Puppeteer (batched)
//   ikon - Scrape snow reports for Ikon Pass resorts using Inspector API
//
// Runs automatically via .github/workflows/snow-scraper.yml every hour
// Called twice per workflow run (once for vail, once for ikon)
//
// ═══════════════════════════════════════════════════════════════════════════════

const puppeteer = require('puppeteer');
const https = require('https');
const fs = require('fs');
const path = require('path');
const {
  initializeDatabase,
  getOrCreateResort,
  saveSnowConditions,
  closeDatabase
} = require('./database');

const configLoader = require('./lib/config-loader');
const seasonUtils = require('./lib/season-utils');
const fileStorage = require('./lib/file-storage');
const dataNormalization = require('./lib/data-normalization');
const providers = require('./lib/providers');

// Load configuration
const config = configLoader.loadConfig();
const RESORTS = configLoader.getResortsMap(config);

// Inspector API configuration
const INSPECTOR_API_URL = config.inspector?.apiUrl || 'https://mtnpowder.com/feed/v3.json';
const BEARER_TOKEN = config.inspector?.bearerToken || 'hPtaTVkbuyZQnrxvru4ApfpXnS21PJO3eTKdibDoLZE';

// Initialize database connection
let db = null;
function getDb() {
  if (!db) {
    db = initializeDatabase();
  }
  return db;
}

// Reuse a single browser for all scrapes to reduce launch overhead
let sharedBrowser = null;
async function getSharedBrowser() {
  if (!sharedBrowser) {
    sharedBrowser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });
  }
  return sharedBrowser;
}

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
 * Scrape snow report data from a Vail resort using Puppeteer
 */
async function scrapeVailSnowReport(resortKey, url) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Scraping Snow Report for ${RESORTS[resortKey].name}...`);
  console.log('='.repeat(50));

  const browser = await getSharedBrowser();
  const page = await browser.newPage();

  try {
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
    await page.close();
  }
}

/**
 * Save Vail snow report data in clean, structured format
 */
function saveVailSnowData(resortKey, rawData) {
  if (!rawData || !rawData.snowReport) {
    console.log('✗ Could not find FR.snowReportData');
    return null;
  }

  const resort = RESORTS[resortKey];
  const resortName = resort.name;
  const timezone = resort.timezone || 'America/Denver';
  const today = seasonUtils.getResortLocalDate(timezone);
  const now = new Date();

  const snow = rawData.snowReport;
  const forecasts = rawData.forecasts;

  // Build clean, structured data format
  const cleanData = {
    resort: resortKey,
    resortName: resortName,
    provider: resort.provider || 'vail',
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
  fileStorage.ensureDirectoryExists(snowDir);

  // Save timestamped file (backward compatibility for consumers expecting JSON)
  const timestampedFile = path.join(snowDir, `${today}.json`);
  fs.writeFileSync(timestampedFile, JSON.stringify(cleanData, null, 2));
  console.log(`✓ Saved snow data to ${timestampedFile}`);

  // Also save as latest.json in the snow directory
  const latestFile = path.join(snowDir, 'latest.json');
  fs.writeFileSync(latestFile, JSON.stringify(cleanData, null, 2));
  console.log(`✓ Updated ${latestFile}`);

  // Append to NDJSON stream for intraday history
  const ndjsonFile = path.join(snowDir, `${today}.ndjson`);
  fs.appendFileSync(ndjsonFile, JSON.stringify(cleanData) + '\n', 'utf8');
  console.log(`✓ Appended snow record to ${ndjsonFile}`);

  // Save to database
  const database = getDb();
  getOrCreateResort(database, resortKey, resortName, timezone, (err, resortId) => {
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
 * Save Ikon snow report data (from Inspector API)
 */
function saveIkonSnowData(resortKey, inspectorData) {
  if (!inspectorData) {
    console.log('✗ No data returned from Inspector API');
    return null;
  }

  const resort = RESORTS[resortKey];
  const resortName = resort.name;
  const timezone = resort.timezone || 'America/Denver';
  const today = seasonUtils.getResortLocalDate(timezone);

  // Normalize Inspector snow data
  const cleanData = dataNormalization.normalizeInspectorSnowReport(
    inspectorData,
    resortKey,
    resortName,
    today
  );

  // Add provider metadata
  const snowDataWithProvider = {
    ...cleanData,
    provider: resort.provider || 'ikon'
  };

  // Ensure directory structure exists
  const snowDir = path.join('data', resortKey, 'snow');
  fileStorage.ensureDirectoryExists(snowDir);

  // Save timestamped file
  const timestampedFile = path.join(snowDir, `${today}.json`);
  fs.writeFileSync(timestampedFile, JSON.stringify(snowDataWithProvider, null, 2));
  console.log(`✓ Saved snow data to ${timestampedFile}`);

  // Also save as latest.json in the snow directory
  const latestFile = path.join(snowDir, 'latest.json');
  fs.writeFileSync(latestFile, JSON.stringify(snowDataWithProvider, null, 2));
  console.log(`✓ Updated ${latestFile}`);

  // Append to NDJSON stream for intraday history
  const ndjsonFile = path.join(snowDir, `${today}.ndjson`);
  fs.appendFileSync(ndjsonFile, JSON.stringify(snowDataWithProvider) + '\n', 'utf8');
  console.log(`✓ Appended snow record to ${ndjsonFile}`);

  // Save to database
  const database = getDb();
  getOrCreateResort(database, resortKey, resortName, timezone, (err, resortId) => {
    if (err) {
      console.error('  ⚠️  Database error (resort):', err.message);
    } else {
      const primaryConditions =
        cleanData.currentConditions?.base ||
        cleanData.currentConditions?.midMountain ||
        cleanData.currentConditions?.summit ||
        null;

      const snowDataForDb = {
        overnightSnowfall: { inches: cleanData.snowfall.overnight_inches },
        baseDepth: { inches: cleanData.baseDepth.inches },
        newSnow24Hours: { inches: cleanData.snowfall['24hour_inches'] },
        newSnow48Hours: { inches: cleanData.snowfall['48hour_inches'] },
        newSnow7Days: { inches: cleanData.snowfall['7day_inches'] },
        seasonTotal: { inches: cleanData.snowfall.season_total_inches },
        currentConditions: {
          weather: primaryConditions?.skies || primaryConditions?.conditions || cleanData.conditions,
          temperature: primaryConditions?.temperature_f ?? primaryConditions?.temperature_c ?? null
        }
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
  console.log(`   Operating Status: ${cleanData.operatingStatus}`);
  console.log(`   Conditions: ${cleanData.conditions}`);
  console.log(`   Base Depth: ${cleanData.baseDepth.inches}" (${cleanData.baseDepth.cm}cm)`);
  console.log(`   24hr Snowfall: ${cleanData.snowfall['24hour_inches']}" (${cleanData.snowfall['24hour_cm']}cm)`);
  console.log(`   7-day Snowfall: ${cleanData.snowfall['7day_inches']}" (${cleanData.snowfall['7day_cm']}cm)`);
  console.log(`   Season Total: ${cleanData.snowfall.season_total_inches}" (${cleanData.snowfall.season_total_cm}cm)`);

  const weatherNow =
    cleanData.currentConditions?.base ||
    cleanData.currentConditions?.midMountain ||
    cleanData.currentConditions?.summit ||
    null;

  if (weatherNow) {
    console.log(`   Current Weather: ${weatherNow.skies || weatherNow.conditions || 'Unknown'} @ ${weatherNow.temperature_f ?? weatherNow.temperature_c ?? '--'}°`);
  }

  return { resortKey, date: today, data: snowDataWithProvider };
}

/**
 * Save snow report data from Zaneray API
 */
function saveZaneraySnowData(resortKey, zanerayData) {
  if (!zanerayData) {
    console.log('✗ No data returned from Zaneray API');
    return null;
  }

  const resort = RESORTS[resortKey];
  const resortName = resort.name;
  const timezone = resort.timezone || 'America/Denver';
  const today = seasonUtils.getResortLocalDate(timezone);

  // Normalize Zaneray snow data
  const cleanData = dataNormalization.normalizeZaneraySnowReport(
    zanerayData,
    resortKey,
    resortName,
    today
  );

  // Add provider metadata
  const snowDataWithProvider = {
    ...cleanData,
    provider: resort.provider || 'ikon',
    apiProvider: 'zaneray'
  };

  // Ensure directory structure exists
  const snowDir = path.join('data', resortKey, 'snow');
  fileStorage.ensureDirectoryExists(snowDir);

  // Save timestamped file
  const timestampedFile = path.join(snowDir, `${today}.json`);
  fs.writeFileSync(timestampedFile, JSON.stringify(snowDataWithProvider, null, 2));
  console.log(`✓ Saved snow data to ${timestampedFile}`);

  // Also save as latest.json in the snow directory
  const latestFile = path.join(snowDir, 'latest.json');
  fs.writeFileSync(latestFile, JSON.stringify(snowDataWithProvider, null, 2));
  console.log(`✓ Updated ${latestFile}`);

  // Append to NDJSON stream for intraday history
  const ndjsonFile = path.join(snowDir, `${today}.ndjson`);
  fs.appendFileSync(ndjsonFile, JSON.stringify(snowDataWithProvider) + '\n', 'utf8');
  console.log(`✓ Appended snow record to ${ndjsonFile}`);

  // Save to database
  const database = getDb();
  getOrCreateResort(database, resortKey, resortName, timezone, (err, resortId) => {
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

  return { resortKey, date: today, data: snowDataWithProvider };
}

/**
 * Save snow report data from SnoCountry API
 */
function saveSnoCountrySnowData(resortKey, snoCountryData) {
  if (!snoCountryData) {
    console.log('✗ No data returned from SnoCountry API');
    return null;
  }

  const resort = RESORTS[resortKey];
  const resortName = resort.name;
  const timezone = resort.timezone || 'America/Denver';
  const today = seasonUtils.getResortLocalDate(timezone);

  // Normalize SnoCountry snow data
  const cleanData = dataNormalization.normalizeSnoCountrySnowReport(
    snoCountryData,
    resortKey,
    resortName,
    today
  );

  // Add provider metadata
  const snowDataWithProvider = {
    ...cleanData,
    provider: resort.provider || 'ikon',
    apiProvider: 'snocountry'
  };

  // Ensure directory structure exists
  const snowDir = path.join('data', resortKey, 'snow');
  fileStorage.ensureDirectoryExists(snowDir);

  // Save timestamped file
  const timestampedFile = path.join(snowDir, `${today}.json`);
  fs.writeFileSync(timestampedFile, JSON.stringify(snowDataWithProvider, null, 2));
  console.log(`✓ Saved snow data to ${timestampedFile}`);

  // Also save as latest.json in the snow directory
  const latestFile = path.join(snowDir, 'latest.json');
  fs.writeFileSync(latestFile, JSON.stringify(snowDataWithProvider, null, 2));
  console.log(`✓ Updated ${latestFile}`);

  // Append to NDJSON stream for intraday history
  const ndjsonFile = path.join(snowDir, `${today}.ndjson`);
  fs.appendFileSync(ndjsonFile, JSON.stringify(snowDataWithProvider) + '\n', 'utf8');
  console.log(`✓ Appended snow record to ${ndjsonFile}`);

  // Save to database
  const database = getDb();
  getOrCreateResort(database, resortKey, resortName, timezone, (err, resortId) => {
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
  console.log(`   Conditions: ${cleanData.conditions || 'N/A'}`);
  console.log(`   Base Depth: ${cleanData.baseDepth.inches}" (${cleanData.baseDepth.cm}cm)`);
  console.log(`   24hr Snowfall: ${cleanData.snowfall['24hour_inches']}" (${cleanData.snowfall['24hour_cm']}cm)`);
  console.log(`   48hr Snowfall: ${cleanData.snowfall['48hour_inches']}" (${cleanData.snowfall['48hour_cm']}cm)`);
  console.log(`   7-day Snowfall: ${cleanData.snowfall['7day_inches']}" (${cleanData.snowfall['7day_cm']}cm)`);
  console.log(`   Open Trails: ${cleanData.terrain.openTrails}/${cleanData.terrain.totalTrails}`);
  console.log(`   Open Lifts: ${cleanData.terrain.openLifts}/${cleanData.terrain.totalLifts}`);

  return { resortKey, date: today, data: snowDataWithProvider };
}

/**
 * Save snow report data from ReportPal API
 */
function saveReportPalSnowData(resortKey, reportPalData) {
  if (!reportPalData) {
    console.log('✗ No data returned from ReportPal API');
    return null;
  }

  const resort = RESORTS[resortKey];
  const resortName = resort.name;
  const timezone = resort.timezone || 'America/Denver';
  const today = seasonUtils.getResortLocalDate(timezone);

  // Normalize ReportPal snow data
  const cleanData = dataNormalization.normalizeReportPalSnowReport(
    reportPalData,
    resortKey,
    resortName,
    today
  );

  // Add provider metadata
  const snowDataWithProvider = {
    ...cleanData,
    provider: resort.provider || 'ikon',
    apiProvider: 'reportpal'
  };

  // Ensure directory structure exists
  const snowDir = path.join('data', resortKey, 'snow');
  fileStorage.ensureDirectoryExists(snowDir);

  // Save timestamped file
  const timestampedFile = path.join(snowDir, `${today}.json`);
  fs.writeFileSync(timestampedFile, JSON.stringify(snowDataWithProvider, null, 2));
  console.log(`✓ Saved snow data to ${timestampedFile}`);

  // Also save as latest.json in the snow directory
  const latestFile = path.join(snowDir, 'latest.json');
  fs.writeFileSync(latestFile, JSON.stringify(snowDataWithProvider, null, 2));
  console.log(`✓ Updated ${latestFile}`);

  // Append to NDJSON stream for intraday history
  const ndjsonFile = path.join(snowDir, `${today}.ndjson`);
  fs.appendFileSync(ndjsonFile, JSON.stringify(snowDataWithProvider) + '\n', 'utf8');
  console.log(`✓ Appended snow record to ${ndjsonFile}`);

  // Save to database
  const database = getDb();
  getOrCreateResort(database, resortKey, resortName, timezone, (err, resortId) => {
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
  console.log(`   Conditions: ${cleanData.conditions || 'N/A'}`);
  console.log(`   Base Depth: ${cleanData.baseDepth.inches}" (${cleanData.baseDepth.cm}cm)`);
  console.log(`   24hr Snowfall: ${cleanData.snowfall['24hour_inches']}" (${cleanData.snowfall['24hour_cm']}cm)`);
  console.log(`   7-day Snowfall: ${cleanData.snowfall['7day_inches']}" (${cleanData.snowfall['7day_cm']}cm)`);
  console.log(`   Season Total: ${cleanData.snowfall.season_total_inches}" (${cleanData.snowfall.season_total_cm}cm)`);

  return { resortKey, date: today, data: snowDataWithProvider };
}

/**
 * Scrape snow data from custom API providers (Zaneray, ReportPal)
 */
async function scrapeCustomProviderResorts(resortsToScrape) {
  const scrapedData = [];

  // Group resorts by provider
  const resortsByProvider = providers.groupResortsByProvider(resortsToScrape);

  // Process Zaneray resorts (Jackson Hole)
  if (resortsByProvider.zaneray && resortsByProvider.zaneray.length > 0) {
    console.log(`\n📡 Processing ${resortsByProvider.zaneray.length} Zaneray resort(s)...`);

    for (const resort of resortsByProvider.zaneray) {
      try {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Processing ${resort.name} (Zaneray)...`);
        console.log('='.repeat(50));

        const rawData = await providers.fetchResortData(resort);
        const result = saveZaneraySnowData(resort.key, rawData);
        if (result) scrapedData.push(result);
      } catch (error) {
        console.error(`❌ Error scraping ${resort.name}: ${error.message}`);
      }
    }
  }

  // Process ReportPal resorts (Big Sky, Sugarloaf, Sunday River, Loon Mountain, Cypress Mountain)
  if (resortsByProvider.reportpal && resortsByProvider.reportpal.length > 0) {
    console.log(`\n📡 Processing ${resortsByProvider.reportpal.length} ReportPal resort(s)...`);

    for (const resort of resortsByProvider.reportpal) {
      try {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Processing ${resort.name} (ReportPal)...`);
        console.log('='.repeat(50));

        const rawData = await providers.fetchResortData(resort);
        const result = saveReportPalSnowData(resort.key, rawData);
        if (result) scrapedData.push(result);
      } catch (error) {
        console.error(`❌ Error scraping ${resort.name}: ${error.message}`);
      }
    }
  }

  // Process SnoCountry resorts (Snowbird, Killington, Copper Mountain)
  // These resorts use DOR for terrain but SnoCountry for snow data
  if (resortsByProvider.snocountry && resortsByProvider.snocountry.length > 0) {
    console.log(`\n📡 Processing ${resortsByProvider.snocountry.length} SnoCountry resort(s)...`);

    for (const resort of resortsByProvider.snocountry) {
      try {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Processing ${resort.name} (SnoCountry)...`);
        console.log('='.repeat(50));

        const rawData = await providers.fetchResortData(resort);
        const result = saveSnoCountrySnowData(resort.key, rawData);
        if (result) scrapedData.push(result);
      } catch (error) {
        console.error(`❌ Error scraping ${resort.name}: ${error.message}`);
      }
    }
  }

  // Note: DOR providers are now configured with snocountry for snow data

  return scrapedData;
}

/**
 * Scrape Vail resorts
 */
async function scrapeVailResorts(resortsToScrape) {
  const scrapedData = [];

  console.log(`\n📍 Processing ${resortsToScrape.length} Vail resort(s)...`);

  for (const resort of resortsToScrape) {
    if (!resort.snowReportUrl) {
      console.log(`\n⏭️  ${resort.name}: No snow report URL configured, skipping`);
      continue;
    }

    try {
      const data = await scrapeVailSnowReport(resort.key, resort.snowReportUrl);
      const result = saveVailSnowData(resort.key, data);
      if (result) scrapedData.push(result);
    } catch (error) {
      console.error(`\n❌ Error scraping snow report for ${resort.name}:`, error.message);
    }
  }

  return scrapedData;
}

/**
 * Scrape Ikon resorts (via Inspector API and custom providers)
 */
async function scrapeIkonResorts(resortsToScrape) {
  const scrapedData = [];

  // Separate resorts by provider type
  // Resorts with apiProvider='zaneray' use direct API; others use Inspector API
  // Custom providers with snow data: zaneray (Jackson Hole), reportpal (Big Sky, etc.), snocountry (Snowbird, etc.)
  // DOR providers continue to use Inspector API for terrain, but snocountry handles their snow data now
  const customProviderResorts = resortsToScrape.filter(r =>
    r.apiProvider && (r.apiProvider === 'zaneray' || r.apiProvider === 'reportpal' || r.apiProvider === 'snocountry')
  );
  const inspectorResorts = resortsToScrape.filter(r =>
    !r.apiProvider || r.apiProvider === 'inspector'
  );

  // Process custom provider resorts first (Zaneray has snow data)
  if (customProviderResorts.length > 0) {
    console.log(`\n📡 Found ${customProviderResorts.length} resort(s) with custom snow APIs...`);
    const customResults = await scrapeCustomProviderResorts(customProviderResorts);
    scrapedData.push(...customResults);
  }

  // Process Inspector API resorts (DOR/ReportPal still use Inspector for snow data)
  if (inspectorResorts.length > 0) {
    console.log(`\n📦 Fetching ${inspectorResorts.length} resort(s) from Inspector API...`);

    try {
      // Fetch all resort data in one API call
      const apiResponse = await fetchAllInspectorData();

      if (!apiResponse || !apiResponse.Resorts || apiResponse.Resorts.length === 0) {
        console.error('❌ No resort data in API response');
        return scrapedData;
      }

      console.log(`✓ Received data for ${apiResponse.Resorts.length} resorts from API`);
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Processing ${inspectorResorts.length} Inspector API resort(s)...`);
      console.log('='.repeat(80));

      // Process each configured Inspector API resort
      inspectorResorts.forEach(resort => {
        const inspectorName = resort.inspectorName || resort.name;

        // Find matching resort in API data (exact name match)
        const ikonResortData = apiResponse.Resorts.find(r => r.Name === inspectorName);

        if (!ikonResortData) {
          console.error(`\n⚠️  ${resort.name}: No matching data found (looking for "${inspectorName}")`);
          return;
        }

        console.log(`\n${'='.repeat(50)}`);
        console.log(`Processing ${resort.name}...`);
        console.log('='.repeat(50));

        // Save snow data
        const result = saveIkonSnowData(resort.key, ikonResortData);
        if (result) scrapedData.push(result);
      });

    } catch (error) {
      console.error(`❌ Error fetching Ikon data from Inspector API:`, error.message);
    }
  }

  return scrapedData;
}

/**
 * Generate latest-snow.json with most recent snow data from all resorts
 */
function generateLatestSnowFile(scrapedData) {
  const latest = {};

  scrapedData.forEach(result => {
    if (result && result.data) {
      latest[result.resortKey] = {
        date: result.date,
        name: RESORTS[result.resortKey].name,
        provider: RESORTS[result.resortKey].provider || 'vail',
        data: result.data
      };
    }
  });

  if (Object.keys(latest).length > 0) {
    fileStorage.ensureDirectoryExists('data');
    fs.writeFileSync('data/latest-snow.json', JSON.stringify(latest, null, 2));
    console.log(`\n✓ Generated data/latest-snow.json (${Object.keys(latest).length} resorts)`);
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log('🎿 Snow Report Scraper');
  console.log('='.repeat(80));
  console.log(`Run time: ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  // Get provider from command line argument
  const args = process.argv.slice(2);
  const provider = args[0];

  if (!provider || (provider !== 'vail' && provider !== 'ikon')) {
    console.error('\n❌ Invalid provider. Usage: node snow-scraper.js [vail|ikon]\n');
    process.exit(1);
  }

  console.log(`\nProvider: ${provider}`);

  // Get resorts for this provider
  const allResorts = provider === 'vail'
    ? configLoader.getResortsByProvider(config, 'vail')
    : configLoader.getResortsByProvider(config, 'ikon');

  // Filter to in-season resorts
  const inSeasonResorts = allResorts.filter(resort =>
    seasonUtils.isResortInSeason(resort, config)
  );

  console.log(`\n📋 Found ${inSeasonResorts.length} in-season ${provider} resort(s)`);

  if (inSeasonResorts.length === 0) {
    console.log('\n✅ No resorts in season, skipping\n');
    return;
  }

  let scrapedData = [];

  if (provider === 'vail') {
    // Scrape Vail resorts using Puppeteer (batched)
    scrapedData = await scrapeVailResorts(inSeasonResorts);

    // Close browser
    if (sharedBrowser) {
      await sharedBrowser.close();
      sharedBrowser = null;
      console.log('\n🧹 Browser closed');
    }
  } else {
    // Scrape Ikon resorts using Inspector API (single call)
    scrapedData = await scrapeIkonResorts(inSeasonResorts);
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log(`📊 Summary: ${scrapedData.length} resort(s) scraped`);
  console.log('='.repeat(80));

  // Generate aggregated latest-snow.json
  if (scrapedData.length > 0) {
    console.log('\n📦 Updating latest-snow.json...');
    generateLatestSnowFile(scrapedData);
  }

  console.log('\n✅ Snow scraping complete!\n');

  // Close database connection
  if (db) {
    closeDatabase(db);
    console.log('🔒 Database connection closed\n');
  }
}

main();
