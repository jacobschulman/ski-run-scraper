// test-resort-apis.js - Comprehensive API endpoint discovery for ski resorts
// Tests multiple patterns to find working terrain/lift status APIs

const https = require('https');
const http = require('http');
const { URL } = require('url');

// Resort configuration
const RESORTS = [
  {
    name: 'Jackson Hole',
    domain: 'jacksonhole.com',
    codes: ['jh', 'jacksonhole', 'jackson'],
    trailStatusUrl: 'https://www.jacksonhole.com/trail-report-and-grooming',
    liftStatusUrl: 'https://www.jacksonhole.com/lift-and-gondola-status'
  },
  {
    name: 'Copper Mountain',
    domain: 'coppercolorado.com',
    codes: ['copper', 'cop', 'cm', 'coppercolorado'],
    trailStatusUrl: 'https://www.coppercolorado.com/the-mountain/conditions-weather/terrain-conditions',
    liftStatusUrl: 'https://www.coppercolorado.com/the-mountain/conditions-weather/terrain-conditions'
  },
  {
    name: 'Alta',
    domain: 'alta.com',
    codes: ['alta'],
    trailStatusUrl: 'https://www.alta.com/conditions',
    liftStatusUrl: 'https://www.alta.com/conditions'
  },
  {
    name: 'Snowbird',
    domain: 'snowbird.com',
    codes: ['snowbird', 'sb'],
    trailStatusUrl: 'https://www.snowbird.com/mountain-report/',
    liftStatusUrl: 'https://www.snowbird.com/mountain-report/'
  },
  {
    name: 'Aspen Highlands',
    domain: 'aspensnowmass.com',
    codes: ['aspenhighlands', 'highlands', 'aspen'],
    trailStatusUrl: 'https://www.aspensnowmass.com/ski-snowboard/mountain-report',
    liftStatusUrl: 'https://www.aspensnowmass.com/ski-snowboard/mountain-report'
  },
  {
    name: 'Aspen Mountain',
    domain: 'aspensnowmass.com',
    codes: ['aspenmountain', 'aspen'],
    trailStatusUrl: 'https://www.aspensnowmass.com/ski-snowboard/mountain-report',
    liftStatusUrl: 'https://www.aspensnowmass.com/ski-snowboard/mountain-report'
  },
  {
    name: 'Buttermilk',
    domain: 'aspensnowmass.com',
    codes: ['buttermilk', 'aspen'],
    trailStatusUrl: 'https://www.aspensnowmass.com/ski-snowboard/mountain-report',
    liftStatusUrl: 'https://www.aspensnowmass.com/ski-snowboard/mountain-report'
  },
  {
    name: 'Revelstoke',
    domain: 'revelstokemountainresort.com',
    codes: ['revelstoke', 'rev', 'rr', 'rmr'],
    trailStatusUrl: 'https://www.revelstokemountainresort.com/mountain-report',
    liftStatusUrl: 'https://www.revelstokemountainresort.com/mountain-report'
  },
  {
    name: 'Lake Louise',
    domain: 'skilouise.com',
    codes: ['lakelouise', 'll', 'skilouise', 'louise'],
    trailStatusUrl: 'https://www.skilouise.com/conditions-weather',
    liftStatusUrl: 'https://www.skilouise.com/conditions-weather'
  }
];

