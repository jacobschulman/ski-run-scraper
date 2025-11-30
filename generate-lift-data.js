// generate-lift-data.js - Generate lift-specific JSON files from NDJSON data
// This script processes NDJSON lift wait time data into structured JSON files

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { formatInTimeZone } = require('date-fns-tz');

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
 * Convert lift name to URL-safe slug
 */
function slugifyLiftName(name) {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-')      // Replace spaces with hyphens
    .replace(/--+/g, '-')      // Replace multiple hyphens with single
    .trim();
}

/**
 * Read all NDJSON files for a resort and parse lift data
 */
async function readLiftData(resortKey) {
  const liftsDir = path.join('data', resortKey, 'lifts');

  if (!fs.existsSync(liftsDir)) {
    console.log(`No lifts directory found for ${resortKey}`);
    return null;
  }

  const files = fs.readdirSync(liftsDir)
    .filter(f => f.endsWith('.ndjson'))
    .sort()
    .reverse(); // Most recent first

  if (files.length === 0) {
    console.log(`No NDJSON files found in ${liftsDir}`);
    return null;
  }

  const liftsByLiftId = new Map();
  const allRecords = [];
  const nameKeyToId = new Map();

  // Read all files
  for (const file of files) {
    const filePath = path.join(liftsDir, file);
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const record = JSON.parse(line);
        allRecords.push(record);
        const nameKey = `${slugifyLiftName(record.mountain || 'unknown')}:${slugifyLiftName(record.name || 'unknown')}`;
        const canonicalId = (() => {
          if (nameKeyToId.has(nameKey)) return nameKeyToId.get(nameKey);
          if (record.liftId) {
            nameKeyToId.set(nameKey, record.liftId);
            return record.liftId;
          }
          nameKeyToId.set(nameKey, nameKey);
          return nameKey;
        })();

        // Group by liftId
        if (!liftsByLiftId.has(canonicalId)) {
          liftsByLiftId.set(canonicalId, []);
        }
        liftsByLiftId.get(canonicalId).push({ ...record, liftId: canonicalId });
      } catch (error) {
        console.error(`Error parsing line in ${file}:`, error.message);
      }
    }
  }

  return { liftsByLiftId, allRecords };
}

/**
 * Check if a lift is currently within operating hours
 */
function isWithinOperatingHours(openTime, closeTime, timezone) {
  if (!openTime || !closeTime || !timezone) return null;

  const toMinutes = (timeStr) => {
    if (!timeStr) return null;
    const match = timeStr.match(/(\\d+):(\\d+)\\s*(am|pm)?/i);
    if (!match) return null;
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const meridiem = match[3]?.toLowerCase();
    if (meridiem) {
      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
    }
    return hours * 60 + minutes;
  };

  try {
    const now = new Date();
    const current = formatInTimeZone(now, timezone, 'HH:mm');
    const [curH, curM] = current.split(':').map(Number);
    const currentMinutes = curH * 60 + curM;
    const openMinutes = toMinutes(openTime);
    const closeMinutes = toMinutes(closeTime);
    if (openMinutes == null || closeMinutes == null) return null;
    return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
  } catch (error) {
    return null;
  }
}

/**
 * Get the most recent status for each lift
 * Corrects status to 'Closed' if outside operating hours
 */
function getLatestLiftStatus(records, resortTimezone) {
  if (!records || records.length === 0) return null;

  // Sort by timestamp descending
  const sorted = records.slice().sort((a, b) =>
    new Date(b.timestamp) - new Date(a.timestamp)
  );

  const latest = { ...sorted[0] };

  // Check if lift is actually open based on operating hours
  if (latest.openTime && latest.closeTime && resortTimezone) {
    const withinHours = isWithinOperatingHours(latest.openTime, latest.closeTime, resortTimezone);

    // If we're outside operating hours, override status to Closed
    if (withinHours === false && latest.status === 'Open') {
      latest.status = 'Closed';
    }
  }

  return latest;
}

/**
 * Calculate wait time statistics
 */
function calculateWaitTimeStats(records) {
  const validWaitTimes = records
    .filter(r => r.waitMinutes !== null && r.waitMinutes !== undefined)
    .map(r => r.waitMinutes);

  if (validWaitTimes.length === 0) {
    return { avg: null, min: null, max: null };
  }

  return {
    avg: Math.round(validWaitTimes.reduce((a, b) => a + b, 0) / validWaitTimes.length),
    min: Math.min(...validWaitTimes),
    max: Math.max(...validWaitTimes)
  };
}

/**
 * Get wait time history grouped by date
 */
