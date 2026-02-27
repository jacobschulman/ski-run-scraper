#!/usr/bin/env node
// canadian-scraper.js - Scraper for Canadian SkiBig3 resorts (Lake Louise, Sunshine Village, Mt Norquay)
// Runs on GitHub Actions for redundancy (also scraped on Hetzner)
// Uses Puppeteer for Sunshine Village (snow data) and Norquay (lift status)

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const configLoader = require('./lib/config-loader');
const seasonUtils = require('./lib/season-utils');
const fileStorage = require('./lib/file-storage');
const canadianBig3 = require('./lib/providers/canadian-big3');
const briefGenerator = require('./lib/brief-generator');

// Load configuration
const config = configLoader.loadConfig();
const RESORTS = configLoader.getResortsMap(config);

// Get in-season Canadian Big3 resorts
function getCanadianResorts() {
  return config.resorts.filter(r =>
    r.apiProvider === 'canadian-big3' &&
    seasonUtils.isResortInSeason(r, config)
  );
}

// Save terrain data
function saveTerrainData(resortKey, data) {
  const resort = RESORTS[resortKey];
  if (!resort) return null;

  const timezone = resort.timezone || 'America/Edmonton';
  const today = seasonUtils.getResortLocalDate(timezone);
  const terrainData = canadianBig3.toTerrainData(data, resortKey, resort.name, today);

  const terrainDir = path.join('data', resortKey, 'terrain');
  fileStorage.ensureDirectoryExists(terrainDir);

  // Save timestamped and latest files
  fs.writeFileSync(path.join(terrainDir, `${today}.json`), JSON.stringify(terrainData, null, 2));
  fs.writeFileSync(path.join(terrainDir, 'latest.json'), JSON.stringify(terrainData, null, 2));

  // Also save under UTC date if it differs from local date
  const utcDate = new Date().toISOString().slice(0, 10);
  if (utcDate !== today) {
    fs.writeFileSync(path.join(terrainDir, `${utcDate}.json`), JSON.stringify(terrainData, null, 2));
  }

  // Update index
  const terrainFiles = fs.readdirSync(terrainDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort().reverse();

  fs.writeFileSync(path.join(terrainDir, 'index.json'), JSON.stringify({
    resort: resortKey,
    resortName: resort.name,
    provider: 'canadian-big3',
    files: terrainFiles,
    latest: terrainFiles[0] || null,
    count: terrainFiles.length,
    lastUpdated: new Date().toISOString()
  }, null, 2));

  return terrainData;
}

// Save lift status data (for grooming page compatibility)
function saveLiftData(resortKey, data) {
  const resort = RESORTS[resortKey];
  if (!resort || !data.Lifts || data.Lifts.length === 0) return null;

  const liftsDir = path.join('data', resortKey, 'lifts');
  fileStorage.ensureDirectoryExists(liftsDir);

  // Convert terrain lift data to lift index format
  const lifts = data.Lifts.map(lift => ({
    liftId: lift.Name.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-'),
    name: lift.Name,
    slug: lift.Name.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-'),
    type: lift.Type || 'Chairlift',
    status: lift.IsOpen ? 'Open' : 'Closed',
    waitMinutes: null,  // No wait time data for Canadian resorts
    openTime: null,
    closeTime: null,
    lastUpdated: data.scrapedAt
  }));

  const liftIndex = {
    resort: resortKey,
    resortName: resort.name,
    provider: 'canadian-big3',
    apiProvider: data.apiProvider,
    liftCount: lifts.length,
    lifts: lifts,
    // Include operating hours and timezone so frontend can check if resort is open
    timezone: resort.timezone,
    operatingHours: resort.operatingHours || null,
    lastUpdated: new Date().toISOString()
  };

  fs.writeFileSync(path.join(liftsDir, 'index.json'), JSON.stringify(liftIndex, null, 2));

  return liftIndex;
}

// Save snow data
function saveSnowData(resortKey, data) {
  const resort = RESORTS[resortKey];
  if (!resort) return null;

  const timezone = resort.timezone || 'America/Edmonton';
  const today = seasonUtils.getResortLocalDate(timezone);
  const snowReport = canadianBig3.toSnowReport(data, resortKey, resort.name, today);

  const snowDir = path.join('data', resortKey, 'snow');
  fileStorage.ensureDirectoryExists(snowDir);

  // Save timestamped and latest files
  fs.writeFileSync(path.join(snowDir, `${today}.json`), JSON.stringify(snowReport, null, 2));
  fs.writeFileSync(path.join(snowDir, 'latest.json'), JSON.stringify(snowReport, null, 2));

  // Append to NDJSON file
  const ndjsonFile = path.join(snowDir, `${today}.ndjson`);
  fs.appendFileSync(ndjsonFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    ...snowReport
  }) + '\n');

  // Update index
  const snowFiles = fs.readdirSync(snowDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort().reverse();

  fs.writeFileSync(path.join(snowDir, 'index.json'), JSON.stringify({
    resort: resortKey,
    resortName: resort.name,
    provider: 'canadian-big3',
    files: snowFiles,
    latest: snowFiles[0] || null,
    count: snowFiles.length,
    lastUpdated: new Date().toISOString()
  }, null, 2));

  return snowReport;
}