// Test patterns
const API_PATTERNS = [
  // ReportPal pattern
  {
    name: 'ReportPal',
    generator: (domain, code) => `https://${domain}/api/reportpal?resortName=${code}&useReportPal=true`
  },
  {
    name: 'ReportPal www',
    generator: (domain, code) => `https://www.${domain}/api/reportpal?resortName=${code}&useReportPal=true`
  },
  // Common API paths
  {
    name: 'API Conditions',
    generator: (domain) => `https://${domain}/api/conditions`
  },
  {
    name: 'API Conditions www',
    generator: (domain) => `https://www.${domain}/api/conditions`
  },
  {
    name: 'API v1 Status',
    generator: (domain) => `https://${domain}/api/v1/status`
  },
  {
    name: 'API v1 Status www',
    generator: (domain) => `https://www.${domain}/api/v1/status`
  },
  {
    name: 'API Trails',
    generator: (domain) => `https://${domain}/api/trails`
  },
  {
    name: 'API Lifts',
    generator: (domain) => `https://${domain}/api/lifts`
  },
  {
    name: 'API Mountain Status',
    generator: (domain) => `https://${domain}/api/mountain-status`
  },
  // DOR Pattern
  {
    name: 'DOR Lift Trail Report',
    generator: (domain) => `https://api.${domain}/api/v1/dor/lift-trail-report`
  },
  // Feed patterns
  {
    name: 'Feed Conditions JSON',
    generator: (domain) => `https://${domain}/feed/conditions.json`
  },
  {
    name: 'Data Status JSON',
    generator: (domain) => `https://${domain}/data/status.json`
  },
  // Additional common patterns
  {
    name: 'API v2 Conditions',
    generator: (domain) => `https://${domain}/api/v2/conditions`
  },
  {
    name: 'API Mountain Conditions',
    generator: (domain) => `https://${domain}/api/mountain-conditions`
  },
  {
    name: 'API Trail Status',
    generator: (domain) => `https://${domain}/api/trail-status`
  },
  {
    name: 'API Lift Status',
    generator: (domain) => `https://${domain}/api/lift-status`
  }
];

/**
 * Make HTTP GET request
 */
