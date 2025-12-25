// lib/providers/snocountry.js - SnoCountry API provider
// Used by: Snowbird, Killington, Copper Mountain
// Documentation: http://feeds.snocountry.net/

const http = require('http');

// SnoCountry API configuration
const SNOCOUNTRY_API_BASE = 'http://feeds.snocountry.net';
const SNOCOUNTRY_API_KEY = process.env.SNOCOUNTRY_API_KEY || 'SnoCountry.example';

/**
 * Fetch resort snow data from SnoCountry API
 * @param {Object} resort - Resort configuration with apiConfig
 * @returns {Promise<Object>} - Raw SnoCountry API response
 */
function fetch(resort) {
  return new Promise((resolve, reject) => {
    if (!resort.apiConfig) {
      reject(new Error(`No apiConfig for resort: ${resort.key}`));
      return;
    }

    const { resortId } = resort.apiConfig;
    if (!resortId) {
      reject(new Error(`No SnoCountry resortId configured for: ${resort.key}`));
      return;
    }

    const url = `${SNOCOUNTRY_API_BASE}/getSnowReport.php?apiKey=${SNOCOUNTRY_API_KEY}&ids=${resortId}`;

    console.log(`  📡 Fetching SnoCountry data for resort ID: ${resortId}`);

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

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            // SnoCountry returns an object with items array
            const items = json.items || [];
            if (items.length === 0) {
              reject(new Error(`No data returned from SnoCountry for ${resort.key}`));
              return;
            }
            // Return the first (and should be only) resort data
            resolve(items[0]);
          } catch (error) {
            reject(new Error(`Failed to parse SnoCountry JSON for ${resort.key}: ${error.message}`));
          }
        } else {
          reject(new Error(`SnoCountry HTTP ${res.statusCode} for ${resort.key}: ${res.statusMessage}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`SnoCountry request failed for ${resort.key}: ${error.message}`));
    });

    req.end();
  });
}

module.exports = { fetch };
