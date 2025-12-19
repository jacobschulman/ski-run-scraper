#!/usr/bin/env node

/**
 * Generate daily aggregate data ("Mega Recap")
 * Combines all resort data into superlatives, rankings, and regional summaries
 */

const fs = require('fs');
const path = require('path');
const { REGIONS, getRegion, getAllRegions } = require('./lib/regions');

const DATA_DIR = path.join(__dirname, 'data');
const AGGREGATES_DIR = path.join(DATA_DIR, 'aggregates');

/**
 * Main entry point
 */
async function main() {
  const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
  const resorts = config.resorts;

  // Get today's date
  const today = new Date().toISOString().split('T')[0];

  console.log(`Generating aggregates for ${today}...`);
  console.log(`Processing ${resorts.length} resorts`);

  // Collect data for all resorts
  const resortData = {};
  const resortsWithSnow = [];
  const resortsWithTerrain = [];
  const missingSnow = [];
  const missingTerrain = [];
  const staleData = [];

  for (const resort of resorts) {
    const data = collectResortData(resort.key, resort.name, today);
    resortData[resort.key] = data;

    if (data.snow) {
      resortsWithSnow.push(resort.key);
    } else {
      missingSnow.push(resort.key);
    }

    if (data.terrain) {
      resortsWithTerrain.push(resort.key);
    } else {
      missingTerrain.push(resort.key);
    }

    // Check for stale data (more than 2 days old)
    if (data.lastSnowDate && daysDiff(data.lastSnowDate, today) > 2) {
      staleData.push({
        resort: resort.key,
        type: 'snow',
        last_update: data.lastSnowDate,
        days_stale: daysDiff(data.lastSnowDate, today)
      });
    }
    if (data.lastTerrainDate && daysDiff(data.lastTerrainDate, today) > 2) {
      staleData.push({
        resort: resort.key,
        type: 'terrain',
        last_update: data.lastTerrainDate,
        days_stale: daysDiff(data.lastTerrainDate, today)
      });
    }
  }

  // Build the aggregate
  const aggregate = {
    date: today,
    generated: new Date().toISOString(),

    superlatives: computeSuperlatives(resortData),
    rankings: computeRankings(resortData),
    regions: computeRegionalAggregates(resortData, resorts),
    resorts: resortData,

    totals: computeTotals(resortData, resorts),

    coverage: {
      with_snow_data: resortsWithSnow,
      with_terrain_data: resortsWithTerrain,
      missing_snow_data: missingSnow,
      missing_terrain_data: missingTerrain,
      stale_data: staleData
    }
  };

  // Ensure output directory exists
  if (!fs.existsSync(AGGREGATES_DIR)) {
    fs.mkdirSync(AGGREGATES_DIR, { recursive: true });
  }

  // Write dated file
  const datedPath = path.join(AGGREGATES_DIR, `${today}.json`);
  fs.writeFileSync(datedPath, JSON.stringify(aggregate, null, 2));
  console.log(`Wrote ${datedPath}`);

  // Write latest.json
  const latestPath = path.join(AGGREGATES_DIR, 'latest.json');
  fs.writeFileSync(latestPath, JSON.stringify(aggregate, null, 2));
  console.log(`Wrote ${latestPath}`);

  // Update index.json
  updateIndex(today);

  // Print summary
  console.log('\n=== Summary ===');
  console.log(`Resorts with snow data: ${resortsWithSnow.length}/${resorts.length}`);
  console.log(`Resorts with terrain data: ${resortsWithTerrain.length}/${resorts.length}`);
  console.log(`Stale data entries: ${staleData.length}`);

  if (aggregate.superlatives.snow_overnight_max) {
    console.log(`\nTop snow overnight: ${aggregate.superlatives.snow_overnight_max.name} (${aggregate.superlatives.snow_overnight_max.value}")`);
  }
  if (aggregate.superlatives.trails_open_count_max) {
    console.log(`Most trails open: ${aggregate.superlatives.trails_open_count_max.name} (${aggregate.superlatives.trails_open_count_max.value})`);
  }
}

/**
 * Collect all data for a single resort
 */
