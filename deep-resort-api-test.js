// deep-resort-api-test.js - Deep dive API testing for specific resorts
// Tests more patterns and inspects web pages in detail

const https = require('https');
const http = require('http');
const { URL } = require('url');

const RESORTS = [
  {
    name: 'Jackson Hole',
    testUrls: [
      'https://www.jacksonhole.com/trail-report',
      'https://www.jacksonhole.com/lift-status',
      'https://jacksonhole.com/trail-report'
    ],
    apiPatterns: [
      'https://api.jacksonhole.com/v1/lifts',
      'https://api.jacksonhole.com/v1/trails',
      'https://api.jacksonhole.com/trails',
      'https://api.jacksonhole.com/lifts',
      'https://www.jacksonhole.com/api/v1/conditions',
      'https://www.jacksonhole.com/api/conditions',
      'https://www.jacksonhole.com/api/mountain/status',
      'https://jacksonhole.com/api/mountain-conditions.json',
      'https://www.jacksonhole.com/_next/data/trail-report.json',
      'https://cms.jacksonhole.com/api/conditions'
    ]
  },
  {
    name: 'Alta',
    testUrls: [
      'https://www.alta.com/mountain/mountain-report',
      'https://alta.com/mountain/mountain-report',
      'https://www.alta.com/conditions'
    ],
    apiPatterns: [
      'https://www.alta.com/api/mountain-report',
      'https://www.alta.com/api/v1/conditions',
      'https://www.alta.com/api/lifts',
      'https://www.alta.com/api/trails',
      'https://alta.com/api/conditions.json',
      'https://www.alta.com/wp-json/alta/v1/mountain-report',
      'https://cms.alta.com/api/conditions'
    ]
  },
  {
    name: 'Aspen Snowmass',
    testUrls: [
      'https://www.aspensnowmass.com/ski-snowboard/mountain-report',
      'https://www.aspensnowmass.com/our-mountains/aspen-highlands'
    ],
    apiPatterns: [
      'https://www.aspensnowmass.com/api/mountain-report',
      'https://www.aspensnowmass.com/api/v1/conditions',
      'https://www.aspensnowmass.com/api/lifts',
      'https://www.aspensnowmass.com/api/trails',
      'https://www.aspensnowmass.com/api/v2/trail-conditions',
      'https://cms.aspensnowmass.com/api/conditions',
      'https://api.aspensnowmass.com/v1/mountain-status'
    ]
  },
  {
    name: 'Revelstoke',
    testUrls: [
      'https://www.revelstokemountainresort.com/mountain-report',
      'https://revelstokemountainresort.com/mountain-conditions'
    ],
    apiPatterns: [
      'https://www.revelstokemountainresort.com/api/conditions',
      'https://www.revelstokemountainresort.com/api/v1/mountain-report',
      'https://www.revelstokemountainresort.com/api/lifts',
      'https://www.revelstokemountainresort.com/api/trails',
      'https://cms.revelstokemountainresort.com/api/conditions'
    ]
  },
  {
    name: 'Lake Louise',
    testUrls: [
      'https://www.skilouise.com/conditions-weather',
      'https://www.skilouise.com/mountain-information/lift-and-terrain-status'
    ],
    apiPatterns: [
      'https://www.skilouise.com/api/conditions',
      'https://www.skilouise.com/api/v1/mountain-status',
      'https://www.skilouise.com/api/lifts',
      'https://www.skilouise.com/api/trails',
      'https://api.skilouise.com/v1/conditions',
      'https://cms.skilouise.com/api/conditions'
    ]
  }
];

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': `https://${parsedUrl.hostname}/`,
        ...options.headers
      },
      timeout: options.timeout || 10000,
      rejectUnauthorized: false // Allow self-signed certs for testing
    };

    const req = protocol.request(requestOptions, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          url: url
        });
      });
    });

    req.on('error', (error) => {
      reject({ error: error.message, url });
    });

    req.on('timeout', () => {
      req.destroy();
      reject({ error: 'Timeout', url });
    });

    req.end();
  });
}

