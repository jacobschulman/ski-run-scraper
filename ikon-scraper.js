// ikon-scraper.js - Ikon Pass terrain/snow data scraper
// Uses Inspector API (mtnpowder.com) for better performance and reliability (no Puppeteer needed)
//
// ═══════════════════════════════════════════════════════════════════════════════
// API DOCUMENTATION
// ═══════════════════════════════════════════════════════════════════════════════
//
// API Endpoint: https://mtnpowder.com/feed/v3.json
// Provider: Ikon Pass resorts (configured with provider: "ikon" in config.json)
// Authentication: Bearer token (configured in config.json under inspector.bearerToken)
// Data Source: Single HTTP call fetches all 123 Ikon resorts, filtered by configured resorts
//
// ═══════════════════════════════════════════════════════════════════════════════
// USAGE
// ═══════════════════════════════════════════════════════════════════════════════
//
// node ikon-scraper.js [terrain|snow|both]
//
// Arguments:
//   terrain  - Scrape terrain/grooming data only (default)
//   snow     - Scrape snow reports only
//   both     - Scrape both terrain and snow data
//
// Default: terrain only (snow is handled by snow-scraper.js hourly workflow)
//
// ═══════════════════════════════════════════════════════════════════════════════

const https = require('https');
const fs = require('fs');
const path = require('path');
const {
  initializeDatabase,
  getOrCreateResort,
  saveTerrainStatus,
  saveSnowConditions,
  closeDatabase
} = require('./database');

const configLoader = require('./lib/config-loader');
const seasonUtils = require('./lib/season-utils');
const fileStorage = require('./lib/file-storage');
const dataNormalization = require('./lib/data-normalization');
const briefGenerator = require('./lib/brief-generator');
const providers = require('./lib/providers');

// Load configuration
const config = configLoader.loadConfig();
const RESORTS = configLoader.getResortsMap(config);

// Inspector API configuration
const INSPECTOR_API_URL = config.inspector?.apiUrl || 'https://mtnpowder.com/feed/v3.json';
const BEARER_TOKEN = config.inspector?.bearerToken || 'hPtaTVkbuyZQnrxvru4ApfpXnS21PJO3eTKdibDoLZE';
const LATEST_TERRAIN_FILE = path.join('data', 'latest.json');
const LATEST_SNOW_FILE = path.join('data', 'latest-snow.json');

// Initialize database connection
let db = null;
function getDb() {
  if (!db) {
    db = initializeDatabase();
  }
  return db;
}

/**
 * Generate lifts/index.json from terrain data's Lifts array
 * This makes Ikon lift data accessible in the same format as Vail lift data
 */
function generateLiftIndexFromTerrain(resortKey, resortName, normalizedData, provider = 'ikon', apiProvider = null) {
  const lifts = normalizedData.Lifts || [];

  if (lifts.length === 0) {
    console.log(`  ⏭️  No lift data to index for ${resortKey}`);
    return;
  }

  // Convert terrain lift format to lifts/index.json format
  const indexLifts = lifts.map((lift, idx) => {
    // Parse hours from various formats
    let openTime = null;
    let closeTime = null;
    if (lift.Hours) {
      if (typeof lift.Hours === 'string') {
        // Format: "10:00 - 3:30" or "10:00 AM - 3:30 PM"
        const match = lift.Hours.match(/(\d{1,2}:\d{2})\s*(?:AM|PM)?\s*-\s*(\d{1,2}:\d{2})/i);
        if (match) {
          openTime = match[1];
          closeTime = match[2];
        }
      } else if (typeof lift.Hours === 'object') {
        openTime = lift.Hours.Open || null;
        closeTime = lift.Hours.Close || null;
      }
    }

    // Generate a slug from the lift name
    const slug = lift.Name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/--+/g, '-')
      .trim();

    return {
      liftId: lift._dorId || lift._reportpalId || lift._zanerayId || lift._inspectorId || String(idx),
      name: lift.Name,
      slug: slug,
      mountain: lift._dorSector || lift._zanerayKey || 'Main',
      type: dataNormalization.formatLiftType(lift.LiftType),
      capacity: lift.Capacity || null,
      status: lift.Status || (lift.IsOpen ? 'Open' : 'Closed'),
      waitMinutes: (lift.WaitTime && lift.WaitTime !== '--' && lift.WaitTime !== 'N/A') ? lift.WaitTime : null,
      openTime: openTime,
      closeTime: closeTime,
      avgWaitTime: null, // No historical data for Ikon
      lastUpdated: normalizedData.Date || new Date().toISOString()
    };
  });

  // Sort by name
  indexLifts.sort((a, b) => a.name.localeCompare(b.name));

  const indexData = {
    resort: resortKey,
    resortName: resortName,
    provider: provider,
    apiProvider: apiProvider,
    liftCount: indexLifts.length,
    lifts: indexLifts,
    generated: new Date().toISOString()
  };

  // Ensure lifts directory exists
  const liftsDir = path.join('data', resortKey, 'lifts');
  fileStorage.ensureDirectoryExists(liftsDir);

  // Write index.json
  const indexPath = path.join(liftsDir, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
  console.log(`  ✓ Generated ${indexPath} (${indexLifts.length} lifts)`);
}