function collectResortData(resortKey, resortName, today) {
  const region = getRegion(resortKey);

  const result = {
    name: resortName,
    region: region,
    has_data: false,
    snow: null,
    terrain: null,
    forecast: null,
    lastSnowDate: null,
    lastTerrainDate: null
  };

  // Find latest snow data (check today and previous days)
  const snowData = findLatestData(resortKey, 'snow', today, 7);
  if (snowData) {
    result.lastSnowDate = snowData.date;
    result.snow = {
      overnight: snowData.data.snowfall?.overnight_inches || 0,
      '24h': snowData.data.snowfall?.['24hour_inches'] || 0,
      '48h': snowData.data.snowfall?.['48hour_inches'] || 0,
      '7day': snowData.data.snowfall?.['7day_inches'] || 0,
      season: snowData.data.snowfall?.season_total_inches || 0,
      base_depth: snowData.data.baseDepth?.inches || 0
    };
    result.has_data = true;

    // Extract forecast data
    result.forecast = extractForecast(snowData.data);
  }

  // Find latest terrain data
  const terrainData = findLatestData(resortKey, 'terrain', today, 7);
  if (terrainData) {
    result.lastTerrainDate = terrainData.date;
    const stats = computeTerrainStats(terrainData.data);
    result.terrain = stats;
    result.has_data = true;
  }

  return result;
}

/**
 * Find the latest data file within lookback days
 */
function findLatestData(resortKey, dataType, startDate, lookbackDays) {
  const dir = path.join(DATA_DIR, resortKey, dataType);

  if (!fs.existsSync(dir)) {
    return null;
  }

  // Try each date starting from today
  let date = new Date(startDate);
  for (let i = 0; i < lookbackDays; i++) {
    const dateStr = date.toISOString().split('T')[0];
    const filePath = path.join(dir, `${dateStr}.json`);

    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return { date: dateStr, data };
      } catch (e) {
        // Skip corrupted files
      }
    }

    date.setDate(date.getDate() - 1);
  }

  return null;
}

/**
 * Compute terrain statistics from raw terrain data
 */
function computeTerrainStats(terrainData) {
  if (!terrainData.GroomingAreas) {
    return null;
  }

  let trailsOpen = 0;
  let trailsTotal = 0;
  let trailsGroomed = 0;
  let liftsOpen = 0;
  let liftsTotal = 0;

  for (const area of terrainData.GroomingAreas) {
    if (area.Trails) {
      for (const trail of area.Trails) {
        trailsTotal++;
        if (trail.IsOpen) {
          trailsOpen++;
          if (trail.IsGroomed) {
            trailsGroomed++;
          }
        }
      }
    }
    if (area.Lifts) {
      for (const lift of area.Lifts) {
        liftsTotal++;
        if (lift.IsOpen) {
          liftsOpen++;
        }
      }
    }
  }

  return {
    trails_open: trailsOpen,
    trails_total: trailsTotal,
    trails_open_pct: trailsTotal > 0 ? Math.round((trailsOpen / trailsTotal) * 1000) / 1000 : 0,
    trails_groomed: trailsGroomed,
    trails_groomed_pct: trailsOpen > 0 ? Math.round((trailsGroomed / trailsOpen) * 1000) / 1000 : 0,
    lifts_open: liftsOpen,
    lifts_total: liftsTotal,
    lifts_open_pct: liftsTotal > 0 ? Math.round((liftsOpen / liftsTotal) * 1000) / 1000 : 0
  };
}

/**
 * Compute superlatives (max/min for each metric)
 */
