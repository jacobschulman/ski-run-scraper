/**
 * Morning Brief Prose Generation Rules - v2.0
 *
 * Complete rewrite with:
 * - Tiered conditions (magnitude-aware thresholds)
 * - Holiday awareness (no "quiet" headlines on busy days)
 * - Seasonal context (no "spring vibes" in December)
 * - Weather event detection (rain, wind, mixed precip)
 * - Data quality filtering
 *
 * Each rule has:
 * - id: unique identifier
 * - category: snow | weather | terrain | lifts | time | context
 * - priority: 0-100 (higher = more important for headline selection)
 * - condition: function(rawData, computedInsights, context) => boolean
 * - headlineCondition: key in brief_copy.json (if rule can generate headline)
 * - bodyFragmentTemplate: optional template for body text
 * - fragmentOrder: order within category for body assembly
 */

const {
  getSnowTier,
  getTerrainTier,
  getTempTier,
  getGroomingTier,
  getForecastTier,
  getSeasonPhase,
  isUnseasonablyWarm
} = require('./tiers');

const {
  isHoliday,
  isBusyPeriod,
  getCrowdExpectation
} = require('./holidays');

/**
 * Helper: Get month from date string
 */
function getMonth(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr + 'T12:00:00');
  return date.getMonth(); // 0-11
}

/**
 * Helper: Calculate percent open
 */
function getPercentOpen(rawData) {
  const open = rawData.terrain?.stats?.openTrails?.today || 0;
  const total = rawData.terrain?.stats?.totalTrails || 1;
  return Math.round((open / total) * 100);
}

/**
 * Helper: Check if weather description indicates rain
 */
function hasRain(rawData) {
  const desc = (rawData.forecast?.today?.description || '').toLowerCase();
  return desc.includes('rain') && !desc.includes('snow');
}

/**
 * Helper: Check if weather description indicates mixed precip
 */
function hasMixedPrecip(rawData) {
  const desc = (rawData.forecast?.today?.description || '').toLowerCase();
  return (desc.includes('rain') && desc.includes('snow')) ||
         desc.includes('mix') ||
         desc.includes('sleet') ||
         desc.includes('freezing rain');
}

/**
 * Helper: Check if weather is windy
 */
function isWindy(rawData) {
  const desc = (rawData.forecast?.today?.description || '').toLowerCase();
  return desc.includes('wind') || desc.includes('blustery') || desc.includes('gusty');
}

/**
 * Helper: Check if weather is clear/sunny
 */
function isClearOrSunny(rawData) {
  const desc = (rawData.forecast?.today?.description || '').toLowerCase();
  return desc.includes('clear') ||
         desc.includes('sunny') ||
         desc.includes('blue') ||
         (desc.includes('partly') && !desc.includes('cloud'));
}

/**
 * Helper: Get total forecasted snow
 */
function getForecastSnowTotal(rawData) {
  const outlook = rawData.forecast?.outlook || [];
  return outlook.reduce((sum, day) => sum + (day.snowfall_expected || 0), 0);
}

/**
 * Helper: Validate lift wait data (filter bad data)
 */
function isValidLiftData(rawData) {
  const maxWait = rawData.lifts?.yesterday?.maxWaitTime || 0;
  const avgWait = rawData.lifts?.yesterday?.avgWaitTime || 0;
  // Filter obviously bad data (>120 min avg or >180 max)
  return rawData.lifts?.available && avgWait <= 120 && maxWait <= 180;
}