/**
 * Fetch all resort data from Inspector API
 * The API returns all 123 resorts in one call - no batching or filtering needed
 * @returns {Promise<Object>} - API response with all resort data
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
 * Save normalized Inspector terrain data (compatible with Vail format)
 */
function saveInspectorTerrainData(resortKey, inspectorData) {
  if (!inspectorData) {
    console.log('✗ No data returned from Inspector API');
    return null;
  }

  // Skip if resort doesn't have terrain data (MountainAreas)
  if (!inspectorData.MountainAreas || inspectorData.MountainAreas.length === 0) {
    console.log('⏭️  Skipping terrain data - resort does not provide terrain/lift data in Inspector API');
    return null;
  }

  const resort = RESORTS[resortKey];
  const resortName = resort.name;
  const resortTimezone = resort.timezone || 'America/Denver';
  const today = seasonUtils.getResortLocalDate(resortTimezone);

  // Normalize Inspector data to Vail format
  const normalizedData = dataNormalization.normalizeInspectorResort(inspectorData);

  // Add provider metadata
  const terrainDataWithProvider = {
    ...normalizedData,
    provider: resort.provider || 'vail'
  };

  // Ensure data directory structure exists
  const terrainDir = path.join('data', resortKey, 'terrain');
  fileStorage.ensureDirectoryExists(terrainDir);

  // Save timestamped file
  const timestampedFile = path.join(terrainDir, `${today}.json`);
  fs.writeFileSync(timestampedFile, JSON.stringify(terrainDataWithProvider, null, 2));
  console.log(`✓ Saved terrain data to ${timestampedFile}`);

  // Update per-resort terrain index (mirrors generate-terrain-indexes.js)
  const terrainFiles = fs.readdirSync(terrainDir)
    .filter(f => f.endsWith('.json') && f !== 'index.json')
    .map(f => f.replace(/\.json$/, ''))
    .sort()
    .reverse();

  if (terrainFiles.length > 0) {
    const terrainIndex = {
      resort: resortKey,
      resortName,
      provider: resort.provider || 'vail',
      files: terrainFiles,
      latest: terrainFiles[0] || null,
      count: terrainFiles.length,
      generated: new Date().toISOString()
    };

    const terrainIndexPath = path.join(terrainDir, 'index.json');
    fs.writeFileSync(terrainIndexPath, JSON.stringify(terrainIndex, null, 2));
    console.log(`✓ Updated ${terrainIndexPath} (${terrainFiles.length} files)`);
  }

  // Generate lifts/index.json from terrain data
  generateLiftIndexFromTerrain(resortKey, resortName, normalizedData, resort.provider || 'ikon', 'inspector');

  // Save to database with provider='inspector'
  const database = getDb();
  getOrCreateResort(database, resortKey, resortName, resortTimezone, (err, resortId) => {
    if (err) {
      console.error('  ⚠️  Database error (resort):', err.message);
    } else {
      saveTerrainStatus(database, resortId, today, { FMR: normalizedData }, (err, count) => {
        if (err) {
          console.error('  ⚠️  Database error (terrain):', err.message);
        } else if (count > 0) {
          console.log(`✓ Saved ${count} terrain records to database`);
        }

        // Generate trail-specific JSON files
        generateTrailData(resortKey, resortId, today, normalizedData);
      });
    }
  });

  // Print summary
  console.log('\n📊 Data Summary:');
  console.log(`   Resort: ${resortName}`);
  console.log(`   Resort ID: ${normalizedData.ResortId}`);
  console.log(`   Date: ${normalizedData.Date}`);
  console.log(`   Mountain Areas: ${normalizedData.GroomingAreas ? normalizedData.GroomingAreas.length : 0}`);
  console.log(`   Lifts: ${normalizedData.Lifts ? normalizedData.Lifts.length : 0}`);

  // Count trails
  if (normalizedData.GroomingAreas) {
    let totalTrails = 0;
    let openTrails = 0;
    let closedTrails = 0;
    let groomedTrails = 0;
    let openGroomed = 0;
    let openNotGroomed = 0;
    const groomedList = [];

    normalizedData.GroomingAreas.forEach(area => {
      area.Trails.forEach(trail => {
        totalTrails++;
        const isOpen = trail.IsOpen || trail.Status === 'Open';
        const isGroomed = !!trail.IsGroomed;

        if (isOpen) {
          openTrails++;
          if (isGroomed) {
            openGroomed++;
          } else {
            openNotGroomed++;
          }
        } else {
          closedTrails++;
        }

        if (isGroomed) {
          groomedTrails++;
          groomedList.push(`${area.Name} - ${trail.Name}`);
        }
      });
    });

    console.log(`   Total Trails: ${totalTrails}`);
    console.log(`   Open: ${openTrails} (Groomed: ${openGroomed}, Not Groomed: ${openNotGroomed})`);
    console.log(`   Closed: ${closedTrails}`);
    console.log(`   Groomed (all states): ${groomedTrails}`);

    if (groomedTrails > 0) {
      console.log('\n✓ Currently Groomed Trails:');
      groomedList.forEach(trail => console.log(`   - ${trail}`));
    }
  }

  return { resortKey, date: today, data: normalizedData };
}