function computeSuperlatives(resortData) {
  const superlatives = {};

  const metrics = [
    { key: 'snow_overnight', getter: d => d.snow?.overnight, hasMin: true },
    { key: 'snow_24h', getter: d => d.snow?.['24h'], hasMin: true },
    { key: 'snow_48h', getter: d => d.snow?.['48h'], hasMin: false },
    { key: 'snow_7day', getter: d => d.snow?.['7day'], hasMin: false },
    { key: 'snow_season', getter: d => d.snow?.season, hasMin: true },
    { key: 'base_depth', getter: d => d.snow?.base_depth, hasMin: true },
    { key: 'trails_open_count', getter: d => d.terrain?.trails_open, hasMin: true },
    { key: 'trails_open_pct', getter: d => d.terrain?.trails_open_pct, hasMin: true },
    { key: 'trails_groomed_count', getter: d => d.terrain?.trails_groomed, hasMin: false },
    { key: 'trails_groomed_pct', getter: d => d.terrain?.trails_groomed_pct, hasMin: false },
    { key: 'lifts_open_count', getter: d => d.terrain?.lifts_open, hasMin: false },
    { key: 'lifts_open_pct', getter: d => d.terrain?.lifts_open_pct, hasMin: false }
  ];

  for (const metric of metrics) {
    const entries = Object.entries(resortData)
      .filter(([_, d]) => {
        const val = metric.getter(d);
        return val !== null && val !== undefined;
      })
      .map(([key, d]) => ({
        resort: key,
        name: d.name,
        region: d.region,
        value: metric.getter(d)
      }));

    if (entries.length === 0) continue;

    // Max
    const max = entries.reduce((a, b) => a.value > b.value ? a : b);
    superlatives[`${metric.key}_max`] = max;

    // Min (only for metrics where min is meaningful)
    if (metric.hasMin) {
      const min = entries.reduce((a, b) => a.value < b.value ? a : b);
      superlatives[`${metric.key}_min`] = min;
    }
  }

  return superlatives;
}

/**
 * Compute rankings (all resorts sorted for each metric)
 */
function computeRankings(resortData) {
  const rankings = {};

  const metrics = [
    { key: 'snow_overnight', getter: d => d.snow?.overnight },
    { key: 'snow_24h', getter: d => d.snow?.['24h'] },
    { key: 'snow_48h', getter: d => d.snow?.['48h'] },
    { key: 'snow_7day', getter: d => d.snow?.['7day'] },
    { key: 'snow_season', getter: d => d.snow?.season },
    { key: 'base_depth', getter: d => d.snow?.base_depth },
    { key: 'trails_open_count', getter: d => d.terrain?.trails_open },
    { key: 'trails_open_pct', getter: d => d.terrain?.trails_open_pct },
    { key: 'trails_groomed_count', getter: d => d.terrain?.trails_groomed },
    { key: 'trails_groomed_pct', getter: d => d.terrain?.trails_groomed_pct },
    { key: 'lifts_open_count', getter: d => d.terrain?.lifts_open },
    { key: 'lifts_open_pct', getter: d => d.terrain?.lifts_open_pct }
  ];

  for (const metric of metrics) {
    const entries = Object.entries(resortData)
      .filter(([_, d]) => {
        const val = metric.getter(d);
        return val !== null && val !== undefined;
      })
      .map(([key, d]) => ({
        resort: key,
        name: d.name,
        region: d.region,
        value: metric.getter(d)
      }))
      .sort((a, b) => b.value - a.value);

    rankings[metric.key] = entries;
  }

  return rankings;
}

/**
 * Compute regional aggregates
 */
function computeRegionalAggregates(resortData, allResorts) {
  const regions = {};

  for (const regionName of getAllRegions()) {
    const regionResorts = Object.entries(resortData)
      .filter(([key, _]) => getRegion(key) === regionName);

    if (regionResorts.length === 0) continue;

    const resortKeys = regionResorts.map(([k, _]) => k);
    const resortsReporting = regionResorts.filter(([_, d]) => d.has_data).length;

    // Compute totals
    const totals = {
      trails_open: 0,
      trails_groomed: 0,
      trails_total: 0,
      lifts_open: 0,
      snow_24h: 0
    };

    // Compute averages (only from resorts with data)
    const avgData = {
      base_depth: [],
      trails_open_pct: [],
      trails_groomed_pct: [],
      snow_overnight: []
    };

    for (const [_, data] of regionResorts) {
      if (data.terrain) {
        totals.trails_open += data.terrain.trails_open || 0;
        totals.trails_groomed += data.terrain.trails_groomed || 0;
        totals.trails_total += data.terrain.trails_total || 0;
        totals.lifts_open += data.terrain.lifts_open || 0;

        if (data.terrain.trails_open_pct !== undefined) {
          avgData.trails_open_pct.push(data.terrain.trails_open_pct);
        }
        if (data.terrain.trails_groomed_pct !== undefined) {
          avgData.trails_groomed_pct.push(data.terrain.trails_groomed_pct);
        }
      }

      if (data.snow) {
        totals.snow_24h += data.snow['24h'] || 0;

        if (data.snow.base_depth) {
          avgData.base_depth.push(data.snow.base_depth);
        }
        if (data.snow.overnight !== undefined) {
          avgData.snow_overnight.push(data.snow.overnight);
        }
      }
    }

    const averages = {
      base_depth: avg(avgData.base_depth),
      trails_open_pct: avg(avgData.trails_open_pct),
      trails_groomed_pct: avg(avgData.trails_groomed_pct),
      snow_overnight: avg(avgData.snow_overnight)
    };

    regions[regionName] = {
      resorts: resortKeys,
      resort_count: resortKeys.length,
      resorts_reporting: resortsReporting,
      totals,
      averages
    };
  }

  return regions;
}