const rules = [
  // ============================================================================
  // LAYER 1: BLOCKERS - These override everything (highest priority)
  // ============================================================================

  // Rain warning - critical for safety/experience
  {
    id: 'weather_rain',
    category: 'weather',
    priority: 200,
    condition: (rawData) => {
      const temp = rawData.forecast?.today?.high_f;
      return hasRain(rawData) && temp !== null && temp >= 35;
    },
    headlineCondition: 'weather_rain',
    bodyFragmentTemplate: 'Rain expected today. Wet conditions likely at lower elevations.',
    fragmentOrder: 1
  },

  // Mixed precip warning
  {
    id: 'weather_mixed',
    category: 'weather',
    priority: 195,
    condition: (rawData) => hasMixedPrecip(rawData),
    headlineCondition: 'weather_mixed',
    bodyFragmentTemplate: 'Mixed precipitation expected. Rain at base, snow up top. Dress in layers.',
    fragmentOrder: 1
  },

  // ============================================================================
  // RESORT CLOSED - No trails open
  // ============================================================================

  {
    id: 'resort_closed',
    category: 'terrain',
    priority: 95,
    condition: (rawData) => {
      const openTrails = rawData.terrain?.stats?.openTrails?.today || 0;
      return openTrails === 0;
    },
    headlineCondition: 'resort_closed',
    bodyFragmentTemplate: null, // Use body from brief_copy.json
    fragmentOrder: 1
  },

  // ============================================================================
  // LAYER 2: SNOW RULES - Tiered by magnitude
  // ============================================================================

  // Historic snow: 36"+
  {
    id: 'snow_historic',
    category: 'snow',
    priority: 100,
    condition: (rawData) => {
      const snow24h = rawData.snow?.['24hour_inches'] || 0;
      const tier = getSnowTier(snow24h);
      return tier && tier.key === 'historic';
    },
    headlineCondition: 'snow_historic',
    bodyFragmentTemplate: 'HISTORIC: {snow24h}" overnight. This is a once-in-a-season event. Drop everything.',
    fragmentOrder: 1
  },

  // Epic snow: 18-35"
  {
    id: 'snow_epic',
    category: 'snow',
    priority: 98,
    condition: (rawData) => {
      const snow24h = rawData.snow?.['24hour_inches'] || 0;
      const tier = getSnowTier(snow24h);
      return tier && tier.key === 'epic';
    },
    headlineCondition: 'snow_epic',
    bodyFragmentTemplate: 'EPIC: {snow24h}" of fresh powder. Career day potential. First chair or regret it.',
    fragmentOrder: 1
  },

  // Deep snow: 12-17"
  {
    id: 'snow_deep',
    category: 'snow',
    priority: 95,
    condition: (rawData) => {
      const snow24h = rawData.snow?.['24hour_inches'] || 0;
      const tier = getSnowTier(snow24h);
      return tier && tier.key === 'deep';
    },
    headlineCondition: 'snow_deep',
    bodyFragmentTemplate: 'Deep day: {snow24h}" overnight. Stashes are loaded, groomers are buried. Time to hunt.',
    fragmentOrder: 1
  },

  // Powder day: 6-11"
  {
    id: 'snow_powder',
    category: 'snow',
    priority: 90,
    condition: (rawData) => {
      const snow24h = rawData.snow?.['24hour_inches'] || 0;
      const tier = getSnowTier(snow24h);
      return tier && tier.key === 'powder';
    },
    headlineCondition: 'powder_alert',
    bodyFragmentTemplate: 'Powder alert: {snow24h}" of fresh overnight means soft conditions across the mountain.',
    fragmentOrder: 1
  },

  // Solid refresh: 3-5"
  {
    id: 'snow_solid',
    category: 'snow',
    priority: 82,
    condition: (rawData) => {
      const snow24h = rawData.snow?.['24hour_inches'] || 0;
      const tier = getSnowTier(snow24h);
      return tier && tier.key === 'solid';
    },
    headlineCondition: 'snow_solid',
    bodyFragmentTemplate: 'Solid refresh: {snow24h}" overnight freshened up the mountain. Groomers are smooth, off-piste is soft.',
    fragmentOrder: 1
  },

  // Light dusting: 1-2"
  {
    id: 'snow_dusting',
    category: 'snow',
    priority: 70,
    condition: (rawData) => {
      const snow24h = rawData.snow?.['24hour_inches'] || 0;
      const tier = getSnowTier(snow24h);
      return tier && tier.key === 'dusting';
    },
    headlineCondition: 'fresh_coat',
    bodyFragmentTemplate: 'Light dusting of {snow24h}" overnight makes the hardpack a bit friendlier.',
    fragmentOrder: 1
  },

  // Holding strong: No new snow but good base
  {
    id: 'snow_holding_strong',
    category: 'snow',
    priority: 60,
    condition: (rawData) => {
      const snow24h = rawData.snow?.['24hour_inches'] || 0;
      const snow7day = rawData.snow?.['7day_inches'] || 0;
      return snow24h === 0 && snow7day >= 12;
    },
    headlineCondition: 'holding_strong',
    bodyFragmentTemplate: 'No fresh overnight, but {snow7day}" in the past week is keeping things lively.',
    fragmentOrder: 1
  },

  // Week total (body only)
  {
    id: 'snow_week_total',
    category: 'snow',
    priority: 40,
    condition: (rawData) => {
      const snow7day = rawData.snow?.['7day_inches'] || 0;
      return snow7day >= 6 && snow7day < 12;
    },
    headlineCondition: null,
    bodyFragmentTemplate: 'Steady snowfall with {snow7day}" over the last week.',
    fragmentOrder: 2
  },

  // ============================================================================
  // LAYER 3: TERRAIN RULES - Tiered by magnitude
  // ============================================================================

  // Massive terrain expansion: 25+ trails
  {
    id: 'terrain_massive',
    category: 'terrain',
    priority: 95,
    condition: (rawData) => {
      const delta = rawData.terrain?.stats?.openTrails?.delta || 0;
      const tier = getTerrainTier(delta);
      return tier && tier.key === 'massive';
    },
    headlineCondition: 'terrain_massive',
    bodyFragmentTemplate: 'MASSIVE expansion: {newTrailsCount} new {newTrailWord} opened. The floodgates are open.',
    fragmentOrder: 1
  },

  // Major terrain expansion: 15-24 trails
  {
    id: 'terrain_major',
    category: 'terrain',
    priority: 88,
    condition: (rawData) => {
      const delta = rawData.terrain?.stats?.openTrails?.delta || 0;
      const tier = getTerrainTier(delta);
      return tier && tier.key === 'major';
    },
    headlineCondition: 'terrain_major',
    bodyFragmentTemplate: 'Major terrain drop: {newTrailsCount} new {newTrailWord} opened overnight.',
    fragmentOrder: 1
  },

  // Solid expansion: 6-14 trails
  {
    id: 'terrain_expanding',
    category: 'terrain',
    priority: 75,
    condition: (rawData) => {
      const delta = rawData.terrain?.stats?.openTrails?.delta || 0;
      const tier = getTerrainTier(delta);
      return tier && tier.key === 'expanding';
    },
    headlineCondition: 'terrain_expansion',
    bodyFragmentTemplate: 'Terrain expanding: {newTrailsCount} new {newTrailWord} opening up more options.',
    fragmentOrder: 1
  },

  // A few more: 3-5 trails
  {
    id: 'terrain_few',
    category: 'terrain',
    priority: 60,
    condition: (rawData) => {
      const delta = rawData.terrain?.stats?.openTrails?.delta || 0;
      const tier = getTerrainTier(delta);
      return tier && tier.key === 'few';
    },
    headlineCondition: 'terrain_few',
    bodyFragmentTemplate: '{newTrailsCount} more {newTrailWord} opened today, expanding your options.',
    fragmentOrder: 1
  },

  // Micro expansion: 1-2 trails (mention by name, no dramatic headline)
  {
    id: 'terrain_micro',
    category: 'terrain',
    priority: 45,
    condition: (rawData) => {
      const delta = rawData.terrain?.stats?.openTrails?.delta || 0;
      const tier = getTerrainTier(delta);
      return tier && tier.key === 'micro';
    },
    headlineCondition: null, // No headline for 1-2 trails - use different rule
    bodyFragmentTemplate: '{newTrailsCount} new {newTrailWord} opened today.',
    fragmentOrder: 3
  },

  // ============================================================================
  // GROOMING RULES - Tiered
  // ============================================================================

  // Massive grooming: 25+ trails
  {
    id: 'grooming_massive',
    category: 'terrain',
    priority: 78,
    condition: (rawData) => {
      const count = rawData.terrain?.newlyGroomed?.length || 0;
      const tier = getGroomingTier(count);
      return tier && tier.key === 'massive';
    },
    headlineCondition: 'grooming_massive',
    bodyFragmentTemplate: 'The snow cats went hard: {groomedCount} {groomedRunWord} of fresh corduroy across {zones}.',
    fragmentOrder: 1
  },

  // Excellent grooming: 15-24 trails
  {
    id: 'grooming_excellent',
    category: 'terrain',
    priority: 72,
    condition: (rawData) => {
      const count = rawData.terrain?.newlyGroomed?.length || 0;
      const tier = getGroomingTier(count);
      return tier && tier.key === 'excellent';
    },
    headlineCondition: 'grooming_highlight',
    bodyFragmentTemplate: '{groomedCount} {groomedRunWord} {groomedWere} freshly groomed overnight. Smooth sailing in {zones}.',
    fragmentOrder: 1
  },

  // Good grooming: 10-14 trails
  {
    id: 'grooming_good',
    category: 'terrain',
    priority: 68,
    condition: (rawData) => {
      const count = rawData.terrain?.newlyGroomed?.length || 0;
      const tier = getGroomingTier(count);
      return tier && tier.key === 'good';
    },
    headlineCondition: 'grooming_highlight',
    bodyFragmentTemplate: '{groomedCount} {groomedRunWord} groomed overnight. Fresh corduroy calling in {zones}.',
    fragmentOrder: 1
  },

  // Moderate grooming: 5-9 trails (body only)
  {
    id: 'grooming_moderate',
    category: 'terrain',
    priority: 55,
    condition: (rawData) => {
      const count = rawData.terrain?.newlyGroomed?.length || 0;
      const tier = getGroomingTier(count);
      return tier && tier.key === 'moderate';
    },
    headlineCondition: null,
    bodyFragmentTemplate: '{groomedCount} {groomedRunWord} freshly groomed, mostly in {zones}.',
    fragmentOrder: 2
  },

  // ============================================================================
  // WEATHER/FORECAST RULES
  // ============================================================================

  // Major storm incoming: 12"+
  {
    id: 'forecast_major_storm',
    category: 'weather',
    priority: 92,
    condition: (rawData) => {
      const total = getForecastSnowTotal(rawData);
      const tier = getForecastTier(total);
      return tier && tier.key === 'major_storm';
    },
    headlineCondition: 'storm_major',
    bodyFragmentTemplate: 'MAJOR STORM incoming: {forecastSnowTotal}" expected over the next few days. Clear your schedule.',
    fragmentOrder: 1
  },

  // Storm incoming: 6-11"
  {
    id: 'forecast_storm',
    category: 'weather',
    priority: 85,
    condition: (rawData) => {
      const total = getForecastSnowTotal(rawData);
      const tier = getForecastTier(total);
      return tier && tier.key === 'storm';
    },
    headlineCondition: 'storm_major',
    bodyFragmentTemplate: 'Storm building with {forecastSnowTotal}" expected. Conditions about to improve.',
    fragmentOrder: 1
  },

  // Snow coming: 3-5"
  {
    id: 'forecast_snow_coming',
    category: 'weather',
    priority: 55,
    condition: (rawData) => {
      const total = getForecastSnowTotal(rawData);
      const tier = getForecastTier(total);
      return tier && tier.key === 'snow_coming';
    },
    headlineCondition: 'snow_coming',
    bodyFragmentTemplate: 'Snow showers in the forecast with a few inches expected.',
    fragmentOrder: 1
  },

  // Flurries: 1-2" (body only)
  {
    id: 'forecast_flurries',
    category: 'weather',
    priority: 30,
    condition: (rawData) => {
      const total = getForecastSnowTotal(rawData);
      const tier = getForecastTier(total);
      return tier && tier.key === 'flurries';
    },
    headlineCondition: null,
    bodyFragmentTemplate: 'Light snow possible in the forecast.',
    fragmentOrder: 2
  },

  // ============================================================================
  // TEMPERATURE RULES - Tiered with seasonal awareness
  // ============================================================================

  // Arctic cold: 0°F or below
  {
    id: 'temp_arctic',
    category: 'weather',
    priority: 85,
    condition: (rawData) => {
      const temp = rawData.forecast?.today?.high_f;
      if (temp === null || temp === undefined) return false;
      const tier = getTempTier(temp);
      return tier && tier.key === 'arctic';
    },
    headlineCondition: 'cold_arctic',
    bodyFragmentTemplate: 'ARCTIC: {tempHigh}° for a high. Extreme cold - limit exposed skin and take warming breaks.',
    fragmentOrder: 1
  },

  // Frigid: 1-10°F
  {
    id: 'temp_frigid',
    category: 'weather',
    priority: 73,
    condition: (rawData) => {
      const temp = rawData.forecast?.today?.high_f;
      if (temp === null || temp === undefined) return false;
      const tier = getTempTier(temp);
      return tier && tier.key === 'frigid';
    },
    headlineCondition: 'cold_snap',
    bodyFragmentTemplate: 'Frigid temps today: high of only {tempHigh}°. Layer up and take warming breaks.',
    fragmentOrder: 1
  },

  // Cold: 11-20°F (body only, not headline-worthy in ski season)
  {
    id: 'temp_cold',
    category: 'weather',
    priority: 55,
    condition: (rawData) => {
      const temp = rawData.forecast?.today?.high_f;
      if (temp === null || temp === undefined) return false;
      const tier = getTempTier(temp);
      return tier && tier.key === 'cold';
    },
    headlineCondition: null,
    bodyFragmentTemplate: 'Cold day ahead: {tempHigh}° high. Dress warmly.',
    fragmentOrder: 2
  },

  // Unseasonably warm: 45°F+ in Dec/Jan/Feb (NOT spring vibes!)
  {
    id: 'temp_unseasonably_warm',
    category: 'weather',
    priority: 55,
    condition: (rawData, insights, context) => {
      const temp = rawData.forecast?.today?.high_f;
      const date = context?.date;
      return temp !== null && temp !== undefined && isUnseasonablyWarm(date, temp);
    },
    headlineCondition: 'unseasonably_warm',
    bodyFragmentTemplate: 'Unseasonably warm: {tempHigh}° today. Snow may soften by afternoon.',
    fragmentOrder: 1
  },

  // True spring conditions: 45°F+ in March/April
  {
    id: 'temp_spring',
    category: 'weather',
    priority: 50,
    condition: (rawData, insights, context) => {
      const temp = rawData.forecast?.today?.high_f;
      if (temp === null || temp === undefined || temp < 45) return false;
      const month = getMonth(context?.date);
      // March (2) or April (3) only
      return month === 2 || month === 3;
    },
    headlineCondition: 'spring_vibes',
    bodyFragmentTemplate: 'Spring skiing conditions: {tempHigh}° and soft snow. Hit it early or catch the afternoon corn.',
    fragmentOrder: 1
  },

  // Bluebird day: Clear + cold
  {
    id: 'weather_bluebird',
    category: 'weather',
    priority: 70,
    condition: (rawData) => {
      const temp = rawData.forecast?.today?.high_f;
      if (temp === null || temp === undefined) return false;
      return isClearOrSunny(rawData) && temp <= 32 && temp > 10;
    },
    headlineCondition: 'bluebird_day',
    bodyFragmentTemplate: 'Bluebird conditions: {tempHigh}° and clear. Bundle up for some crisp, beautiful turns.',
    fragmentOrder: 1
  },

  // Windy (body only unless combined with snow)
  {
    id: 'weather_windy',
    category: 'weather',
    priority: 45,
    condition: (rawData) => {
      return isWindy(rawData) &&
             !rawData.forecast?.today?.description?.toLowerCase().includes('snow');
    },
    headlineCondition: null,
    bodyFragmentTemplate: 'Windy conditions expected. Upper lifts may have holds or delays.',
    fragmentOrder: 2
  },

  // Storm + wind combo
  {
    id: 'weather_storm_wind',
    category: 'weather',
    priority: 82,
    condition: (rawData) => {
      const desc = (rawData.forecast?.today?.description || '').toLowerCase();
      return desc.includes('snow') && isWindy(rawData);
    },
    headlineCondition: 'storm_wind',
    bodyFragmentTemplate: 'Active weather: snow and wind today. Visibility may be limited at times.',
    fragmentOrder: 1
  },

  // ============================================================================
  // LIFT RULES - With data quality checks
  // ============================================================================

  // Busy lifts yesterday
  {
    id: 'lift_busy',
    category: 'lifts',
    priority: 80,
    condition: (rawData) => {
      if (!isValidLiftData(rawData)) return false;
      return rawData.lifts?.yesterday?.maxWaitTime > 15;
    },
    headlineCondition: null,
    bodyFragmentTemplate: 'Heads up: {busiestLift} peaked at {maxWait} minutes yesterday. Consider alternatives.',
    fragmentOrder: 1
  },

  // Moderate lift waits
  {
    id: 'lift_moderate',
    category: 'lifts',
    priority: 60,
    condition: (rawData) => {
      if (!isValidLiftData(rawData)) return false;
      const maxWait = rawData.lifts?.yesterday?.maxWaitTime || 0;
      return maxWait > 8 && maxWait <= 15;
    },
    headlineCondition: null,
    bodyFragmentTemplate: 'Watch for crowds at {busiestLift}, which saw {maxWait}-minute waits yesterday.',
    fragmentOrder: 2
  },

  // Mellow lift lines
  {
    id: 'lift_mellow',
    category: 'lifts',
    priority: 50,
    condition: (rawData) => {
      if (!isValidLiftData(rawData)) return false;
      const avgWait = rawData.lifts?.yesterday?.avgWaitTime || 0;
      return avgWait > 0 && avgWait < 4;
    },
    headlineCondition: null,
    bodyFragmentTemplate: 'Lift lines were mellow yesterday. Expect a similar vibe today.',
    fragmentOrder: 2
  },

  // ============================================================================
  // TIME-BASED RULES - With holiday awareness
  // ============================================================================

  // Holiday crowds (overrides midweek_mellow)
  {
    id: 'time_holiday',
    category: 'time',
    priority: 70,
    condition: (rawData, insights, context) => {
      const date = context?.date;
      const openTrails = rawData.terrain?.stats?.openTrails?.today || 0;
      return openTrails > 0 && isHoliday(date);
    },
    headlineCondition: 'holiday',
    bodyFragmentTemplate: null,
    fragmentOrder: 99
  },

  // Busy period (school vacation, not a specific holiday)
  {
    id: 'time_busy_period',
    category: 'time',
    priority: 65,
    condition: (rawData, insights, context) => {
      const date = context?.date;
      const openTrails = rawData.terrain?.stats?.openTrails?.today || 0;
      // Only fire if it's a busy period but NOT a specific holiday (holiday rule is higher priority)
      return openTrails > 0 && isBusyPeriod(date) && !isHoliday(date);
    },
    headlineCondition: null, // Just body note
    bodyFragmentTemplate: null,
    fragmentOrder: 99
  },

  // Weekend kickoff (Friday only)
  {
    id: 'time_weekend_kickoff',
    category: 'time',
    priority: 52,
    condition: (rawData, insights, context) => {
      const dayOfWeek = context?.dayOfWeek || '';
      const openTrails = rawData.terrain?.stats?.openTrails?.today || 0;
      const date = context?.date;
      // Don't fire on holidays - holiday rule handles those
      return openTrails > 0 && dayOfWeek === 'Friday' && !isHoliday(date);
    },
    headlineCondition: 'weekend_kickoff',
    bodyFragmentTemplate: null,
    fragmentOrder: 99
  },

  // Saturday
  {
    id: 'time_saturday',
    category: 'time',
    priority: 38,
    condition: (rawData, insights, context) => {
      const dayOfWeek = context?.dayOfWeek || '';
      const openTrails = rawData.terrain?.stats?.openTrails?.today || 0;
      const date = context?.date;
      return openTrails > 0 && dayOfWeek === 'Saturday' && !isHoliday(date);
    },
    headlineCondition: 'saturday',
    bodyFragmentTemplate: null,
    fragmentOrder: 99
  },

  // Sunday
  {
    id: 'time_sunday',
    category: 'time',
    priority: 38,
    condition: (rawData, insights, context) => {
      const dayOfWeek = context?.dayOfWeek || '';
      const openTrails = rawData.terrain?.stats?.openTrails?.today || 0;
      const date = context?.date;
      return openTrails > 0 && dayOfWeek === 'Sunday' && !isHoliday(date);
    },
    headlineCondition: 'sunday',
    bodyFragmentTemplate: null,
    fragmentOrder: 99
  },

  // Midweek mellow (only when NOT a holiday or busy period)
  {
    id: 'time_midweek_mellow',
    category: 'time',
    priority: 45,
    condition: (rawData, insights, context) => {
      const dayOfWeek = context?.dayOfWeek || '';
      const openTrails = rawData.terrain?.stats?.openTrails?.today || 0;
      const date = context?.date;
      // Only fire if NOT a holiday/busy period
      if (isBusyPeriod(date)) return false;
      return openTrails > 0 && ['Tuesday', 'Wednesday', 'Thursday'].includes(dayOfWeek);
    },
    headlineCondition: 'midweek_mellow',
    bodyFragmentTemplate: null,
    fragmentOrder: 99
  },

  // ============================================================================
  // PERCENT OPEN MILESTONES
  // ============================================================================

  // Full mountain: 95%+
  {
    id: 'percent_full',
    category: 'terrain',
    priority: 45,
    condition: (rawData) => {
      const pct = getPercentOpen(rawData);
      return pct >= 95;
    },
    headlineCondition: 'percent_full',
    bodyFragmentTemplate: null,
    fragmentOrder: 99
  },

  // Early season: <30%
  {
    id: 'percent_early',
    category: 'context',
    priority: 15,
    condition: (rawData, insights, context) => {
      const pct = getPercentOpen(rawData);
      const openTrails = rawData.terrain?.stats?.openTrails?.today || 0;
      return openTrails > 0 && pct < 30;
    },
    headlineCondition: 'early_season',
    bodyFragmentTemplate: 'Early season conditions with {openTrails} of {totalTrails} trails open.',
    fragmentOrder: 99
  },

  // ============================================================================
  // FALLBACK RULES (lowest priority)
  // ============================================================================

  {
    id: 'fallback_headline',
    category: 'snow',
    priority: 10,
    condition: () => true,
    headlineCondition: 'fallback',
    bodyFragmentTemplate: null,
    fragmentOrder: 99
  },

  {
    id: 'fallback_body',
    category: 'weather',
    priority: 5,
    condition: (rawData) => {
      const openTrails = rawData.terrain?.stats?.openTrails?.today || 0;
      const snow24h = rawData.snow?.['24hour_inches'] || 0;
      const snow7day = rawData.snow?.['7day_inches'] || 0;
      const hasTerrainChanges = (rawData.terrain?.stats?.openTrails?.delta || 0) > 0;
      const hasGrooming = (rawData.terrain?.newlyGroomed?.length || 0) > 5;
      const hasLiftData = isValidLiftData(rawData) && rawData.lifts?.yesterday?.avgWaitTime > 0;

      // Don't fire if resort is closed
      if (openTrails === 0) return false;

      // If none of the notable conditions are true, fire the fallback
      return snow24h === 0 && snow7day < 6 && !hasTerrainChanges && !hasGrooming && !hasLiftData;
    },
    headlineCondition: null,
    bodyFragmentTemplate: '{openTrails}/{totalTrails} trails open, {groomedTrails} groomed. {tempHigh}° and {weatherToday}.',
    fragmentOrder: 99
  }
];

module.exports = { rules };
