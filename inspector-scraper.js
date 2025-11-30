// inspector-scraper.js - Inspector (Ikon) API terrain/snow data scraper
// Uses HTTP API instead of Puppeteer for better performance and reliability

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

  const resort = RESORTS[resortKey];
  const resortName = resort.name;
  const resortTimezone = resort.timezone || 'America/Denver';
  const today = seasonUtils.getResortLocalDate(resortTimezone);

  // Normalize Inspector data to Vail format
  const normalizedData = dataNormalization.normalizeInspectorResort(inspectorData);

  // Ensure data directory structure exists
  const terrainDir = path.join('data', resortKey, 'terrain');
  fileStorage.ensureDirectoryExists(terrainDir);

  // Save timestamped file
  const timestampedFile = path.join(terrainDir, `${today}.json`);
  fs.writeFileSync(timestampedFile, JSON.stringify(normalizedData, null, 2));
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
      files: terrainFiles,
      latest: terrainFiles[0] || null,
      count: terrainFiles.length,
      generated: new Date().toISOString()
    };

    const terrainIndexPath = path.join(terrainDir, 'index.json');
    fs.writeFileSync(terrainIndexPath, JSON.stringify(terrainIndex, null, 2));
    console.log(`✓ Updated ${terrainIndexPath} (${terrainFiles.length} files)`);
  }

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

  // Ensure directory structure exists
  const snowDir = path.join('data', resortKey, 'snow');
  fileStorage.ensureDirectoryExists(snowDir);

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
  console.log(`   Operating Status: ${cleanData.operatingStatus}`);
  console.log(`   Conditions: ${cleanData.conditions}`);
  console.log(`   Base Depth: ${cleanData.baseDepth.inches}" (${cleanData.baseDepth.cm}cm)`);
  console.log(`   24hr Snowfall: ${cleanData.snowfall['24hour_inches']}" (${cleanData.snowfall['24hour_cm']}cm)`);
  console.log(`   7-day Snowfall: ${cleanData.snowfall['7day_inches']}" (${cleanData.snowfall['7day_cm']}cm)`);
  console.log(`   Season Total: ${cleanData.snowfall.season_total_inches}" (${cleanData.snowfall.season_total_cm}cm)`);
  console.log(`   Terrain: ${cleanData.terrain.openTrails}/${cleanData.terrain.totalTrails} trails, ${cleanData.terrain.openLifts}/${cleanData.terrain.totalLifts} lifts`);

  return { resortKey, date: today, data: cleanData };
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
            provider: 'inspector'
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
 * Scrape Inspector resorts (fetch all data, filter by name)
 */
async function scrapeInspectorResorts(resortsToScrape) {
  const scrapedData = [];

  console.log(`\n📦 Fetching all Inspector resort data...`);

  try {
    // Fetch all resort data in one API call
    const apiResponse = await fetchAllInspectorData();

    if (!apiResponse || !apiResponse.Resorts || apiResponse.Resorts.length === 0) {
      console.error('❌ No resort data in API response');
      return scrapedData;
    }

    console.log(`✓ Received data for ${apiResponse.Resorts.length} resorts from API`);
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Processing ${resortsToScrape.length} configured resort(s)...`);
    console.log('='.repeat(80));

    // Process each configured resort
    resortsToScrape.forEach(resort => {
      const inspectorName = resort.inspectorName || resort.name;

      // Find matching resort in API data (exact name match)
      const inspectorResort = apiResponse.Resorts.find(r => r.Name === inspectorName);

      if (!inspectorResort) {
        console.error(`\n⚠️  ${resort.name}: No matching data found (looking for "${inspectorName}")`);
        return;
      }

      console.log(`\n${'='.repeat(50)}`);
      console.log(`Processing ${resort.name}...`);
      console.log('='.repeat(50));

      const result = { resortKey: resort.key, terrain: null, snow: null };

      // Save terrain data
      result.terrain = saveInspectorTerrainData(resort.key, inspectorResort);

      // Save snow data
      result.snow = saveInspectorSnowData(resort.key, inspectorResort);

      scrapedData.push(result);
    });

  } catch (error) {
    console.error(`❌ Error fetching Inspector data:`, error.message);
  }

  return scrapedData;
}

/**
 * Main execution function
 */
async function main() {
  console.log('🎿 Inspector (Ikon) Scraper - HTTP API');
  console.log('='.repeat(80));
  console.log(`Run time: ${new Date().toISOString()}`);
  console.log(`API URL: ${INSPECTOR_API_URL}`);
  console.log('='.repeat(80));

  // Get Inspector resorts
  const inspectorResorts = configLoader.getResortsByProvider(config, 'inspector');

  if (inspectorResorts.length === 0) {
    console.log('\n⚠️  No Inspector resorts found in config.json');
    console.log('Add resorts with "provider": "inspector" to enable Inspector scraping\n');
    return;
  }

  console.log(`\n📋 Found ${inspectorResorts.length} Inspector resort(s) in config`);

  // Filter resorts that should be scraped
  const resortsToScrape = [];
  const skippedResorts = [];

  inspectorResorts.forEach(resort => {
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
    // Scrape the resorts
    const scrapedData = await scrapeInspectorResorts(resortsToScrape);

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log(`📊 Summary: ${scrapedData.length} resort(s) scraped, ${skippedResorts.length} skipped`);
    console.log('='.repeat(80));
  }

  // Always generate/update the global data index with all resorts (both Vail and Inspector)
  // This ensures the index includes resorts even when scraping is skipped
  console.log('\n📋 Updating global data index...');
  fileStorage.generateDataIndex(config);

  console.log('\n✅ Inspector scraping complete!\n');

  // Close database connection
  if (db) {
    closeDatabase(db);
    console.log('🔒 Database connection closed\n');
  }
}

main();
