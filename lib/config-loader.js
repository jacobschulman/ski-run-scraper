// lib/config-loader.js - Shared configuration loading
// Used by all scrapers to load and parse config.json

const fs = require('fs');

/**
 * Load and parse config.json
 */
function loadConfig() {
  return JSON.parse(fs.readFileSync('config.json', 'utf8'));
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
 * @param {String} provider - Provider name ('vail' or 'inspector')
 * @returns {Array} - Array of resort objects for that provider
 */
function getResortsByProvider(config, provider) {
  return config.resorts.filter(resort => resort.provider === provider);
}

module.exports = {
  loadConfig,
  getResortsMap,
  getResortsByProvider
};
