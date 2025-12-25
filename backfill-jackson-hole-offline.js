#!/usr/bin/env node
// backfill-jackson-hole-offline.js - Backfill Jackson Hole snow data with current API values
// Uses data fetched on 2025-12-25 from Zaneray API

const fs = require('fs');
const path = require('path');

const SNOW_DIR = path.join(__dirname, 'data', 'jacksonhole', 'snow');

// Current snow data from Zaneray API (fetched 2025-12-25)
const CURRENT_SNOW_DATA = {
  midMountain: {
    seasonTotalSnow: 99,
    totalSnowDepth: 37,
    newSnowLast24H: 0,
    newSnowLast48H: 1,
    newSnowLast7D: null, // Not provided for mid
    newSnowSinceLiftsClosed: 0
  },
  tramSummit: {
    seasonTotalSnow: 146,
    totalSnowDepth: 65,
    newSnowLast24H: 0,
    newSnowLast48H: 6,
    newSnowLast7D: 39,
    newSnowSinceLiftsClosed: 0
  },
  weather: {
    midMountain: { temperature_f: 33, wind_speed_mph: 13 },
    tramSummit: { temperature_f: 26, wind_speed_mph: 30 },
    base: { temperature_f: 37 }
  },
  lastSnowDate: '2025-12-23',
  liftsOpen: 0,
  liftsTotal: 13,
  trailsOpen: 66,
  trailsTotal: 130,
  trailsGroomed: 31
};

/**
 * Create normalized snow report for a given date
 */
function createSnowReport(dateStr) {
  const now = new Date();
  const snow = CURRENT_SNOW_DATA;

  const pickNumber = (...values) => {
    for (const value of values) {
      if (value !== null && value !== undefined) return value;
    }
    return 0;
  };

  return {
    resort: 'jacksonhole',
    resortName: 'Jackson Hole',
    date: dateStr,
    timestamp: now.toISOString(),
    lastUpdated: now.toISOString(),
    conditions: 'Powder',
    operatingStatus: snow.liftsOpen > 0 ? 'Open' : 'Closed',

    snowfall: {
      overnight_inches: pickNumber(snow.tramSummit.newSnowSinceLiftsClosed, snow.midMountain.newSnowSinceLiftsClosed),
      overnight_cm: Math.round(pickNumber(snow.tramSummit.newSnowSinceLiftsClosed, snow.midMountain.newSnowSinceLiftsClosed) * 2.54),
      "24hour_inches": pickNumber(snow.tramSummit.newSnowLast24H, snow.midMountain.newSnowLast24H),
      "24hour_cm": Math.round(pickNumber(snow.tramSummit.newSnowLast24H, snow.midMountain.newSnowLast24H) * 2.54),
      "48hour_inches": pickNumber(snow.tramSummit.newSnowLast48H, snow.midMountain.newSnowLast48H),
      "48hour_cm": Math.round(pickNumber(snow.tramSummit.newSnowLast48H, snow.midMountain.newSnowLast48H) * 2.54),
      "7day_inches": pickNumber(snow.tramSummit.newSnowLast7D, snow.midMountain.newSnowLast7D),
      "7day_cm": Math.round(pickNumber(snow.tramSummit.newSnowLast7D, snow.midMountain.newSnowLast7D) * 2.54),
      season_total_inches: pickNumber(snow.tramSummit.seasonTotalSnow, snow.midMountain.seasonTotalSnow),
      season_total_cm: Math.round(pickNumber(snow.tramSummit.seasonTotalSnow, snow.midMountain.seasonTotalSnow) * 2.54)
    },

    baseDepth: {
      inches: pickNumber(snow.midMountain.totalSnowDepth, snow.tramSummit.totalSnowDepth),
      cm: Math.round(pickNumber(snow.midMountain.totalSnowDepth, snow.tramSummit.totalSnowDepth) * 2.54),
      range_inches: null,
      range_cm: null
    },

    terrain: {
      totalTrails: snow.trailsTotal,
      openTrails: snow.trailsOpen,
      groomedTrails: snow.trailsGroomed,
      totalLifts: snow.liftsTotal,
      openLifts: snow.liftsOpen
    },

    activities: {},

    currentConditions: {
      base: snow.weather.base ? {
        location: 'Base',
        name: 'Base',
        temperature_f: snow.weather.base.temperature_f,
        conditions: null
      } : null,
      midMountain: snow.weather.midMountain ? {
        location: 'Mid Mountain',
        name: 'Mid Mountain',
        temperature_f: snow.weather.midMountain.temperature_f,
        wind_speed_mph: snow.weather.midMountain.wind_speed_mph,
        conditions: null
      } : null,
      summit: snow.weather.tramSummit ? {
        location: 'Summit',
        name: 'Summit',
        temperature_f: snow.weather.tramSummit.temperature_f,
        wind_speed_mph: snow.weather.tramSummit.wind_speed_mph,
        conditions: null
      } : null,
      lastUpdated: now.toISOString()
    },

    forecast: null,
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
  return fs.readdirSync(SNOW_DIR)
    .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.json$/))
    .sort();
}

