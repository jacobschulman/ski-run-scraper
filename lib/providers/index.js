// lib/providers/index.js - Provider registry and dispatcher
// Routes resorts to correct provider based on config.apiProvider

const reportpal = require('./reportpal');
const dor = require('./dor');
const zaneray = require('./zaneray');
const snocountry = require('./snocountry');
const aspensnowmass = require('./aspensnowmass');

const providers = {
  reportpal,
  dor,
  zaneray,
  snocountry,
  aspensnowmass
};

/**
 * Fetch resort data from the appropriate provider
 * @param {Object} resort - Resort configuration object
 * @returns {Promise<Object>} - Raw API response data
 */
async function fetchResortData(resort) {
  const providerName = resort.apiProvider;

  if (!providerName) {
    throw new Error(`No apiProvider configured for resort: ${resort.key}`);
  }

  const provider = providers[providerName];

  if (!provider) {
    throw new Error(`Unknown provider: ${providerName} for resort: ${resort.key}`);
  }

  return await provider.fetch(resort);
}

/**
 * Get list of resorts grouped by provider
 * @param {Array} resorts - Array of resort configurations
 * @param {String} providerField - Field to use for grouping ('apiProvider' or 'snowApiProvider')
 * @returns {Object} - Resorts grouped by apiProvider
 */
function groupResortsByProvider(resorts, providerField = 'apiProvider') {
  const groups = {
    inspector: [],  // Default Inspector API
    reportpal: [],
    dor: [],
    zaneray: [],
    snocountry: [],
    aspensnowmass: []
  };

  resorts.forEach(resort => {
    // For snow scraping, check snowApiProvider first, then fall back to apiProvider
    const provider = providerField === 'snowApiProvider'
      ? (resort.snowApiProvider || resort.apiProvider || 'inspector')
      : (resort.apiProvider || 'inspector');
    if (!groups[provider]) {
      groups[provider] = [];
    }
    groups[provider].push(resort);
  });

  return groups;
}

module.exports = {
  fetchResortData,
  groupResortsByProvider,
  providers
};
