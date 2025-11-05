// scraper.js - Multi-resort grooming data extractor using Puppeteer

const puppeteer = require('puppeteer');
const fs = require('fs');

const RESORTS = {
  keystone: {
    name: 'Keystone',
    url: 'https://www.keystoneresort.com/the-mountain/mountain-conditions/terrain-and-lift-status.aspx'
  },
  vail: {
    name: 'Vail',
    url: 'https://www.vail.com/the-mountain/mountain-conditions/terrain-and-lift-status.aspx'
  }
};

async function scrapeGroomingData(resortKey, url) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Scraping ${RESORTS[resortKey].name}...`);
  console.log('='.repeat(50));

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log('Loading page...');

    // Try loading with a more lenient wait strategy
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) {
      console.log('Initial load issue:', e.message);
    }

    // Wait for the script tag or FR object to be available
    console.log('Waiting for data to load...');
    await page.waitForFunction(
      () => typeof FR !== 'undefined' && FR.TerrainStatusFeed,
      { timeout: 30000 }
    ).catch(() => console.log('FR.TerrainStatusFeed not found via wait'));

    // Extract the FR.TerrainStatusFeed data
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

function printResortSummary(resortKey, data) {
  if (!data) {
    console.log('✗ Could not find FR.TerrainStatusFeed');
    return;
  }

  const resortName = RESORTS[resortKey].name;

  // Save the raw JSON
  fs.writeFileSync(`${resortKey}-data.json`, JSON.stringify(data, null, 2));
  console.log(`✓ Saved raw data to ${resortKey}-data.json`);

  console.log('\n📊 Data Summary:');
  console.log(`   Resort: ${resortName}`);
  console.log(`   Resort ID: ${data.ResortId}`);
  console.log(`   Date: ${data.Date}`);
  console.log(`   Grooming Areas: ${data.GroomingAreas ? data.GroomingAreas.length : 0}`);

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
}

async function scrapeResort(resortKey) {
  const resort = RESORTS[resortKey];
  if (!resort) {
    console.error(`Unknown resort: ${resortKey}`);
    console.error(`Available resorts: ${Object.keys(RESORTS).join(', ')}`);
    return null;
  }

  try {
    const data = await scrapeGroomingData(resortKey, resort.url);
    printResortSummary(resortKey, data);
    return data;
  } catch (error) {
    console.error(`Error scraping ${resort.name}:`, error.message);
    return null;
  }
}

async function main() {
  // Get resort from command line argument, default to all
  const args = process.argv.slice(2);
  const resortArg = args[0];

  if (resortArg && resortArg !== 'all') {
    // Scrape single resort
    await scrapeResort(resortArg);
  } else {
    // Scrape all resorts
    console.log('Scraping all resorts...\n');
    for (const resortKey of Object.keys(RESORTS)) {
      await scrapeResort(resortKey);
    }
  }
}

main();