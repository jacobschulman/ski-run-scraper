// lib/providers/reportpal.js - ReportPal API provider
// Used by: Big Sky, Sugarloaf, Sunday River, Loon Mountain

const https = require('https');

/**
 * Fetch resort data from ReportPal API
 * @param {Object} resort - Resort configuration with apiConfig
 * @returns {Promise<Object>} - Raw ReportPal API response
 */
function fetch(resort) {
  return new Promise((resolve, reject) => {
    if (!resort.apiConfig) {
      reject(new Error(`No apiConfig for resort: ${resort.key}`));
      return;
    }

    const { baseUrl, resortCode } = resort.apiConfig;
    const url = `${baseUrl}/api/reportpal?resortName=${resortCode}&useReportPal=true`;

    console.log(`  📡 Fetching ReportPal data from: ${url}`);

    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SkiRunScraper/1.0'
      }
    };

    const req = https.request(options, (res) => {
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
            reject(new Error(`Failed to parse ReportPal JSON for ${resort.key}: ${error.message}`));
          }
        } else {
          reject(new Error(`ReportPal HTTP ${res.statusCode} for ${resort.key}: ${res.statusMessage}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`ReportPal request failed for ${resort.key}: ${error.message}`));
    });

    req.end();
  });
}

module.exports = { fetch };
