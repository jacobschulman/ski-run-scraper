/**
 * Region definitions for ski resorts
 * Maps resort keys to geographic regions for aggregation
 */

const REGIONS = {
  'Colorado': [
    'vail', 'beavercreek', 'breckenridge', 'keystone', 'crestedbutte',
    'copper', 'steamboat', 'abasin', 'aspenhighlands', 'aspenmountain', 'buttermilk'
  ],
  'New Mexico': [
    'taos'
  ],
  'Utah': [
    'parkcity', 'deervalley', 'alta', 'snowbird', 'solitude'
  ],
  'California': [
    'heavenly', 'northstar', 'kirkwood', 'mammoth', 'junemountain', 'palisades'
  ],
  'Pacific Northwest': [
    'stevenspass', 'crystal'
  ],
  'Wyoming/Montana': [
    'jacksonhole', 'bigsky'
  ],
  'Vermont': [
    'stowe', 'okemo', 'mountsnow', 'stratton', 'killington', 'sugarbush'
  ],
  'New Hampshire/Maine': [
    'attitash', 'wildcat', 'mountsunapee', 'crotched', 'loon', 'sugarloaf', 'sundayriver'
  ],
  'New York': [
    'hunter'
  ],
  'Pennsylvania': [
    'liberty', 'roundtop', 'whitetail', 'jackfrost', 'bigboulder',
    'hiddenvalleypa', 'laurelmountain', 'sevensprings'
  ],
  'Midwest': [
    'wilmot', 'aftonalps', 'mtbrighton', 'alpinevalley', 'bostonmills',
    'brandywine', 'madrivermountain', 'hiddenvalley', 'snowcreek', 'paolipeaks'
  ],
  'Western Canada': [
    'whistlerblackcomb', 'revelstoke', 'cypressmountain', 'banff', 'lakelouise'
  ],
  'Eastern Canada': [
    'tremblant', 'blue'
  ],
  'Australia': [
    'perisher', 'fallscreek', 'hotham'
  ]
};

/**
 * Get region for a resort key
 * @param {string} resortKey
 * @returns {string|null} Region name or null if not found
 */
function getRegion(resortKey) {
  for (const [region, resorts] of Object.entries(REGIONS)) {
    if (resorts.includes(resortKey)) {
      return region;
    }
  }
  return null;
}

/**
 * Get all resort keys for a region
 * @param {string} region
 * @returns {string[]} Array of resort keys
 */
function getResortsInRegion(region) {
  return REGIONS[region] || [];
}

/**
 * Get all region names
 * @returns {string[]}
 */
function getAllRegions() {
  return Object.keys(REGIONS);
}

module.exports = {
  REGIONS,
  getRegion,
  getResortsInRegion,
  getAllRegions
};
