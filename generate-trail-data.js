// generate-trail-data.js - Generate trail-specific JSON files from existing database data
// This script can be run independently to regenerate trail pages without re-scraping

const fs = require('fs');
const path = require('path');
const { getDatabase, closeDatabase } = require('./database');

// Load configuration
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const RESORTS = config.resorts.reduce((acc, resort) => {
  acc[resort.key] = resort;
  return acc;
}, {});

/**
 * Ensure directory exists, create if not
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
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
 * Get the start date of the current ski season for a resort
 */
function getSeasonStartDate(resort) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 0-indexed

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
    const date = new Date(record.date + 'T00:00:00'); // Ensure proper date parsing
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
 * Generate trail data for a specific resort
 */
function generateTrailDataForResort(db, resortKey) {
  return new Promise((resolve, reject) => {
    const resort = RESORTS[resortKey];
    if (!resort) {
      return reject(new Error(`Unknown resort: ${resortKey}`));
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Generating trail data for ${resort.name}`);
    console.log('='.repeat(60));

    // Get resort ID from database
    db.get('SELECT id FROM resorts WHERE key = ?', [resortKey], (err, resortRow) => {
      if (err) return reject(err);
      if (!resortRow) {
        console.log(`⚠️  No data found for ${resort.name} in database`);
        return resolve(0);
      }

      const resortId = resortRow.id;
      const seasonStartDate = getSeasonStartDate(resort);

      console.log(`Resort ID: ${resortId}`);
      console.log(`Season start: ${seasonStartDate}`);

      // Get all unique trails for this resort
      db.all(
        `SELECT DISTINCT item_name
         FROM terrain_status
         WHERE resort_id = ? AND item_type = 'trail' AND date >= ?
         ORDER BY item_name`,
        [resortId, seasonStartDate],
        (err, trails) => {
          if (err) return reject(err);

          console.log(`Found ${trails.length} unique trails\n`);

          if (trails.length === 0) {
            return resolve(0);
          }

          // Ensure trails directory exists
          const trailsDataDir = path.join('data', resortKey, 'trails', 'data');
          ensureDirectoryExists(trailsDataDir);

          let processedCount = 0;
          const totalTrails = trails.length;

          // Process each trail
          trails.forEach((trailRow, index) => {
            const trailName = trailRow.item_name;
            const trailSlug = slugifyTrailName(trailName);

            // Get historical data for this trail
            db.all(
              `SELECT date, status, grooming_status, grooming_type, raw_data
               FROM terrain_status
               WHERE resort_id = ? AND item_name = ? AND item_type = 'trail' AND date >= ?
               ORDER BY date DESC`,
              [resortId, trailName, seasonStartDate],
              (err, rows) => {
                if (err) {
                  console.error(`  ⚠️  Error querying ${trailName}:`, err.message);
                  processedCount++;
                  if (processedCount === totalTrails) resolve(totalTrails);
                  return;
                }

                // Parse the most recent raw_data to get trail metadata
                let trailMetadata = {
                  area: 'Unknown',
                  difficulty: 'Unknown',
                  trailType: 'Skiing',
                  isOpen: false,
                  isGroomed: false
                };

                if (rows.length > 0 && rows[0].raw_data) {
                  try {
                    const rawData = JSON.parse(rows[0].raw_data);
                    trailMetadata.difficulty = rawData.Difficulty || 'Unknown';
                    trailMetadata.trailType = rawData.TrailType || 'Skiing';
                    trailMetadata.isOpen = rawData.IsOpen || false;
                    trailMetadata.isGroomed = rawData.IsGroomed || false;
                  } catch (e) {
                    // Ignore parse errors
                  }
                }

                // Try to get area from latest terrain file
                const latestDate = rows.length > 0 ? rows[0].date : null;
                if (latestDate) {
                  const terrainFile = path.join('data', resortKey, 'terrain', `${latestDate}.json`);
                  if (fs.existsSync(terrainFile)) {
                    try {
                      const terrainData = JSON.parse(fs.readFileSync(terrainFile, 'utf8'));
                      if (terrainData.GroomingAreas) {
                        for (const area of terrainData.GroomingAreas) {
                          if (area.Trails) {
                            const trail = area.Trails.find(t => t.Name === trailName);
                            if (trail) {
                              trailMetadata.area = area.Name;
                              break;
                            }
                          }
                        }
                      }
                    } catch (e) {
                      // Ignore parse errors
                    }
                  }
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
                  area: trailMetadata.area,
                  difficulty: trailMetadata.difficulty,
                  trailType: trailMetadata.trailType,

                  // Current status (from most recent data)
                  currentStatus: {
                    date: latestDate,
                    isOpen: trailMetadata.isOpen,
                    isGroomed: trailMetadata.isGroomed,
                    groomingStatus: rows[0]?.grooming_status || null,
                    status: rows[0]?.status || null
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

                processedCount++;

                // Progress indicator
                if (processedCount % 10 === 0 || processedCount === totalTrails) {
                  console.log(`  Progress: ${processedCount}/${totalTrails} trails`);
                }

                // When all trails are processed, generate index
                if (processedCount === totalTrails) {
                  console.log(`\n✓ Generated ${totalTrails} trail data files`);
                  generateTrailsIndex(resortKey);
                  resolve(totalTrails);
                }
              }
            );
          });
        }
      );
    });
  });
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
  ensureDirectoryExists(path.dirname(indexFile));
  fs.writeFileSync(indexFile, JSON.stringify(trailsIndex, null, 2));
  console.log(`✓ Generated trails/index.json`);
}

/**
 * Main execution
 */
async function main() {
  console.log('🎿 Trail Data Generator');
  console.log('='.repeat(60));
  console.log(`Run time: ${new Date().toISOString()}\n`);

  const args = process.argv.slice(2);
  const resortArg = args[0];

  let resortsToProcess = [];

  if (resortArg && resortArg !== 'all') {
    // Process single resort
    if (RESORTS[resortArg]) {
      resortsToProcess = [resortArg];
    } else {
      console.error(`❌ Unknown resort: ${resortArg}`);
      console.error(`Available resorts: ${Object.keys(RESORTS).join(', ')}\n`);
      process.exit(1);
    }
  } else if (resortArg === 'all') {
    // Process all resorts
    resortsToProcess = Object.keys(RESORTS);
  } else {
    console.error('Usage: node generate-trail-data.js <resort-key>');
    console.error('       node generate-trail-data.js all');
    console.error(`\nAvailable resorts: ${Object.keys(RESORTS).join(', ')}\n`);
    process.exit(1);
  }

  const db = getDatabase();

  try {
    let totalTrails = 0;
    for (const resortKey of resortsToProcess) {
      const count = await generateTrailDataForResort(db, resortKey);
      totalTrails += count;
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✅ Complete! Generated data for ${totalTrails} trails`);
    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    closeDatabase(db);
  }
}

main();
