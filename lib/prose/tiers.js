/**
 * Tiered Thresholds for Morning Brief Generation
 *
 * Centralized configuration for magnitude-aware conditions.
 * This prevents "The Map Just Got Bigger" for 1 trail and
 * ensures appropriate excitement levels for different scenarios.
 */

const SNOW_TIERS = {
  historic: { min: 36, priority: 100, label: 'historic' },      // 36"+ - once in a season
  epic: { min: 18, max: 35, priority: 98, label: 'epic' },      // 18-35" - career day
  deep: { min: 12, max: 17, priority: 95, label: 'deep' },      // 12-17" - powder emergency
  powder: { min: 6, max: 11, priority: 90, label: 'powder' },   // 6-11" - classic powder day
  solid: { min: 3, max: 5, priority: 82, label: 'solid' },      // 3-5" - solid refresh
  dusting: { min: 1, max: 2, priority: 70, label: 'dusting' },  // 1-2" - light dusting
};

const TERRAIN_TIERS = {
  massive: { min: 25, priority: 95, label: 'massive' },         // 25+ trails - massive expansion
  major: { min: 15, max: 24, priority: 88, label: 'major' },    // 15-24 trails - major terrain drop
  expanding: { min: 6, max: 14, priority: 75, label: 'expanding' }, // 6-14 trails - solid expansion
  few: { min: 3, max: 5, priority: 60, label: 'few' },          // 3-5 trails - a few more options
  micro: { min: 1, max: 2, priority: 45, label: 'micro' },      // 1-2 trails - mention by name
};

const TEMP_TIERS = {
  arctic: { max: 0, priority: 85, label: 'arctic' },            // 0°F or below - dangerous cold
  frigid: { min: 1, max: 10, priority: 73, label: 'frigid' },   // 1-10°F - very cold
  cold: { min: 11, max: 20, priority: 55, label: 'cold' },      // 11-20°F - cold but normal
  chilly: { min: 21, max: 32, priority: 35, label: 'chilly' },  // 21-32°F - typical ski weather
  mild: { min: 33, max: 44, priority: 25, label: 'mild' },      // 33-44°F - mild
  warm: { min: 45, priority: 55, label: 'warm' },               // 45°F+ - warm (context matters)
};

const GROOMING_TIERS = {
  massive: { min: 25, priority: 78, label: 'massive' },         // 25+ trails groomed
  excellent: { min: 15, max: 24, priority: 72, label: 'excellent' }, // 15-24 trails
  good: { min: 10, max: 14, priority: 68, label: 'good' },      // 10-14 trails
  moderate: { min: 5, max: 9, priority: 55, label: 'moderate' }, // 5-9 trails
  light: { min: 1, max: 4, priority: 40, label: 'light' },      // 1-4 trails
};

const LIFT_WAIT_TIERS = {
  extreme: { min: 30, priority: 85, label: 'extreme' },         // 30+ min - major crowds
  busy: { min: 15, max: 29, priority: 75, label: 'busy' },      // 15-29 min - busy
  moderate: { min: 8, max: 14, priority: 60, label: 'moderate' }, // 8-14 min - moderate
  light: { min: 4, max: 7, priority: 45, label: 'light' },      // 4-7 min - light
  minimal: { min: 0, max: 3, priority: 30, label: 'minimal' },  // 0-3 min - minimal
};

const FORECAST_TIERS = {
  major_storm: { min: 12, priority: 92, label: 'major_storm' }, // 12"+ coming
  storm: { min: 6, max: 11, priority: 85, label: 'storm' },     // 6-11" coming
  snow_coming: { min: 3, max: 5, priority: 55, label: 'snow_coming' }, // 3-5" coming
  flurries: { min: 1, max: 2, priority: 30, label: 'flurries' }, // 1-2" coming
};

const PERCENT_OPEN_TIERS = {
  full: { min: 95, priority: 45, label: 'full' },               // 95%+ - full mountain
  near_full: { min: 80, max: 94, priority: 35, label: 'near_full' }, // 80-94%
  good: { min: 50, max: 79, priority: 25, label: 'good' },      // 50-79%
  limited: { min: 30, max: 49, priority: 20, label: 'limited' }, // 30-49%
  early: { min: 0, max: 29, priority: 15, label: 'early' },     // <30% - early season
};

