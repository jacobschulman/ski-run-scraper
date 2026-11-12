// lib/providers/reportpal.js - ReportPal API provider
// Used by: Big Sky, Sugarloaf, Sunday River, Loon Mountain


/**
 * Fetch resort data from ReportPal API
 * @param {Object} resort - Resort configuration with apiConfig
 * @returns {Promise<Object>} - Raw ReportPal API response
 */
async function fetch(resort) {
  if (!resort.apiConfig) throw Error(`No apiConfig for ${resort.key}`);
  return require('../source-http').fetchSource(`${resort.apiConfig.baseUrl}/api/reportpal?resortName=${resort.apiConfig.resortCode}&useReportPal=true`);
}

module.exports = { fetch };
