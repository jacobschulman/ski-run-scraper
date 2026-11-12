// lib/providers/dor.js - DOR (Digital Operations & Reporting) API provider
// Used by: Killington, Copper Mountain, Snowbird


/**
 * Fetch resort data from DOR API
 * @param {Object} resort - Resort configuration with apiConfig
 * @returns {Promise<Object>} - Raw DOR API response
 */
async function fetch(resort) {
  if (!resort.apiConfig) throw Error(`No apiConfig for ${resort.key}`);
  return require('../source-http').fetchSource(resort.apiConfig.baseUrl + resort.apiConfig.endpoint);
}

module.exports = { fetch };