// Update latest-snow.json with Canadian resorts (merge with existing data)
function updateLatestSnowJson(resorts) {
  const latestSnowPath = path.join('data', 'latest-snow.json');

  // Load existing data to merge with
  let existing = {};
  let loadFailed = false;
  try {
    if (fs.existsSync(latestSnowPath)) {
      existing = JSON.parse(fs.readFileSync(latestSnowPath, 'utf8'));
      console.log(`\n📂 Loaded existing latest-snow.json (${Object.keys(existing).length} resorts)`);
    }
  } catch (e) {
    console.log(`\n⚠️  Could not load existing latest-snow.json: ${e.message}`);
    console.log(`⚠️  Skipping latest-snow.json update to avoid overwriting with partial data`);
    loadFailed = true;
  }

  // Merge Canadian resorts snow data
  let added = 0;
  for (const resort of resorts) {
    const snowLatestPath = path.join('data', resort.key, 'snow', 'latest.json');
    if (fs.existsSync(snowLatestPath)) {
      try {
        const snowData = JSON.parse(fs.readFileSync(snowLatestPath, 'utf8'));
        existing[resort.key] = {
          date: snowData.date,
          name: resort.name,
          provider: 'canadian-big3',
          data: snowData
        };
        added++;
      } catch (e) {
        console.log(`  ⚠️  Could not load snow data for ${resort.key}: ${e.message}`);
      }
    }
  }

  if (added > 0 && !loadFailed) {
    fileStorage.ensureDirectoryExists('data');
    fs.writeFileSync(latestSnowPath, JSON.stringify(existing, null, 2));
    console.log(`✓ Updated data/latest-snow.json (${Object.keys(existing).length} total resorts, ${added} Canadian)`);
  }
}

// Generate brief for resort
function generateBrief(resortKey) {
  const resort = RESORTS[resortKey];
  if (!resort) return null;

  const today = seasonUtils.getResortLocalDate(resort.timezone);

  try {
    const brief = briefGenerator.generateBrief(resortKey, today, config, RESORTS);
    if (brief) {
      const briefDir = path.join('data', resortKey, 'brief');
      briefGenerator.ensureDirectoryExists(briefDir);
      fs.writeFileSync(path.join(briefDir, `${today}.json`), JSON.stringify(brief, null, 2));
      fs.writeFileSync(path.join(briefDir, 'latest.json'), JSON.stringify(brief, null, 2));

      // Update brief index
      const briefFiles = fs.readdirSync(briefDir)
        .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort().reverse();

      fs.writeFileSync(path.join(briefDir, 'index.json'), JSON.stringify({
        resort: resortKey,
        resortName: resort.name,
        files: briefFiles,
        latest: briefFiles[0] || null,
        count: briefFiles.length,
        lastUpdated: new Date().toISOString()
      }, null, 2));

      return brief;
    }
  } catch (error) {
    console.error(`Error generating brief for ${resortKey}:`, error.message);
  }
  return null;
}

async function main() {
  console.log('🇨🇦 Canadian SkiBig3 Scraper');
  console.log('='.repeat(60));

  const resorts = getCanadianResorts();
  if (resorts.length === 0) {
    console.log('No Canadian Big3 resorts in season');
    return;
  }

  console.log(`Found ${resorts.length} in-season resort(s): ${resorts.map(r => r.key).join(', ')}`);

  // Launch browser for Puppeteer-based scraping
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ]
  });

  try {
    for (const resort of resorts) {
      console.log(`\n📍 ${resort.name} (${resort.key})`);

      try {
        // Scrape data (uses Puppeteer when available)
        const data = await canadianBig3.scrapeResort(resort.key, browser);

        if (data) {
          // Save terrain data
          const terrain = saveTerrainData(resort.key, data);
          const liftCount = data.Lifts?.length || 0;
          const trailCount = data.Trails?.length || 0;
          console.log(`  ✓ Terrain: ${data.stats?.liftsOpen || 0}/${liftCount} lifts, ${data.stats?.trailsOpen || 0}/${trailCount} trails`);

          // Save lift data (for grooming page compatibility)
          if (data.Lifts && data.Lifts.length > 0) {
            saveLiftData(resort.key, data);
            console.log(`  ✓ Lifts: ${data.Lifts.filter(l => l.IsOpen).length}/${data.Lifts.length} open`);
          }

          // Save snow data
          if (data.snow) {
            saveSnowData(resort.key, data);
            console.log(`  ✓ Snow: ${data.snow.snow24_cm || 0}cm 24h, ${data.snow.base_upper_cm || data.snow.base_lower_cm || 0}cm base`);
          }

          // Generate brief
          const brief = generateBrief(resort.key);
          if (brief) {
            console.log(`  ✓ Brief generated`);
          }
        } else {
          console.log(`  ⚠️  No data returned`);
        }
      } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
      }
    }

    // Update latest-snow.json with Canadian resorts data
    updateLatestSnowJson(resorts);

    console.log('\n' + '='.repeat(60));
    console.log('✅ Canadian SkiBig3 scraping complete!');

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