function makeRequest(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json, text/html, */*'
      },
      timeout: timeout
    };

    const req = protocol.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Test if response contains valid JSON with trail/lift data
 */
function analyzeResponse(response, url) {
  const { statusCode, headers, body } = response;

  if (statusCode !== 200) {
    return { success: false, reason: `HTTP ${statusCode}` };
  }

  // Check if it's JSON
  const contentType = headers['content-type'] || '';
  let isJson = contentType.includes('application/json');

  // Try to parse as JSON
  let data;
  try {
    data = JSON.parse(body);
    isJson = true;
  } catch (e) {
    // Not JSON - might be HTML
    if (body.includes('<html') || body.includes('<!DOCTYPE')) {
      return { success: false, reason: 'HTML response' };
    }
    return { success: false, reason: 'Invalid JSON' };
  }

  // Analyze JSON structure
  const analysis = {
    success: true,
    statusCode,
    dataType: Array.isArray(data) ? 'array' : typeof data,
    keys: typeof data === 'object' ? Object.keys(data) : [],
    size: body.length
  };

  // Look for trail/lift indicators
  const jsonStr = JSON.stringify(data).toLowerCase();
  const indicators = {
    hasTrails: jsonStr.includes('trail') || jsonStr.includes('run'),
    hasLifts: jsonStr.includes('lift') || jsonStr.includes('gondola') || jsonStr.includes('chairlift'),
    hasStatus: jsonStr.includes('status') || jsonStr.includes('open') || jsonStr.includes('closed'),
    hasGrooming: jsonStr.includes('groom'),
    hasConditions: jsonStr.includes('condition'),
    hasSnow: jsonStr.includes('snow'),
    hasResortName: false
  };

  // Count potential trail/lift objects
  let trailCount = 0;
  let liftCount = 0;

  if (Array.isArray(data)) {
    trailCount = data.length;
    liftCount = data.length;
  } else if (data.trails || data.Trails) {
    const trails = data.trails || data.Trails;
    trailCount = Array.isArray(trails) ? trails.length : Object.keys(trails).length;
  } else if (data.lifts || data.Lifts) {
    const lifts = data.lifts || data.Lifts;
    liftCount = Array.isArray(lifts) ? lifts.length : Object.keys(lifts).length;
  } else if (data.features) {
    trailCount = Array.isArray(data.features) ? data.features.length : 0;
  }

  analysis.indicators = indicators;
  analysis.trailCount = trailCount;
  analysis.liftCount = liftCount;
  analysis.relevanceScore =
    (indicators.hasTrails ? 3 : 0) +
    (indicators.hasLifts ? 3 : 0) +
    (indicators.hasStatus ? 2 : 0) +
    (indicators.hasGrooming ? 1 : 0) +
    (indicators.hasConditions ? 1 : 0) +
    (trailCount > 5 ? 2 : 0) +
    (liftCount > 2 ? 2 : 0);

  // Sample some data
  if (Array.isArray(data) && data.length > 0) {
    analysis.sample = data[0];
  } else if (typeof data === 'object') {
    const sampleKeys = analysis.keys.slice(0, 5);
    analysis.sample = {};
    sampleKeys.forEach(key => {
      const val = data[key];
      if (typeof val === 'object' && !Array.isArray(val)) {
        analysis.sample[key] = '[Object]';
      } else if (Array.isArray(val)) {
        analysis.sample[key] = `[Array(${val.length})]`;
      } else {
        analysis.sample[key] = val;
      }
    });
  }

  return analysis;
}

/**
 * Fetch and analyze webpage for embedded data
 */
async function analyzeWebpage(url) {
  try {
    const response = await makeRequest(url);

    if (response.statusCode !== 200) {
      return { success: false, reason: `HTTP ${response.statusCode}` };
    }

    const body = response.body;
    const results = {
      success: true,
      findings: []
    };

    // Look for JSON in script tags
    const scriptMatches = body.matchAll(/<script[^>]*>(.*?)<\/script>/gis);
    for (const match of scriptMatches) {
      const scriptContent = match[1];

      // Look for JSON assignments
      const jsonPatterns = [
        /var\s+\w+\s*=\s*(\{.*?\});/gs,
        /const\s+\w+\s*=\s*(\{.*?\});/gs,
        /let\s+\w+\s*=\s*(\{.*?\});/gs,
        /__NEXT_DATA__\s*=\s*(\{.*?\})/gs,
        /window\.\w+\s*=\s*(\{.*?\})/gs
      ];

      for (const pattern of jsonPatterns) {
        const matches = scriptContent.matchAll(pattern);
        for (const m of matches) {
          try {
            const jsonData = JSON.parse(m[1]);
            const jsonStr = JSON.stringify(jsonData).toLowerCase();

            if (jsonStr.includes('trail') || jsonStr.includes('lift') || jsonStr.includes('status')) {
              results.findings.push({
                type: 'embedded_json',
                pattern: pattern.source.substring(0, 30) + '...',
                hasTrails: jsonStr.includes('trail'),
                hasLifts: jsonStr.includes('lift'),
                sample: JSON.stringify(jsonData).substring(0, 200)
              });
            }
          } catch (e) {
            // Not valid JSON
          }
        }
      }
    }

    // Look for API endpoint references
    const apiPatterns = [
      /["'](https?:\/\/[^"']+\/api\/[^"']+)["']/gi,
      /fetch\s*\(\s*["']([^"']+)["']/gi,
      /axios\.get\s*\(\s*["']([^"']+)["']/gi
    ];

    for (const pattern of apiPatterns) {
      const matches = body.matchAll(pattern);
      for (const match of matches) {
        const endpoint = match[1];
        if (endpoint.includes('api') &&
            (endpoint.includes('trail') || endpoint.includes('lift') ||
             endpoint.includes('status') || endpoint.includes('condition'))) {
          results.findings.push({
            type: 'api_reference',
            endpoint: endpoint
          });
        }
      }
    }

    return results;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Test all patterns for a resort
 */
async function testResort(resort) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TESTING: ${resort.name}`);
  console.log(`Domain: ${resort.domain}`);
  console.log(`Codes: ${resort.codes.join(', ')}`);
  console.log(`${'='.repeat(80)}\n`);

  const results = {
    resort: resort.name,
    workingApis: [],
    failedApis: [],
    webpageAnalysis: null
  };

  // Test API patterns
  for (const pattern of API_PATTERNS) {
    // For patterns that use resort codes, test all codes
    if (pattern.generator.length > 1) {
      for (const code of resort.codes) {
        const url = pattern.generator(resort.domain, code);
        console.log(`Testing: ${pattern.name} (${code})`);
        console.log(`  URL: ${url}`);

        try {
          const response = await makeRequest(url, 8000);
          const analysis = analyzeResponse(response, url);

          if (analysis.success && analysis.relevanceScore > 3) {
            console.log(`  ✓ SUCCESS! Relevance: ${analysis.relevanceScore}/14`);
            console.log(`    Trails: ${analysis.trailCount}, Lifts: ${analysis.liftCount}`);
            console.log(`    Keys: ${analysis.keys.join(', ').substring(0, 80)}`);
            results.workingApis.push({
              pattern: `${pattern.name} (${code})`,
              url,
              analysis
            });
          } else if (analysis.success) {
            console.log(`  ○ JSON but low relevance: ${analysis.relevanceScore}/14`);
            results.failedApis.push({ url, reason: `Low relevance (${analysis.relevanceScore})` });
          } else {
            console.log(`  ✗ ${analysis.reason}`);
            results.failedApis.push({ url, reason: analysis.reason });
          }
        } catch (error) {
          console.log(`  ✗ ${error.message}`);
          results.failedApis.push({ url, reason: error.message });
        }

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } else {
      // Pattern doesn't use resort codes
      const url = pattern.generator(resort.domain);
      console.log(`Testing: ${pattern.name}`);
      console.log(`  URL: ${url}`);

      try {
        const response = await makeRequest(url, 8000);
        const analysis = analyzeResponse(response, url);

        if (analysis.success && analysis.relevanceScore > 3) {
          console.log(`  ✓ SUCCESS! Relevance: ${analysis.relevanceScore}/14`);
          console.log(`    Trails: ${analysis.trailCount}, Lifts: ${analysis.liftCount}`);
          console.log(`    Keys: ${analysis.keys.join(', ').substring(0, 80)}`);
          results.workingApis.push({
            pattern: pattern.name,
            url,
            analysis
          });
        } else if (analysis.success) {
          console.log(`  ○ JSON but low relevance: ${analysis.relevanceScore}/14`);
          results.failedApis.push({ url, reason: `Low relevance (${analysis.relevanceScore})` });
        } else {
          console.log(`  ✗ ${analysis.reason}`);
          results.failedApis.push({ url, reason: analysis.reason });
        }
      } catch (error) {
        console.log(`  ✗ ${error.message}`);
        results.failedApis.push({ url, reason: error.message });
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Analyze webpage
  console.log(`\nAnalyzing webpage: ${resort.trailStatusUrl}`);
  const webAnalysis = await analyzeWebpage(resort.trailStatusUrl);
  results.webpageAnalysis = webAnalysis;

  if (webAnalysis.success && webAnalysis.findings.length > 0) {
    console.log(`  Found ${webAnalysis.findings.length} potential data sources:`);
    webAnalysis.findings.forEach((finding, i) => {
      console.log(`  ${i + 1}. Type: ${finding.type}`);
      if (finding.endpoint) {
        console.log(`     Endpoint: ${finding.endpoint}`);
      }
      if (finding.hasTrails || finding.hasLifts) {
        console.log(`     Has trails: ${finding.hasTrails}, Has lifts: ${finding.hasLifts}`);
      }
    });
  } else {
    console.log(`  No embedded data found`);
  }

  return results;
}

/**
 * Main execution
 */
async function main() {
  console.log('SKI RESORT API ENDPOINT DISCOVERY');
  console.log('Testing multiple API patterns for terrain and lift status data\n');

  const allResults = [];

  for (const resort of RESORTS) {
    const result = await testResort(resort);
    allResults.push(result);

    // Longer delay between resorts
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80) + '\n');

  allResults.forEach(result => {
    console.log(`\n${result.resort}:`);
    if (result.workingApis.length > 0) {
      console.log(`  ✓ Found ${result.workingApis.length} working API(s):`);
      result.workingApis.forEach(api => {
        console.log(`    - ${api.pattern}`);
        console.log(`      URL: ${api.url}`);
        console.log(`      Score: ${api.analysis.relevanceScore}/14`);
        console.log(`      Trails: ${api.analysis.trailCount}, Lifts: ${api.analysis.liftCount}`);
        console.log(`      Top keys: ${api.analysis.keys.slice(0, 5).join(', ')}`);
      });
    } else {
      console.log(`  ✗ No working APIs found`);
    }

    if (result.webpageAnalysis?.findings?.length > 0) {
      console.log(`  ℹ Webpage has ${result.webpageAnalysis.findings.length} embedded data source(s)`);
    }
  });

  // Save full results
  const fs = require('fs');
  const outputFile = 'resort-api-investigation-results.json';
  fs.writeFileSync(outputFile, JSON.stringify(allResults, null, 2));
  console.log(`\n\nFull results saved to: ${outputFile}`);
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testResort, analyzeWebpage };