/**
 * Get the tier for a given value
 * @param {object} tiers - The tier configuration object
 * @param {number} value - The value to check
 * @returns {object|null} The matching tier or null
 */
function getTier(tiers, value) {
  if (value === null || value === undefined || isNaN(value)) {
    return null;
  }

  for (const [key, tier] of Object.entries(tiers)) {
    const minMatch = tier.min === undefined || value >= tier.min;
    const maxMatch = tier.max === undefined || value <= tier.max;
    if (minMatch && maxMatch) {
      return { key, ...tier };
    }
  }
  return null;
}

/**
 * Get snow tier based on 24-hour snowfall
 */
function getSnowTier(snow24h) {
  return getTier(SNOW_TIERS, snow24h);
}

/**
 * Get terrain tier based on delta (new trails opened)
 */
function getTerrainTier(delta) {
  return getTier(TERRAIN_TIERS, delta);
}

/**
 * Get temperature tier based on high temp
 */
function getTempTier(highF) {
  return getTier(TEMP_TIERS, highF);
}

/**
 * Get grooming tier based on newly groomed count
 */
function getGroomingTier(groomedCount) {
  return getTier(GROOMING_TIERS, groomedCount);
}

/**
 * Get lift wait tier based on max wait time
 */
function getLiftWaitTier(maxWait) {
  return getTier(LIFT_WAIT_TIERS, maxWait);
}

/**
 * Get forecast tier based on total forecasted snow
 */
function getForecastTier(totalForecast) {
  return getTier(FORECAST_TIERS, totalForecast);
}

/**
 * Get percent open tier
 */
function getPercentOpenTier(percentOpen) {
  return getTier(PERCENT_OPEN_TIERS, percentOpen);
}

/**
 * Determine season phase based on date and percent open
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @param {number} percentOpen - Percentage of terrain open
 * @returns {string} 'early' | 'mid' | 'peak' | 'spring' | 'closed'
 */
function getSeasonPhase(dateStr, percentOpen) {
  if (percentOpen === 0) return 'closed';

  const date = new Date(dateStr + 'T12:00:00');
  const month = date.getMonth(); // 0-11

  // Early season: <30% open regardless of date
  if (percentOpen < 30) return 'early';

  // Spring: March-April (months 2-3) with >50% open
  if (month >= 2 && month <= 3 && percentOpen > 50) return 'spring';

  // Late spring: May (month 4)
  if (month === 4) return 'spring';

  // Peak: >90% open during Dec-Feb
  if (percentOpen >= 90 && month >= 11 || month <= 1) return 'peak';

  // Default: mid-season
  return 'mid';
}

/**
 * Check if warm temps are unseasonable (Dec-Feb with 45°F+)
 */
function isUnseasonablyWarm(dateStr, highF) {
  if (!highF || highF < 45) return false;

  const date = new Date(dateStr + 'T12:00:00');
  const month = date.getMonth();

  // December, January, February
  return month === 11 || month === 0 || month === 1;
}

/**
 * Get blocked terms for a season phase
 * These terms should NOT be used in the given season
 */
function getBlockedTerms(seasonPhase) {
  const blocked = {
    early: ['spring', 'sunscreen', 'full mountain', 'whole mountain', 'corn snow'],
    mid: ['spring', 'sunscreen', 'thaw'],
    peak: ['spring', 'sunscreen'],
    spring: ['frigid', 'arctic', 'bundle up', 'deep freeze'], // unless actually cold
    closed: []
  };
  return blocked[seasonPhase] || [];
}

module.exports = {
  SNOW_TIERS,
  TERRAIN_TIERS,
  TEMP_TIERS,
  GROOMING_TIERS,
  LIFT_WAIT_TIERS,
  FORECAST_TIERS,
  PERCENT_OPEN_TIERS,
  getTier,
  getSnowTier,
  getTerrainTier,
  getTempTier,
  getGroomingTier,
  getLiftWaitTier,
  getForecastTier,
  getPercentOpenTier,
  getSeasonPhase,
  isUnseasonablyWarm,
  getBlockedTerms
};