/**
 * Save normalized Inspector snow report data
 */
function saveInspectorSnowData(resortKey, inspectorData) {
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
    provider: resort.provider || 'vail'
  };

  // Ensure directory structure exists
  const snowDir = path.join('data', resortKey, 'snow');
  fileStorage.ensureDirectoryExists(snowDir);

  // Save timestamped file (backward compatibility for consumers expecting JSON)
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
  console.log(`   Terrain: ${cleanData.terrain.openTrails}/${cleanData.terrain.totalTrails} trails, ${cleanData.terrain.openLifts}/${cleanData.terrain.totalLifts} lifts`);

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
 * Calculate grooming streak for a trail
 */
function calculateGroomingStreaks(records) {
  if (!records || records.length === 0) {
    return { currentStreak: 0, longestStreak: 0, lastGroomedDate: null };
  }

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
      break;
    }
  }

  // Calculate longest streak
  for (const record of sorted.reverse()) {
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
  const seasonStartDate = seasonUtils.getSeasonStartDate(resort, config);
  const database = getDb();

  console.log(`\n📄 Generating trail data files for ${resort.name}...`);
  console.log(`   Season start: ${seasonStartDate}`);

  // Ensure trails directory exists
  const trailsDataDir = path.join('data', resortKey, 'trails', 'data');
  fileStorage.ensureDirectoryExists(trailsDataDir);

  let trailCount = 0;

  // Process each mountain area and trail
  terrainData.GroomingAreas.forEach(area => {
    if (!area.Trails) return;

    area.Trails.forEach(trail => {
      const trailName = fileStorage.sanitizeTrailName(trail.Name);
      const trailSlug = fileStorage.slugifyTrailName(trailName);

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

          // Build historical records array (last 90 days max)
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

            // Current status
            currentStatus: {
              date: date,
              isOpen: trail.IsOpen,
              isGroomed: trail.IsGroomed,
              groomingStatus: trail.GroomingStatus || null,
              status: trail.Status || null
            },

            // Inspector-specific attributes (if present)
            attributes: {
              moguls: trail.Moguls || null,
              glades: trail.Glades || null,
              touring: trail.Touring || null,
              runOfTheDay: trail.RunOfTheDay || null,
              snowMaking: trail.SnowMaking || null,
              nightSkiing: trail.NightSkiing || null,
              nordic: trail.Nordic || null
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
            generated: new Date().toISOString(),
            provider: resort.provider || 'vail'
          };

          // Save trail JSON file
          const trailFile = path.join(trailsDataDir, `${trailSlug}.json`);
          fs.writeFileSync(trailFile, JSON.stringify(trailData, null, 2));

          trailCount++;
        }
      );
    });
  });

  // Give database queries time to complete, then print summary and generate index
  setTimeout(() => {
    console.log(`✓ Generated ${trailCount} trail data files`);
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
    provider: RESORTS[resortKey].provider || 'vail',
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
 * Save normalized terrain data from alternate providers (ReportPal, DOR, Zaneray)
 */
function saveAlternateProviderTerrainData(resortKey, normalizedData) {
  if (!normalizedData) {
    console.log('✗ No data to save');
    return null;
  }

  const resort = RESORTS[resortKey];
  const resortName = resort.name;
  const resortTimezone = resort.timezone || 'America/Denver';
  const today = seasonUtils.getResortLocalDate(resortTimezone);

  // Add provider metadata if not present
  const terrainDataWithProvider = {
    ...normalizedData,
    provider: resort.provider || 'ikon'
  };

  // Ensure data directory structure exists
  const terrainDir = path.join('data', resortKey, 'terrain');
  fileStorage.ensureDirectoryExists(terrainDir);

  // Save timestamped file
  const timestampedFile = path.join(terrainDir, `${today}.json`);
  fs.writeFileSync(timestampedFile, JSON.stringify(terrainDataWithProvider, null, 2));
  console.log(`✓ Saved terrain data to ${timestampedFile}`);

  // Update per-resort terrain index
  const terrainFiles = fs.readdirSync(terrainDir)
    .filter(f => f.endsWith('.json') && f !== 'index.json')
    .map(f => f.replace(/\.json$/, ''))
    .sort()
    .reverse();

  if (terrainFiles.length > 0) {
    const terrainIndex = {
      resort: resortKey,
      resortName,
      provider: resort.provider || 'ikon',
      apiProvider: resort.apiProvider || null,
      files: terrainFiles,
      latest: terrainFiles[0] || null,
      count: terrainFiles.length,
      generated: new Date().toISOString()
    };

    const terrainIndexPath = path.join(terrainDir, 'index.json');
    fs.writeFileSync(terrainIndexPath, JSON.stringify(terrainIndex, null, 2));
    console.log(`✓ Updated ${terrainIndexPath} (${terrainFiles.length} files)`);
  }

  // Generate lifts/index.json from terrain data
  generateLiftIndexFromTerrain(resortKey, resortName, normalizedData, resort.provider || 'ikon', resort.apiProvider);

  // Print summary
  console.log('\n📊 Data Summary:');
  console.log(`   Resort: ${resortName}`);
  console.log(`   Provider: ${resort.apiProvider}`);
  console.log(`   Date: ${normalizedData.Date}`);
  console.log(`   Mountain Areas: ${normalizedData.GroomingAreas ? normalizedData.GroomingAreas.length : 0}`);
  console.log(`   Lifts: ${normalizedData.Lifts ? normalizedData.Lifts.length : 0}`);

  // Count trails
  if (normalizedData.GroomingAreas) {
    let totalTrails = 0;
    let openTrails = 0;
    let groomedTrails = 0;

    normalizedData.GroomingAreas.forEach(area => {
      if (area.Trails) {
        area.Trails.forEach(trail => {
          totalTrails++;
          if (trail.IsOpen) openTrails++;
          if (trail.IsGroomed) groomedTrails++;
        });
      }
    });

    console.log(`   Total Trails: ${totalTrails}`);
    console.log(`   Open: ${openTrails}`);
    console.log(`   Groomed: ${groomedTrails}`);
  }

  return { resortKey, date: today, data: normalizedData };
}

/**
 * Scrape resorts from alternate providers (ReportPal, DOR, Zaneray)
 */
async function scrapeAlternateProviderResorts(resortsToScrape, scrapeOptions = {}) {
  const scrapedData = [];
  const { scrapeTerrain = true } = scrapeOptions;

  // Group resorts by their apiProvider
  const resortsByProvider = providers.groupResortsByProvider(resortsToScrape);

  // Process ReportPal resorts
  if (resortsByProvider.reportpal && resortsByProvider.reportpal.length > 0) {
    console.log(`\n📡 Processing ${resortsByProvider.reportpal.length} ReportPal resort(s)...`);

    for (const resort of resortsByProvider.reportpal) {
      try {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Processing ${resort.name} (ReportPal)...`);
        console.log('='.repeat(50));

        const rawData = await providers.fetchResortData(resort);
        const normalizedData = dataNormalization.normalizeReportPalResort(rawData, resort.key);

        if (scrapeTerrain) {
          const result = saveAlternateProviderTerrainData(resort.key, normalizedData);
          if (result) {
            scrapedData.push({ resortKey: resort.key, terrain: result, snow: null });
          }
        }
      } catch (error) {
        console.error(`❌ Error scraping ${resort.name}: ${error.message}`);
      }
    }
  }

  // Process DOR resorts
  if (resortsByProvider.dor && resortsByProvider.dor.length > 0) {
    console.log(`\n📡 Processing ${resortsByProvider.dor.length} DOR resort(s)...`);

    for (const resort of resortsByProvider.dor) {
      try {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Processing ${resort.name} (DOR)...`);
        console.log('='.repeat(50));

        const rawData = await providers.fetchResortData(resort);
        const normalizedData = dataNormalization.normalizeDORResort(rawData, resort.key);

        if (scrapeTerrain) {
          const result = saveAlternateProviderTerrainData(resort.key, normalizedData);
          if (result) {
            scrapedData.push({ resortKey: resort.key, terrain: result, snow: null });
          }
        }
      } catch (error) {
        console.error(`❌ Error scraping ${resort.name}: ${error.message}`);
      }
    }
  }

  // Process Zaneray resorts
  if (resortsByProvider.zaneray && resortsByProvider.zaneray.length > 0) {
    console.log(`\n📡 Processing ${resortsByProvider.zaneray.length} Zaneray resort(s)...`);

    for (const resort of resortsByProvider.zaneray) {
      try {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Processing ${resort.name} (Zaneray)...`);
        console.log('='.repeat(50));

        const rawData = await providers.fetchResortData(resort);
        const normalizedData = dataNormalization.normalizeZanerayResort(rawData, resort.key);

        if (scrapeTerrain) {
          const result = saveAlternateProviderTerrainData(resort.key, normalizedData);
          if (result) {
            scrapedData.push({ resortKey: resort.key, terrain: result, snow: null });
          }
        }
      } catch (error) {
        console.error(`❌ Error scraping ${resort.name}: ${error.message}`);
      }
    }
  }

  return scrapedData;
}

/**
 * Scrape Ikon resorts from Inspector API (fetch all data, filter by name)
 */
async function scrapeIkonResorts(resortsToScrape, scrapeOptions = {}) {
  const scrapedData = [];
  const { scrapeTerrain = true, scrapeSnow = true } = scrapeOptions;

  // Separate resorts by provider type
  const inspectorResorts = resortsToScrape.filter(r => !r.apiProvider || r.apiProvider === 'inspector');
  const alternateProviderResorts = resortsToScrape.filter(r => r.apiProvider && r.apiProvider !== 'inspector');

  // Process Inspector API resorts (batch fetch)
  if (inspectorResorts.length > 0) {
    console.log(`\n📦 Fetching ${inspectorResorts.length} resort(s) from Inspector API...`);

    try {
      const apiResponse = await fetchAllInspectorData();

      if (!apiResponse || !apiResponse.Resorts || apiResponse.Resorts.length === 0) {
        console.error('❌ No resort data in Inspector API response');
      } else {
        console.log(`✓ Received data for ${apiResponse.Resorts.length} resorts from Inspector API`);

        inspectorResorts.forEach(resort => {
          const inspectorName = resort.inspectorName || resort.name;
          const ikonResortData = apiResponse.Resorts.find(r => r.Name === inspectorName);

          if (!ikonResortData) {
            console.error(`\n⚠️  ${resort.name}: No matching data found in Inspector API (looking for "${inspectorName}")`);
            return;
          }

          console.log(`\n${'='.repeat(50)}`);
          console.log(`Processing ${resort.name} (Inspector)...`);
          console.log('='.repeat(50));

          const result = { resortKey: resort.key, terrain: null, snow: null };

          if (scrapeTerrain) {
            result.terrain = saveInspectorTerrainData(resort.key, ikonResortData);
          }

          if (scrapeSnow) {
            result.snow = saveInspectorSnowData(resort.key, ikonResortData);
          }

          scrapedData.push(result);
        });
      }
    } catch (error) {
      console.error(`❌ Error fetching Ikon data from Inspector API:`, error.message);
    }
  }

  // Process alternate provider resorts
  if (alternateProviderResorts.length > 0) {
    console.log(`\n📦 Processing ${alternateProviderResorts.length} resort(s) from alternate providers...`);
    const alternateResults = await scrapeAlternateProviderResorts(alternateProviderResorts, scrapeOptions);
    scrapedData.push(...alternateResults);
  }

  return scrapedData;
}

/**
 * Update brief index for a resort
 */
function updateBriefIndex(resortKey, briefDir) {
  const briefFiles = fs.readdirSync(briefDir)
    .filter(f => f.endsWith('.json') && f !== 'index.json' && f !== 'latest.json')
    .map(f => f.replace(/\.json$/, ''))
    .sort()
    .reverse();

  if (briefFiles.length > 0) {
    const briefIndex = {
      resort: resortKey,
      resortName: RESORTS[resortKey]?.name || resortKey,
      provider: RESORTS[resortKey]?.provider || 'vail',
      files: briefFiles,
      latest: briefFiles[0] || null,
      count: briefFiles.length,
      generated: new Date().toISOString()
    };

    const indexPath = path.join(briefDir, 'index.json');
    fs.writeFileSync(indexPath, JSON.stringify(briefIndex, null, 2));
  }
}

/**
 * Generate morning briefs for all scraped resorts
 */
function generateBriefs(scrapedData) {
  const allBriefs = {};

  scrapedData.forEach(result => {
    if (!result || (!result.terrain && !result.snow)) {
      return;
    }

    const resortKey = result.resortKey;
    const resort = RESORTS[resortKey];
    const today = seasonUtils.getResortLocalDate(resort.timezone);

    try {
      // Generate brief
      const brief = briefGenerator.generateBrief(resortKey, today, config, RESORTS);

      if (brief) {
        // Save per-resort brief file
        const briefDir = path.join('data', resortKey, 'brief');
        briefGenerator.ensureDirectoryExists(briefDir);
        const briefFile = path.join(briefDir, `${today}.json`);
        fs.writeFileSync(briefFile, JSON.stringify(brief, null, 2));

        // Save latest.json for this resort
        const latestFile = path.join(briefDir, 'latest.json');
        fs.writeFileSync(latestFile, JSON.stringify(brief, null, 2));

        // Update per-resort index
        updateBriefIndex(resortKey, briefDir);

        // Add to aggregated briefs
        allBriefs[resortKey] = {
          date: today,
          resortName: resort.name,
          provider: resort.provider || 'ikon',
          data: brief
        };

        console.log(`✓ Generated brief for ${resort.name}`);
      }
    } catch (error) {
      console.error(`⚠️  Error generating brief for ${resort.name}:`, error.message);
    }
  });

  // Generate latest-briefs.json (all resorts)
  if (Object.keys(allBriefs).length > 0) {
    const latestBriefsFile = path.join('data', 'latest-briefs.json');

    // Read existing file to merge with new data
    let existingBriefs = {};
    if (fs.existsSync(latestBriefsFile)) {
      try {
        existingBriefs = JSON.parse(fs.readFileSync(latestBriefsFile, 'utf8'));
      } catch (error) {
        console.error('⚠️  Error reading existing latest-briefs.json:', error.message);
      }
    }

    // Merge new briefs with existing
    const mergedBriefs = { ...existingBriefs, ...allBriefs };
    fs.writeFileSync(latestBriefsFile, JSON.stringify(mergedBriefs, null, 2));
    console.log(`✓ Updated latest-briefs.json with ${Object.keys(allBriefs).length} Ikon resort(s)`);
  }
}

/**
 * Merge inspector results into aggregated latest files without dropping existing data
 */
function updateAggregatedLatest(scrapedData) {
  if (!scrapedData || scrapedData.length === 0) return;

  const latestTerrainUpdates = {};
  const latestSnowUpdates = {};

  scrapedData.forEach(result => {
    const resortName = RESORTS[result.resortKey]?.name || result.resortKey;

    if (result.terrain?.data) {
      latestTerrainUpdates[result.resortKey] = {
        date: result.terrain.date,
        name: resortName,
        provider: RESORTS[result.resortKey]?.provider || 'vail',
        data: result.terrain.data
      };
    }

    if (result.snow?.data) {
      latestSnowUpdates[result.resortKey] = {
        date: result.snow.date,
        name: resortName,
        provider: RESORTS[result.resortKey]?.provider || 'vail',
        data: result.snow.data
      };
    }
  });

  const mergeAndWrite = (filePath, updates) => {
    if (Object.keys(updates).length === 0) return;

    let existing = {};
    if (fs.existsSync(filePath)) {
      try {
        existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {
        console.warn(`⚠️  Could not parse ${filePath}, recreating file: ${e.message}`);
      }
    }

    const merged = { ...existing, ...updates };
    fileStorage.ensureDirectoryExists(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));
    console.log(`✓ Updated ${filePath} (${Object.keys(merged).length} resorts)`);
  };

  mergeAndWrite(LATEST_TERRAIN_FILE, latestTerrainUpdates);
  mergeAndWrite(LATEST_SNOW_FILE, latestSnowUpdates);
}

/**
 * Main execution function
 */
async function main() {
  console.log('🎿 Ikon Pass Scraper - HTTP API');
  console.log('='.repeat(80));
  console.log(`Run time: ${new Date().toISOString()}`);
  console.log(`API URL: ${INSPECTOR_API_URL}`);
  console.log('='.repeat(80));

  // Get data type from command line argument (optional: 'terrain' or 'snow')
  const args = process.argv.slice(2);
  const dataTypeArg = args[0]; // Optional: 'terrain' or 'snow'

  // Determine what to scrape (default to terrain only since snow is handled by snow-scraper.js)
  const scrapeTerrainOnly = !dataTypeArg || dataTypeArg === 'terrain';
  const scrapeSnowOnly = dataTypeArg === 'snow';
  const scrapeBoth = dataTypeArg === 'both';

  if (dataTypeArg && !['terrain', 'snow', 'both'].includes(dataTypeArg)) {
    console.error(`\n❌ Invalid data type: ${dataTypeArg}`);
    console.error(`Valid options: terrain, snow, both\n`);
    return;
  }

  console.log(`Data type: ${dataTypeArg || 'terrain (default)'}`);

  // Get Ikon resorts
  const ikonResorts = configLoader.getResortsByProvider(config, 'ikon');

  if (ikonResorts.length === 0) {
    console.log('\n⚠️  No Ikon resorts found in config.json');
    console.log('Add resorts with "provider": "ikon" to enable Ikon scraping\n');
    return;
  }

  console.log(`\n📋 Found ${ikonResorts.length} Ikon resort(s) in config`);

  // Filter resorts that should be scraped
  const resortsToScrape = [];
  const skippedResorts = [];

  ikonResorts.forEach(resort => {
    const status = fileStorage.getResortStatus(resort, config, seasonUtils);

    if (status.shouldScrapeTerrain || status.shouldScrapeSnow) {
      resortsToScrape.push(resort);
    } else {
      skippedResorts.push({ resort, status });
    }
  });

  // Print status for skipped resorts
  if (skippedResorts.length > 0) {
    console.log(`\n⏭️  Skipping ${skippedResorts.length} resort(s):`);
    skippedResorts.forEach(({ resort, status }) => {
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
      console.log(`   ${resort.name}: ${reason} (local time: ${status.localTime})`);
    });
  }

  if (resortsToScrape.length === 0) {
    console.log('\n✅ No resorts need scraping at this time\n');
  } else {
    // Scrape the resorts with specified data types
    const scrapeOptions = {
      scrapeTerrain: scrapeTerrainOnly || scrapeBoth,
      scrapeSnow: scrapeSnowOnly || scrapeBoth
    };
    const scrapedData = await scrapeIkonResorts(resortsToScrape, scrapeOptions);

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log(`📊 Summary: ${scrapedData.length} resort(s) scraped, ${skippedResorts.length} skipped`);
    console.log('='.repeat(80));

    if (scrapedData.length > 0) {
      console.log('\n📦 Updating aggregated latest files...');
      updateAggregatedLatest(scrapedData);

      // Generate morning briefs
      console.log('\n📋 Generating morning briefs...');
      generateBriefs(scrapedData);
    }
  }

  // Always generate/update the global data index with all resorts (both Vail and Ikon)
  // This ensures the index includes resorts even when scraping is skipped
  console.log('\n📋 Updating global data index...');
  fileStorage.generateDataIndex(config);

  console.log('\n✅ Ikon scraping complete!\n');

  // Close database connection
  if (db) {
    closeDatabase(db);
    console.log('🔒 Database connection closed\n');
  }
}

main();
