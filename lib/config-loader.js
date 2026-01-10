// lib/config-loader.js - Shared configuration loading
// Used by all scrapers to load and parse config.json

const fs = require('fs');

/**
 * Load and parse config.json
 * @param {string} configPath - Path to config file (defaults to 'config.json')
 */
function loadConfig(configPath = 'config.json') {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

/**
 * Convert resorts array to object keyed by resort key
 */
function getResortsMap(config) {
  return config.resorts.reduce((acc, resort) => {
    acc[resort.key] = resort;
    return acc;
  }, {});
}

/**
 * Get resorts filtered by provider
 * @param {Object} config - The loaded config object
 * @param {String} provider - Provider name ('vail' or 'ikon')
 * @param {Boolean} excludeCustomApiProviders - If true, exclude resorts with custom apiProvider (default: true)
 * @returns {Array} - Array of resort objects for that provider
 */
function getResortsByProvider(config, provider, excludeCustomApiProviders = true) {
  return config.resorts.filter(resort => {
    if (resort.provider !== provider) return false;
    // Exclude resorts with custom apiProviders (like canadian-big3) to avoid double-scraping
    if (excludeCustomApiProviders && resort.apiProvider) return false;
    return true;
  });
}

module.exports = {
  loadConfig,
  getResortsMap,
  getResortsByProvider
};