/**
 * Compute network-wide totals
 */
function computeTotals(resortData, allResorts) {
  let trailsOpen = 0;
  let trailsTotal = 0;
  let trailsGroomed = 0;
  let liftsOpen = 0;
  let snow24hSum = 0;
  let resortsReporting = 0;

  for (const data of Object.values(resortData)) {
    if (data.has_data) {
      resortsReporting++;
    }

    if (data.terrain) {
      trailsOpen += data.terrain.trails_open || 0;
      trailsTotal += data.terrain.trails_total || 0;
      trailsGroomed += data.terrain.trails_groomed || 0;
      liftsOpen += data.terrain.lifts_open || 0;
    }

    if (data.snow) {
      snow24hSum += data.snow['24h'] || 0;
    }
  }

  return {
    resorts_total: allResorts.length,
    resorts_reporting: resortsReporting,
    trails_open: trailsOpen,
    trails_total: trailsTotal,
    trails_groomed: trailsGroomed,
    lifts_open: liftsOpen,
    snow_24h_sum: snow24hSum
  };
}

/**
 * Update the index.json manifest
 */
function updateIndex(today) {
  const indexPath = path.join(AGGREGATES_DIR, 'index.json');

  let index = { files: [], lastUpdated: null };
  if (fs.existsSync(indexPath)) {
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch (e) {
      // Start fresh if corrupted
    }
  }

  // Add today if not already present
  if (!index.files.includes(today)) {
    index.files.push(today);
    index.files.sort().reverse(); // Most recent first
  }

  index.lastUpdated = new Date().toISOString();

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  console.log(`Updated ${indexPath}`);
}

/**
 * Helper: Calculate average of array
 */
function avg(arr) {
  if (arr.length === 0) return 0;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
}

/**
 * Helper: Calculate days difference between two date strings
 */
function daysDiff(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2 - d1);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Extract forecast data from snow report
 * Uses first location (base elevation) for simplicity
 */
function extractForecast(snowData) {
  if (!snowData.forecast?.locations?.length) {
    return null;
  }

  const location = snowData.forecast.locations[0];
  const today = location.today;
  const forecastDays = location.forecast_days || [];

  // Calculate total expected snowfall over forecast period
  let totalSnowExpected = 0;
  const dailyForecasts = forecastDays.map(day => {
    const daySnow = (day.snowfall_day_inches || 0) + (day.snowfall_night_inches || 0);
    totalSnowExpected += daySnow;
    return {
      date: day.date?.split('T')[0] || null,
      high_f: day.high_f,
      low_f: day.low_f,
      description: day.description,
      snow_inches: daySnow
    };
  });

  return {
    today: today ? {
      high_f: today.high_f,
      low_f: today.low_f,
      description: today.description,
      snow_inches: (today.snowfall_day_inches || 0) + (today.snowfall_night_inches || 0)
    } : null,
    upcoming_days: dailyForecasts,
    total_snow_expected: totalSnowExpected
  };
}

// Run
main().catch(err => {
  console.error('Error generating aggregates:', err);
  process.exit(1);
});
