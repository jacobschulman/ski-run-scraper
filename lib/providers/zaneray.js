// lib/providers/zaneray.js - Zaneray CMS API provider
// Used by: Jackson Hole


/**
 * Fetch resort data from Zaneray CMS API
 * @param {Object} resort - Resort configuration with apiConfig
 * @returns {Promise<Object>} - Raw Zaneray API response
 */
async function fetch(resort) {
  if (!resort.apiConfig) throw Error(`No apiConfig for ${resort.key}`);
  return require('../source-http').fetchSource(resort.apiConfig.apiUrl);
}

module.exports = { fetch };
