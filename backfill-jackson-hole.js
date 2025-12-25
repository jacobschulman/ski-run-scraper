#!/usr/bin/env node
// backfill-jackson-hole.js - Backfill Jackson Hole snow data from Zaneray API
// This script fetches current data and updates all historical files with the correct format

const https = require('https');
const fs = require('fs');
const path = require('path');

const ZANERAY_API_URL = 'https://jacksonhole-prod.zaneray.com/api/all.json';
const SNOW_DIR = path.join(__dirname, 'data', 'jacksonhole', 'snow');

/**
 * Fetch data from Zaneray API
 */
function fetchZanerayData() {
  return new Promise((resolve, reject) => {
    console.log(`📡 Fetching data from: ${ZANERAY_API_URL}`);

    const urlObj = new URL(ZANERAY_API_URL);
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
            reject(new Error(`Failed to parse JSON: ${error.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });

    req.end();
  });
}

/**
 * Convert Zaneray data to our snow report format
 */
function normalizeZaneraySnowReport(zanerayData, dateStr) {
  const snow = zanerayData.snow || {};
  const weather = zanerayData.weather || {};
  const now = new Date();

  const toNumber = (value) => {
    if (value === '' || value === '--' || value === null || value === undefined) return null;
    const num = parseFloat(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? num : null;
  };

  const pickNumber = (...values) => {
    for (const value of values) {
      const num = toNumber(value);
      if (num !== null) return num;
    }
    return 0;
  };

  const midMountain = snow.midMountain || {};
  const tramSummit = snow.tramSummit || {};
  const base = snow.base || {};

  const midWeather = weather.midMountain || weather['mid-mountain'] || {};
  const summitWeather = weather.tramSummit || weather['tram-summit'] || {};
  const baseWeather = weather.base || {};

  const normalizeConditionLevel = (weatherData, name) => {
    if (!weatherData || Object.keys(weatherData).length === 0) return null;
    return {
      location: name,
      name: name,
      updated: weatherData.lastModified || null,
      temperature_f: toNumber(weatherData.temperatureF || weatherData.temperature),
      temperature_c: toNumber(weatherData.temperatureC),
      wind_direction: weatherData.windDirection || null,
      wind_speed_mph: toNumber(weatherData.windSpeedMph || weatherData.windSpeed),
      wind_gusts_mph: toNumber(weatherData.windGustsMph),
      skies: weatherData.conditions || weatherData.skies || null,
      conditions: weatherData.conditions || null
    };
  };

  return {
    resort: 'jacksonhole',
    resortName: 'Jackson Hole',
    date: dateStr,
    timestamp: now.toISOString(),
    lastUpdated: snow.lastModified || zanerayData.lastModified || null,
    conditions: snow.detail || snow.psa || null,
    operatingStatus: zanerayData.liftStatus || null,

    snowfall: {
      overnight_inches: pickNumber(tramSummit.newSnowSinceLiftsClosed, midMountain.newSnowSinceLiftsClosed, base.newSnowSinceLiftsClosed),
      overnight_cm: Math.round(pickNumber(tramSummit.newSnowSinceLiftsClosed, midMountain.newSnowSinceLiftsClosed) * 2.54),
      "24hour_inches": pickNumber(tramSummit.newSnowLast24H, midMountain.newSnowLast24H, base.newSnowLast24H),
      "24hour_cm": Math.round(pickNumber(tramSummit.newSnowLast24H, midMountain.newSnowLast24H) * 2.54),
      "48hour_inches": pickNumber(tramSummit.newSnowLast48H, midMountain.newSnowLast48H, base.newSnowLast48H),
      "48hour_cm": Math.round(pickNumber(tramSummit.newSnowLast48H, midMountain.newSnowLast48H) * 2.54),
      "7day_inches": pickNumber(tramSummit.newSnowLast7D, midMountain.newSnowLast7D, base.newSnowLast7D),
      "7day_cm": Math.round(pickNumber(tramSummit.newSnowLast7D, midMountain.newSnowLast7D) * 2.54),
      season_total_inches: pickNumber(tramSummit.seasonTotalSnow, midMountain.seasonTotalSnow, base.seasonTotalSnow),
      season_total_cm: Math.round(pickNumber(tramSummit.seasonTotalSnow, midMountain.seasonTotalSnow) * 2.54)
    },

    baseDepth: {
      inches: pickNumber(midMountain.totalSnowDepth, tramSummit.totalSnowDepth, base.totalSnowDepth),
      cm: Math.round(pickNumber(midMountain.totalSnowDepth, tramSummit.totalSnowDepth) * 2.54),
      range_inches: null,
      range_cm: null
    },

    terrain: {
      totalTrails: 0,
      openTrails: 0,
      groomedTrails: 0,
      totalLifts: 0,
      openLifts: 0
    },

    activities: {},

    currentConditions: {
      base: normalizeConditionLevel(baseWeather, 'Base'),
      midMountain: normalizeConditionLevel(midWeather, 'Mid Mountain'),
      summit: normalizeConditionLevel(summitWeather, 'Summit'),
      lastUpdated: weather.lastModified || null
    },

    forecast: null, // Simplified for backfill
    provider: 'ikon',
    apiProvider: 'zaneray'
  };
}

/**
 * Read existing file and extract forecast data to preserve
 */
function readExistingForecast(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data.forecast || null;
  } catch {
    return null;
  }
}

/**
 * Get list of all snow JSON files
 */
function getSnowFiles() {
  const files = fs.readdirSync(SNOW_DIR)
    .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.json$/))
    .sort();
  return files;
}

/**
 * Main backfill function
 */
async function backfill() {
  console.log('🎿 Jackson Hole Snow Data Backfill');
  console.log('='.repeat(60));

  const startTime = Date.now();
  const results = {
    updated: [],
    skipped: [],
    errors: []
  };

  try {
    // Fetch current data from Zaneray API
    const zanerayData = await fetchZanerayData();
    console.log('✓ Successfully fetched Zaneray API data\n');

    // Extract current snow values
    const snow = zanerayData.snow || {};
    const midMountain = snow.midMountain || {};
    const tramSummit = snow.tramSummit || {};

    console.log('📊 Current Snow Data from API:');
    console.log(`   Season Total (Summit): ${tramSummit.seasonTotalSnow || 'N/A'}" `);
    console.log(`   Season Total (Mid): ${midMountain.seasonTotalSnow || 'N/A'}"`);
    console.log(`   Base Depth (Mid): ${midMountain.totalSnowDepth || 'N/A'}"`);
    console.log(`   7-Day Snow: ${tramSummit.newSnowLast7D || midMountain.newSnowLast7D || 'N/A'}"`);
    console.log(`   48hr Snow: ${tramSummit.newSnowLast48H || midMountain.newSnowLast48H || 'N/A'}"`);
    console.log(`   24hr Snow: ${tramSummit.newSnowLast24H || midMountain.newSnowLast24H || 'N/A'}"`);
    console.log(`   Overnight: ${tramSummit.newSnowSinceLiftsClosed || midMountain.newSnowSinceLiftsClosed || 'N/A'}"\n`);

    // Get all existing files
    const files = getSnowFiles();
    console.log(`📁 Found ${files.length} historical snow data files\n`);
    console.log('='.repeat(60));

    // Process each file
    for (const file of files) {
      const filePath = path.join(SNOW_DIR, file);
      const dateStr = file.replace('.json', '');

      try {
        // Read existing file to preserve forecast
        const existingForecast = readExistingForecast(filePath);

        // Create normalized data
        const normalizedData = normalizeZaneraySnowReport(zanerayData, dateStr);

        // Preserve existing forecast if available
        if (existingForecast) {
          normalizedData.forecast = existingForecast;
        }

        // Write updated file
        fs.writeFileSync(filePath, JSON.stringify(normalizedData, null, 2));
        results.updated.push({ file, date: dateStr });
        console.log(`✓ Updated ${file}`);

      } catch (error) {
        results.errors.push({ file, error: error.message });
        console.error(`✗ Error updating ${file}: ${error.message}`);
      }
    }

    // Update latest.json
    const latestPath = path.join(SNOW_DIR, 'latest.json');
    const today = new Date().toISOString().split('T')[0];
    const latestData = normalizeZaneraySnowReport(zanerayData, today);
    const existingLatestForecast = readExistingForecast(latestPath);
    if (existingLatestForecast) {
      latestData.forecast = existingLatestForecast;
    }
    fs.writeFileSync(latestPath, JSON.stringify(latestData, null, 2));
    results.updated.push({ file: 'latest.json', date: today });
    console.log(`✓ Updated latest.json\n`);

  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    results.errors.push({ file: 'API', error: error.message });
  }

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  // Print summary
  console.log('='.repeat(60));
  console.log('📊 BACKFILL REPORT');
  console.log('='.repeat(60));
  console.log(`\n⏱️  Duration: ${duration} seconds`);
  console.log(`\n✅ Successfully Updated: ${results.updated.length} files`);

  if (results.updated.length > 0) {
    console.log('\n   Updated files:');
    results.updated.forEach(r => console.log(`   - ${r.file} (${r.date})`));
  }

  if (results.errors.length > 0) {
    console.log(`\n❌ Errors: ${results.errors.length}`);
    results.errors.forEach(r => console.log(`   - ${r.file}: ${r.error}`));
  }

  console.log('\n⚠️  Note: Historical daily snowfall values (overnight, 24hr, etc.) are');
  console.log('   from the current API snapshot, not the actual historical values.');
  console.log('   Season totals and base depth reflect current conditions.');
  console.log('='.repeat(60));

  return results;
}

// Run backfill
backfill().catch(console.error);