async function extractApiEndpoints(htmlBody, baseUrl) {
  const endpoints = new Set();

  // Pattern 1: Look for API URLs in strings
  const urlPatterns = [
    /(https?:\/\/[^"'\s<>]+api[^"'\s<>]*)/gi,
    /(\/api\/[^"'\s<>]+)/gi,
    /["']([^"']+\/(?:trails|lifts|conditions|status)[^"']*\.json?)["']/gi
  ];

  for (const pattern of urlPatterns) {
    const matches = htmlBody.matchAll(pattern);
    for (const match of matches) {
      let endpoint = match[1];
      if (endpoint.startsWith('/')) {
        try {
          const base = new URL(baseUrl);
          endpoint = `${base.protocol}//${base.hostname}${endpoint}`;
        } catch (e) {}
      }
      endpoints.add(endpoint);
    }
  }

  // Pattern 2: Look for JavaScript variable assignments with API data
  const dataVarPatterns = [
    /(?:const|var|let)\s+\w+\s*=\s*["']([^"']+api[^"']+)["']/gi,
    /fetch\s*\(\s*["']([^"']+)["']/gi,
    /axios\.get\s*\(\s*["']([^"']+)["']/gi,
    /\$\.ajax\s*\(\s*{[^}]*url\s*:\s*["']([^"']+)["']/gi
  ];

  for (const pattern of dataVarPatterns) {
    const matches = htmlBody.matchAll(pattern);
    for (const match of matches) {
      endpoints.add(match[1]);
    }
  }

  // Pattern 3: Look for embedded JSON with trail/lift data
  const scriptMatches = htmlBody.matchAll(/<script[^>]*>(.*?)<\/script>/gis);
  const embeddedData = [];

  for (const match of scriptMatches) {
    const scriptContent = match[1];

    // Check for JSON structures
    const jsonPatches = [
      /(?:trails|lifts|conditions)\s*:\s*(\[[\s\S]*?\])/gi,
      /__NEXT_DATA__\s*=\s*(\{[\s\S]*?\})<\/script>/gi,
      /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})/gi
    ];

    for (const jsonPattern of jsonPatches) {
      const jsonMatches = scriptContent.matchAll(jsonPattern);
      for (const jsonMatch of jsonMatches) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          const str = JSON.stringify(parsed).toLowerCase();
          if (str.includes('trail') || str.includes('lift')) {
            embeddedData.push({
              type: 'embedded_json',
              size: jsonMatch[1].length,
              hasTrails: str.includes('trail'),
              hasLifts: str.includes('lift')
            });
          }
        } catch (e) {
          // Not valid JSON
        }
      }
    }
  }

  return {
    endpoints: Array.from(endpoints),
    embeddedData
  };
}

async function testApiEndpoint(url) {
  try {
    const response = await makeRequest(url);

    if (response.statusCode === 200) {
      // Try to parse as JSON
      try {
        const data = JSON.parse(response.body);
        const str = JSON.stringify(data).toLowerCase();

        const analysis = {
          success: true,
          statusCode: 200,
          size: response.body.length,
          hasTrails: str.includes('trail'),
          hasLifts: str.includes('lift'),
          hasStatus: str.includes('status') || str.includes('open') || str.includes('closed'),
          isArray: Array.isArray(data),
          keys: typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).slice(0, 10) : []
        };

        // Count potential data
        if (data.trails) analysis.trailCount = Array.isArray(data.trails) ? data.trails.length : Object.keys(data.trails).length;
        if (data.lifts) analysis.liftCount = Array.isArray(data.lifts) ? data.lifts.length : Object.keys(data.lifts).length;
        if (Array.isArray(data)) {
          analysis.itemCount = data.length;
          analysis.sampleItem = data[0];
        }

        return analysis;
      } catch (e) {
        return {
          success: false,
          statusCode: 200,
          reason: 'Not JSON',
          contentType: response.headers['content-type'],
          bodyPreview: response.body.substring(0, 200)
        };
      }
    } else {
      return {
        success: false,
        statusCode: response.statusCode,
        reason: `HTTP ${response.statusCode}`
      };
    }
  } catch (err) {
    return {
      success: false,
      error: err.error || err.message
    };
  }
}

async function testResort(resort) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TESTING: ${resort.name}`);
  console.log(`${'='.repeat(80)}\n`);

  const results = {
    resort: resort.name,
    workingEndpoints: [],
    extractedEndpoints: [],
    failedTests: []
  };

  // Test predefined API patterns
  console.log(`Testing ${resort.apiPatterns.length} predefined API patterns...\n`);
  for (const apiUrl of resort.apiPatterns) {
    console.log(`  Testing: ${apiUrl}`);
    const result = await testApiEndpoint(apiUrl);

    if (result.success && (result.hasTrails || result.hasLifts)) {
      console.log(`    ✓ SUCCESS!`);
      console.log(`      Trails: ${result.hasTrails}, Lifts: ${result.hasLifts}, Status: ${result.hasStatus}`);
      if (result.trailCount) console.log(`      Trail count: ${result.trailCount}`);
      if (result.liftCount) console.log(`      Lift count: ${result.liftCount}`);
      if (result.keys.length) console.log(`      Keys: ${result.keys.join(', ')}`);
      results.workingEndpoints.push({ url: apiUrl, ...result });
    } else if (result.success) {
      console.log(`    ○ JSON but no trail/lift data`);
      results.failedTests.push({ url: apiUrl, reason: 'No trail/lift data' });
    } else {
      console.log(`    ✗ ${result.reason || result.error}`);
      results.failedTests.push({ url: apiUrl, reason: result.reason || result.error });
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Extract endpoints from web pages
  console.log(`\nAnalyzing ${resort.testUrls.length} web pages for API endpoints...\n`);
  for (const pageUrl of resort.testUrls) {
    console.log(`  Fetching: ${pageUrl}`);
    try {
      const response = await makeRequest(pageUrl);

      if (response.statusCode === 200) {
        const extracted = await extractApiEndpoints(response.body, pageUrl);
        console.log(`    Found ${extracted.endpoints.length} potential endpoints`);
        console.log(`    Found ${extracted.embeddedData.length} embedded data structures`);

        if (extracted.endpoints.length > 0) {
          results.extractedEndpoints.push(...extracted.endpoints.map(e => ({
            url: e,
            source: pageUrl
          })));

          // Test a few of the extracted endpoints
          for (const endpoint of extracted.endpoints.slice(0, 3)) {
            console.log(`    Testing extracted: ${endpoint}`);
            const result = await testApiEndpoint(endpoint);
            if (result.success && (result.hasTrails || result.hasLifts)) {
              console.log(`      ✓ WORKING!`);
              results.workingEndpoints.push({ url: endpoint, ...result });
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      } else {
        console.log(`    ✗ HTTP ${response.statusCode}`);
      }
    } catch (err) {
      console.log(`    ✗ ${err.error || err.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return results;
}

async function main() {
  console.log('DEEP API ENDPOINT DISCOVERY');
  console.log('Comprehensive testing for resorts without APIs\n');

  const allResults = [];

  for (const resort of RESORTS) {
    const result = await testResort(resort);
    allResults.push(result);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80) + '\n');

  allResults.forEach(result => {
    console.log(`\n${result.resort}:`);
    if (result.workingEndpoints.length > 0) {
      console.log(`  ✓ Found ${result.workingEndpoints.length} working endpoint(s):`);
      result.workingEndpoints.forEach(ep => {
        console.log(`    - ${ep.url}`);
        console.log(`      Trails: ${ep.hasTrails}, Lifts: ${ep.hasLifts}`);
        if (ep.trailCount) console.log(`      Data: ${ep.trailCount} trails, ${ep.liftCount || 0} lifts`);
      });
    } else {
      console.log(`  ✗ No working endpoints found`);
      if (result.extractedEndpoints.length > 0) {
        console.log(`  ℹ Extracted ${result.extractedEndpoints.length} potential endpoints (not tested)`);
      }
    }
  });

  // Save results
  const fs = require('fs');
  fs.writeFileSync('deep-api-investigation-results.json', JSON.stringify(allResults, null, 2));
  console.log(`\n\nFull results saved to: deep-api-investigation-results.json`);
}

if (require.main === module) {
  main().catch(console.error);
}
