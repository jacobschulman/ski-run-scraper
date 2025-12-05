// puppeteer-network-inspector.js - Use Puppeteer to capture network requests for API discovery

const puppeteer = require('puppeteer');

const RESORTS = [
  {
    name: 'Jackson Hole',
    url: 'https://www.jacksonhole.com/the-mountain'
  },
  {
    name: 'Alta',
    url: 'https://www.alta.com/lift-terrain-status'
  },
  {
    name: 'Snowbird',
    url: 'https://www.snowbird.com/mountain-report/'
  },
  {
    name: 'Aspen Snowmass',
    url: 'https://www.aspensnowmass.com/four-mountains/terrain-lifts'
  },
  {
    name: 'Revelstoke',
    url: 'https://www.revelstokemountainresort.com/trail-lift-status'
  },
  {
    name: 'Lake Louise',
    url: 'https://www.skilouise.com/conditions'
  }
];

async function inspectResortPage(resort) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`INSPECTING: ${resort.name}`);
  console.log(`URL: ${resort.url}`);
  console.log(`${'='.repeat(80)}\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  const apiRequests = [];
  const dataRequests = [];

  // Intercept network requests
  page.on('request', request => {
    const url = request.url();
    const resourceType = request.resourceType();

    // Look for API calls and JSON data
    if (resourceType === 'xhr' || resourceType === 'fetch') {
      if (url.includes('api') ||
          url.includes('trail') ||
          url.includes('lift') ||
          url.includes('condition') ||
          url.includes('status') ||
          url.includes('.json')) {
        console.log(`  📡 Request: ${resourceType.toUpperCase()} ${url}`);
        apiRequests.push({
          type: resourceType,
          url: url,
          method: request.method()
        });
      }
    }
  });

  page.on('response', async response => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';

    // Check for JSON responses
    if (contentType.includes('application/json')) {
      if (url.includes('trail') ||
          url.includes('lift') ||
          url.includes('condition') ||
          url.includes('status') ||
          url.includes('api')) {
        console.log(`  ✓ JSON Response: ${url}`);

        try {
          const body = await response.text();
          const data = JSON.parse(body);
          const str = JSON.stringify(data).toLowerCase();

          const analysis = {
            url,
            size: body.length,
            hasTrails: str.includes('trail'),
            hasLifts: str.includes('lift'),
            hasStatus: str.includes('status') || str.includes('open') || str.includes('closed'),
            sampleKeys: typeof data === 'object' && !Array.isArray(data) ?
              Object.keys(data).slice(0, 10) : []
          };

          // Count data
          if (data.trails) analysis.trailCount = Array.isArray(data.trails) ? data.trails.length : 0;
          if (data.lifts) analysis.liftCount = Array.isArray(data.lifts) ? data.lifts.length : 0;
          if (Array.isArray(data)) analysis.arrayLength = data.length;

          dataRequests.push(analysis);

          console.log(`    Size: ${body.length} bytes`);
          console.log(`    Has trails: ${analysis.hasTrails}, Has lifts: ${analysis.hasLifts}`);
          if (analysis.trailCount) console.log(`    Trail count: ${analysis.trailCount}`);
          if (analysis.liftCount) console.log(`    Lift count: ${analysis.liftCount}`);
          if (analysis.sampleKeys.length) console.log(`    Keys: ${analysis.sampleKeys.join(', ')}`);
        } catch (e) {
          console.log(`    ⚠ Could not parse JSON: ${e.message}`);
        }
      }
    }
  });

  try {
    console.log('Loading page...');
    await page.goto(resort.url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    console.log('Page loaded, waiting for additional requests...');
    await page.waitForTimeout(3000);

    // Try to find embedded data
    console.log('\nSearching for embedded data...');
    const embeddedData = await page.evaluate(() => {
      const found = [];

      // Check window object for data
      const keys = Object.keys(window);
      for (const key of keys) {
        try {
          const val = window[key];
          if (val && typeof val === 'object') {
            const str = JSON.stringify(val).toLowerCase();
            if ((str.includes('trail') || str.includes('lift')) && str.length > 100) {
              found.push({
                source: `window.${key}`,
                hasTrails: str.includes('trail'),
                hasLifts: str.includes('lift'),
                size: str.length
              });
            }
          }
        } catch (e) {}
      }

      // Check for __NEXT_DATA__
      const nextDataElement = document.getElementById('__NEXT_DATA__');
      if (nextDataElement) {
        try {
          const data = JSON.parse(nextDataElement.textContent);
          const str = JSON.stringify(data).toLowerCase();
          found.push({
            source: '__NEXT_DATA__',
            hasTrails: str.includes('trail'),
            hasLifts: str.includes('lift'),
            size: str.length
          });
        } catch (e) {}
      }

      return found;
    });

    if (embeddedData.length > 0) {
      console.log(`Found ${embeddedData.length} embedded data source(s):`);
      embeddedData.forEach((data, i) => {
        console.log(`  ${i + 1}. ${data.source}`);
        console.log(`     Trails: ${data.hasTrails}, Lifts: ${data.hasLifts}, Size: ${data.size} chars`);
      });
    } else {
      console.log('No embedded data found in window object');
    }

  } catch (error) {
    console.log(`Error: ${error.message}`);
  }

  await browser.close();

  return {
    resort: resort.name,
    url: resort.url,
    apiRequests,
    dataRequests
  };
}

async function main() {
  console.log('PUPPETEER NETWORK INSPECTOR');
  console.log('Capturing API requests from resort pages\n');

  const results = [];

  for (const resort of RESORTS) {
    const result = await inspectResortPage(resort);
    results.push(result);

    // Delay between resorts
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80) + '\n');

  results.forEach(result => {
    console.log(`\n${result.resort}:`);
    console.log(`  URL: ${result.url}`);

    if (result.dataRequests.length > 0) {
      console.log(`  ✓ Found ${result.dataRequests.length} API endpoint(s) with relevant data:`);
      result.dataRequests.forEach(req => {
        console.log(`    - ${req.url}`);
        console.log(`      Trails: ${req.hasTrails}, Lifts: ${req.hasLifts}`);
        if (req.trailCount || req.liftCount) {
          console.log(`      Data: ${req.trailCount || 0} trails, ${req.liftCount || 0} lifts`);
        }
      });
    } else if (result.apiRequests.length > 0) {
      console.log(`  ℹ Captured ${result.apiRequests.length} API request(s) (no relevant data):`);
      result.apiRequests.slice(0, 3).forEach(req => {
        console.log(`    - ${req.url}`);
      });
    } else {
      console.log(`  ✗ No API requests captured`);
    }
  });

  // Save results
  const fs = require('fs');
  fs.writeFileSync('puppeteer-network-results.json', JSON.stringify(results, null, 2));
  console.log(`\n\nFull results saved to: puppeteer-network-results.json`);
}

if (require.main === module) {
  main().catch(console.error);
}
