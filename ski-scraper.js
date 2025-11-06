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
  const dataDir = path.join('data', resortKey);
  ensureDirectoryExists(dataDir);

  // Save timestamped file
  const timestampedFile = path.join(dataDir, `${today}.json`);
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
 * Scrape a single resort
 */
async function scrapeResort(resortKey) {
  const resort = RESORTS[resortKey];
  if (!resort) {
    console.error(`Unknown resort: ${resortKey}`);
    console.error(`Available resorts: ${Object.keys(RESORTS).join(', ')}`);
    return null;
  }

  try {
    const data = await scrapeGroomingData(resortKey, resort.url);
    return saveResortData(resortKey, data);
  } catch (error) {
    console.error(`Error scraping ${resort.name}:`, error.message);
    return null;
  }
}

/**
 * Generate latest.json with most recent data from all resorts
 */
function generateLatestFile(scrapedData) {
  const latest = {};

  scrapedData.forEach(result => {
    if (result && result.data) {
      latest[result.resortKey] = {
        date: result.date,
        name: RESORTS[result.resortKey].name,
        data: result.data
      };
    }
  });

  ensureDirectoryExists('data');
  fs.writeFileSync('data/latest.json', JSON.stringify(latest, null, 2));
  console.log('\n✓ Generated data/latest.json (aggregated latest data)');
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
    const resortDir = path.join(dataDir, resortKey);
    if (fs.existsSync(resortDir)) {
      const files = fs.readdirSync(resortDir)
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
    generateIndexFile();
  }

  console.log('\n✅ Scraping complete!\n');
}

main();
