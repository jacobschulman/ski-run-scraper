// lib/providers/zaneray.js - Zaneray CMS API provider
// Used by: Jackson Hole

const https = require('https');

/**
 * Fetch resort data from Zaneray CMS API
 * @param {Object} resort - Resort configuration with apiConfig
 * @returns {Promise<Object>} - Raw Zaneray API response
 */
function fetch(resort) {
  return new Promise((resolve, reject) => {
    if (!resort.apiConfig) {
      reject(new Error(`No apiConfig for resort: ${resort.key}`));
      return;
    }

    const { apiUrl } = resort.apiConfig;

    console.log(`  📡 Fetching Zaneray data from: ${apiUrl}`);

    const urlObj = new URL(apiUrl);
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
            reject(new Error(`Failed to parse Zaneray JSON for ${resort.key}: ${error.message}`));
          }
        } else {
          reject(new Error(`Zaneray HTTP ${res.statusCode} for ${resort.key}: ${res.statusMessage}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Zaneray request failed for ${resort.key}: ${error.message}`));
    });

    req.end();
  });
}

module.exports = { fetch };
