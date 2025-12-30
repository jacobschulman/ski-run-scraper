// lib/providers/aspensnowmass.js - Aspen Snowmass API provider
// Used by: Aspen Mountain, Aspen Highlands, Buttermilk, Snowmass
// API: aspensnowmass.com/AspenSnowmass/{endpoint}

const https = require('https');

const ASPEN_BASE_URL = 'https://www.aspensnowmass.com/AspenSnowmass';

/**
 * Fetch data from Aspen Snowmass API endpoint
 * @param {string} endpoint - API endpoint path
 * @returns {Promise<Object>} - Parsed JSON response
 */
function fetchEndpoint(endpoint) {
  return new Promise((resolve, reject) => {
    https.get(`${ASPEN_BASE_URL}/${endpoint}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Fetch resort terrain data from Aspen Snowmass API
 * Fetches lift status, snow report, and grooming data
 * @param {Object} resort - Resort configuration with apiConfig
 * @returns {Promise<Object>} - Combined API response data
 */
async function fetch(resort) {
  if (!resort.apiConfig) {
    throw new Error(`No apiConfig for resort: ${resort.key}`);
  }

  const { mountainId } = resort.apiConfig;
  if (!mountainId) {
    throw new Error(`No Aspen mountainId configured for: ${resort.key}`);
  }

  console.log(`  📡 Fetching Aspen Snowmass data for: ${mountainId}`);

  // Fetch all three data sources in parallel
  const [liftData, snowData, groomingData] = await Promise.all([
    fetchEndpoint(`LiftStatus/Feed?mountain=${mountainId}&areas=&isSummer=False`).catch(() => null),
    fetchEndpoint(`SnowReport/Feed?mountain=${mountainId}`).catch(() => null),
    fetchEndpoint(`GroomingReport/Feed?mountain=${mountainId}`).catch(() => null),
  ]);

  if (!liftData && !snowData && !groomingData) {
    throw new Error(`No data available from Aspen Snowmass for ${resort.key}`);
  }

  // Return combined data for normalization
  return {
    liftStatus: liftData,
    snowReport: snowData,
    groomingReport: groomingData,
    mountainId,
    resortKey: resort.key
  };
}

module.exports = { fetch };
