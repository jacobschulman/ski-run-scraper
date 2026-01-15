const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Load configuration
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const RESORTS = config.resorts.reduce((acc, resort) => {
  acc[resort.key] = resort;
  return acc;
}, {});

// Scrape grooming data
async function scrapeGroomingData(resortKey, url) {
  console.log(`\nScraping ${RESORTS[resortKey].name}...`);
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  const page = await browser.newPage();
  await page.setDefaultNavigationTimeout(60000);
  
  try {
    console.log(`Loading ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Wait for the data to be loaded
    await new Promise(r => setTimeout(r, 3000));
    
    const data = await page.evaluate(() => {
      if (typeof FR !== 'undefined' && FR.TerrainStatusFeed) {
        return FR.TerrainStatusFeed;
      }
      return null;
    });
    
    if (!data) {
      console.log('ERROR: Could not find terrain data on page');
      return null;
    }
    
    console.log(`✓ Successfully scraped data`);
    
    // Count groomed trails
    const groomedCount = data.GroomingAreas.reduce((sum, area) => {
      return sum + area.Trails.filter(t => t.IsGroomed).length;
    }, 0);
    
    console.log(`Total groomed trails: ${groomedCount}`);
    
    // List all trails with IsGroomed = true
    const groomedTrails = [];
    data.GroomingAreas.forEach(area => {
      area.Trails.forEach(trail => {
        if (trail.IsGroomed) {
          groomedTrails.push(`${area.Name}: ${trail.Name}`);
        }
      });
    });
    console.log('\nGroomed trails:');
    groomedTrails.forEach(t => console.log(`  ${t}`));
    
    // Save to file
    const dataDir = `data/${resortKey}/terrain`;
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    const filePath = path.join(dataDir, `${dateStr}.json`);
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`\n✓ Saved to ${filePath}`);
    
    return data;
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    return null;
  } finally {
    await browser.close();
  }
}

// Main
(async () => {
  const resort = RESORTS.vail;
  if (!resort || !resort.terrainUrl) {
    console.error('Vail resort config not found');
    process.exit(1);
  }
  
  await scrapeGroomingData('vail', resort.terrainUrl);
  process.exit(0);
})();