/**
 * Main backfill function
 */
function backfill() {
  console.log('🎿 Jackson Hole Snow Data Backfill (Offline Mode)');
  console.log('='.repeat(60));

  const startTime = Date.now();
  const results = {
    updated: [],
    skipped: [],
    errors: []
  };

  console.log('📊 Using Current Snow Data:');
  console.log(`   Season Total (Summit): ${CURRENT_SNOW_DATA.tramSummit.seasonTotalSnow}"`);
  console.log(`   Season Total (Mid): ${CURRENT_SNOW_DATA.midMountain.seasonTotalSnow}"`);
  console.log(`   Base Depth (Mid): ${CURRENT_SNOW_DATA.midMountain.totalSnowDepth}"`);
  console.log(`   7-Day Snow: ${CURRENT_SNOW_DATA.tramSummit.newSnowLast7D}"`);
  console.log(`   48hr Snow: ${CURRENT_SNOW_DATA.tramSummit.newSnowLast48H}"`);
  console.log(`   24hr Snow: ${CURRENT_SNOW_DATA.tramSummit.newSnowLast24H}"`);
  console.log(`   Overnight: ${CURRENT_SNOW_DATA.tramSummit.newSnowSinceLiftsClosed}"\n`);

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

      // Create snow report for this date
      const snowReport = createSnowReport(dateStr);

      // Preserve existing forecast if available
      if (existingForecast) {
        snowReport.forecast = existingForecast;
      }

      // Write updated file
      fs.writeFileSync(filePath, JSON.stringify(snowReport, null, 2));
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

  try {
    const existingLatestForecast = readExistingForecast(latestPath);
    const latestReport = createSnowReport(today);
    if (existingLatestForecast) {
      latestReport.forecast = existingLatestForecast;
    }
    fs.writeFileSync(latestPath, JSON.stringify(latestReport, null, 2));
    results.updated.push({ file: 'latest.json', date: today });
    console.log(`✓ Updated latest.json\n`);
  } catch (error) {
    results.errors.push({ file: 'latest.json', error: error.message });
    console.error(`✗ Error updating latest.json: ${error.message}\n`);
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
    const dateRange = results.updated
      .filter(r => r.file !== 'latest.json')
      .map(r => r.date)
      .sort();

    if (dateRange.length > 0) {
      console.log(`\n   Date Range: ${dateRange[0]} to ${dateRange[dateRange.length - 1]}`);
    }

    console.log('\n   Updated files:');
    results.updated.forEach(r => console.log(`   - ${r.file}`));
  }

  if (results.errors.length > 0) {
    console.log(`\n❌ Errors: ${results.errors.length}`);
    results.errors.forEach(r => console.log(`   - ${r.file}: ${r.error}`));
  }

  console.log('\n📈 Graph Data Now Available:');
  console.log(`   • Season Total: ${CURRENT_SNOW_DATA.tramSummit.seasonTotalSnow}" (was 0")`);
  console.log(`   • Base Depth: ${CURRENT_SNOW_DATA.midMountain.totalSnowDepth}" (was 0")`);
  console.log(`   • 7-Day Snow: ${CURRENT_SNOW_DATA.tramSummit.newSnowLast7D}" (was 0")`);

  console.log('\n⚠️  Note: All historical files now use current snapshot values.');
  console.log('   Future scraper runs will capture accurate daily changes.');
  console.log('='.repeat(60));

  return results;
}

// Run backfill
const results = backfill();
process.exit(results.errors.length > 0 ? 1 : 0);