function getWaitTimeHistory(records) {
  const byDate = new Map();

  records.forEach(record => {
    const date = record.timestamp.split('T')[0];
    if (!byDate.has(date)) {
      byDate.set(date, []);
    }
    byDate.get(date).push(record);
  });

  return Array.from(byDate.entries())
    .map(([date, dateRecords]) => {
      const validWaitTimes = dateRecords
        .filter(r => r.waitMinutes !== null && r.waitMinutes !== undefined)
        .map(r => r.waitMinutes);

      const openRecords = dateRecords.filter(r => r.status === 'Open');

      return {
        date,
        recordCount: dateRecords.length,
        avgWaitTime: validWaitTimes.length > 0
          ? Math.round(validWaitTimes.reduce((a, b) => a + b, 0) / validWaitTimes.length)
          : null,
        minWaitTime: validWaitTimes.length > 0 ? Math.min(...validWaitTimes) : null,
        maxWaitTime: validWaitTimes.length > 0 ? Math.max(...validWaitTimes) : null,
        wasOpen: openRecords.length > 0,
        openPercentage: Math.round((openRecords.length / dateRecords.length) * 100)
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date)); // Most recent first
}

/**
 * Generate lift overview index file
 */
async function generateLiftIndex(resortKey, resortName, liftsByLiftId, resortTimezone) {
  const lifts = [];

  for (const [liftId, records] of liftsByLiftId.entries()) {
    const latest = getLatestLiftStatus(records, resortTimezone);
    if (!latest) continue;

    const waitStats = calculateWaitTimeStats(records);

    lifts.push({
      liftId: latest.liftId,
      name: latest.name,
      slug: slugifyLiftName(latest.name),
      mountain: latest.mountain || 'Unknown',
      type: latest.type || 'Unknown',
      capacity: latest.capacity || null,
      status: latest.status,
      waitMinutes: latest.waitMinutes,
      openTime: latest.openTime || null,
      closeTime: latest.closeTime || null,
      avgWaitTime: waitStats.avg,
      lastUpdated: latest.timestamp
    });
  }

  // Sort by mountain, then name
  lifts.sort((a, b) => {
    const mountainCompare = a.mountain.localeCompare(b.mountain);
    if (mountainCompare !== 0) return mountainCompare;
    return a.name.localeCompare(b.name);
  });

  const indexData = {
    resort: resortKey,
    resortName,
    liftCount: lifts.length,
    lifts,
    generated: new Date().toISOString()
  };

  const outputDir = path.join('data', resortKey, 'lifts');
  ensureDirectoryExists(outputDir);

  const outputPath = path.join(outputDir, 'index.json');
  fs.writeFileSync(outputPath, JSON.stringify(indexData, null, 2));

  console.log(`✓ Generated ${outputPath} (${lifts.length} lifts)`);
}

/**
 * Generate individual lift detail files
 */
async function generateLiftDetailFiles(resortKey, resortName, liftsByLiftId, resortTimezone) {
  const outputDir = path.join('data', resortKey, 'lifts', 'data');
  ensureDirectoryExists(outputDir);

  let count = 0;

  for (const [liftId, records] of liftsByLiftId.entries()) {
    const latest = getLatestLiftStatus(records, resortTimezone);
    if (!latest) continue;

    const slug = slugifyLiftName(latest.name);
    const waitStats = calculateWaitTimeStats(records);
    const history = getWaitTimeHistory(records);

    const liftData = {
      resort: resortKey,
      resortName,
      liftId: latest.liftId,
      liftName: latest.name,
      slug,
      mountain: latest.mountain || 'Unknown',
      type: latest.type || 'Unknown',
      capacity: latest.capacity || null,
      currentStatus: {
        status: latest.status,
        waitMinutes: latest.waitMinutes,
        openTime: latest.openTime || null,
        closeTime: latest.closeTime || null,
        timestamp: latest.timestamp,
        localTime: latest.localTime || null
      },
      stats: {
        totalRecords: records.length,
        avgWaitTime: waitStats.avg,
        minWaitTime: waitStats.min,
        maxWaitTime: waitStats.max,
        daysTracked: history.length
      },
      history,
      generated: new Date().toISOString()
    };

    const outputPath = path.join(outputDir, `${slug}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(liftData, null, 2));
    count++;
  }

  console.log(`✓ Generated ${count} lift detail files in ${outputDir}`);
}

/**
 * Main function
 */
async function generateLiftData(resortKey) {
  const resort = RESORTS[resortKey];
  if (!resort) {
    console.error(`Unknown resort: ${resortKey}`);
    return;
  }

  console.log(`\nProcessing lifts for ${resort.name}...`);

  const data = await readLiftData(resortKey);
  if (!data) {
    console.log(`No lift data available for ${resortKey}`);
    return;
  }

  const { liftsByLiftId } = data;

  if (liftsByLiftId.size === 0) {
    console.log(`No lifts found for ${resortKey}`);
    return;
  }

  const timezone = resort.timezone || 'America/Denver';

  await generateLiftIndex(resortKey, resort.name, liftsByLiftId, timezone);
  await generateLiftDetailFiles(resortKey, resort.name, liftsByLiftId, timezone);

  console.log(`✓ Completed ${resort.name}`);
}

// Handle command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage: node generate-lift-data.js <resort-key|all> [resort-key...]');
  console.log('Example: node generate-lift-data.js vail');
  console.log('Example: node generate-lift-data.js all');
  console.log('\nAvailable resorts:');
  Object.keys(RESORTS).forEach(key => {
    console.log(`  - ${key} (${RESORTS[key].name})`);
  });
  process.exit(1);
}

// Process each resort
(async () => {
  let resortsToProcess = args;

  // If 'all' is specified, process all resorts that have lift data
  if (args[0] === 'all') {
    resortsToProcess = [];
    for (const resortKey of Object.keys(RESORTS)) {
      const liftsDir = path.join('data', resortKey, 'lifts');
      if (fs.existsSync(liftsDir)) {
        const files = fs.readdirSync(liftsDir).filter(f => f.endsWith('.ndjson'));
        if (files.length > 0) {
          resortsToProcess.push(resortKey);
        }
      }
    }
    console.log(`\nFound ${resortsToProcess.length} resorts with lift data`);
  }

  for (const resortKey of resortsToProcess) {
    await generateLiftData(resortKey);
  }
  console.log('\n✓ All done!');
})();
