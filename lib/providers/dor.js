// lib/providers/dor.js - DOR (Digital Operations & Reporting) API provider
// Used by: Killington, Copper Mountain, Snowbird

const https = require('https');

/**
 * Fetch resort data from DOR API
 * @param {Object} resort - Resort configuration with apiConfig
 * @returns {Promise<Object>} - Raw DOR API response
 */
function fetch(resort) {
  return new Promise((resolve, reject) => {
    if (!resort.apiConfig) {
      reject(new Error(`No apiConfig for resort: ${resort.key}`));
      return;
    }

    const { baseUrl, endpoint } = resort.apiConfig;
    const url = `${baseUrl}${endpoint}`;

    console.log(`  📡 Fetching DOR data from: ${url}`);

    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
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
            reject(new Error(`Failed to parse DOR JSON for ${resort.key}: ${error.message}`));
          }
        } else {
          reject(new Error(`DOR HTTP ${res.statusCode} for ${resort.key}: ${res.statusMessage}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`DOR request failed for ${resort.key}: ${error.message}`));
    });

    req.end();
  });
}

module.exports = { fetch };
