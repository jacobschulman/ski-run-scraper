/**
 * Morning Brief Prose Generation Rules
 *
 * Each rule has:
 * - id: unique identifier
 * - category: snow | weather | terrain | lifts | time
 * - priority: 0-100 (higher = more important for headline selection)
 * - condition: function(rawData, computedInsights, context) => boolean
 * - headlineCondition: key in headlines.json (if rule can generate headline)
 * - bodyFragmentTemplate: optional template for body text
 * - fragmentOrder: order within category for body assembly
 *
 * Headlines are now pulled from headlines.json with multiple variations per condition.
 * The headlineCondition field links a rule to its headline variations.
 */

const rules = [
  // ============================================================================
  // RESORT CLOSED - No trails open (highest priority)
  // ============================================================================

  {
    id: 'resort_closed',
    category: 'terrain',
    priority: 95,
    condition: (rawData, insights) => {
      const openTrails = rawData.terrain?.stats?.openTrails?.today || 0;
      return openTrails === 0;
    },
    headlineCondition: 'resort_closed',
    bodyFragmentTemplate: null, // Use body from brief_copy.json
    fragmentOrder: 1
  },

  // ============================================================================
  // SNOW RULES (highest priority for headlines)
  // ============================================================================

  {
    id: 'snow_powder_alert',
    category: 'snow',
    priority: 100,
    condition: (rawData, insights) => {
      return rawData.snow && rawData.snow['24hour_inches'] >= 6;
    },
    headlineCondition: 'powder_alert',
    bodyFragmentTemplate: 'Powder alert with {snow24h}" of fresh overnight and soft conditions across the hill.',
    fragmentOrder: 1
  },

  {
    id: 'snow_fresh_coat',
    category: 'snow',
    priority: 80,
    condition: (rawData, insights) => {
      const snow24h = rawData.snow?.['24hour_inches'] || 0;
      return snow24h >= 1 && snow24h < 6;
    },
    headlineCondition: 'fresh_coat',
    bodyFragmentTemplate: 'A light refresh of {snow24h}" makes groomers smoother and off-piste a bit softer.',
    fragmentOrder: 1
  },

  {
    id: 'snow_holding_strong',
    category: 'snow',
    priority: 60,
    condition: (rawData, insights) => {
      const snow24h = rawData.snow?.['24hour_inches'] || 0;
      const snow7day = rawData.snow?.['7day_inches'] || 0;
      return snow24h === 0 && snow7day >= 12;
    },
    headlineCondition: 'holding_strong',
    bodyFragmentTemplate: 'No fresh overnight, but {snow7day}" in the past week is keeping things lively.',
    fragmentOrder: 1
  },

  {
    id: 'snow_week_total',
    category: 'snow',
    priority: 40,
    condition: (rawData, insights) => {
      const snow7day = rawData.snow?.['7day_inches'] || 0;
      return snow7day >= 6 && snow7day < 12;
    },
    headlineCondition: null,
    bodyFragmentTemplate: 'Steady snowfall with {snow7day}" over the last week.',
    fragmentOrder: 2
  },

  // ============================================================================
  // TERRAIN RULES
  // ============================================================================

  {
    id: 'terrain_expansion',
    category: 'terrain',
    priority: 85,
    condition: (rawData, insights) => {
      return rawData.terrain?.stats?.openTrails?.delta > 0;
    },
    headlineCondition: 'terrain_expansion',
    bodyFragmentTemplate: 'Terrain is expanding with {newTrailsCount} new {newTrailWord} opening up more room to roam.',
    fragmentOrder: 1
  },

  {
    id: 'terrain_grooming_highlight',
    category: 'terrain',
    priority: 72,
    condition: (rawData, insights) => {
      return rawData.terrain?.newlyGroomed?.length >= 10;
    },
    headlineCondition: 'grooming_highlight',
    bodyFragmentTemplate: '{groomedCount} {groomedRunWord} {groomedWere} freshly groomed overnight, with smooth corduroy calling in {zones}.',
    fragmentOrder: 1
  },

  {
    id: 'terrain_newly_groomed',
    category: 'terrain',
    priority: 70,
    condition: (rawData, insights) => {
      const count = rawData.terrain?.newlyGroomed?.length || 0;
      return count > 5 && count < 10;
    },
    headlineCondition: null,
    bodyFragmentTemplate: '{groomedCount} {groomedRunWord} {groomedWere} freshly groomed overnight, with smooth corduroy calling in {zones}.',
    fragmentOrder: 1
  },

  {
    id: 'terrain_grooming_boost',
    category: 'terrain',
    priority: 75,
    condition: (rawData, insights) => {
      return insights.flags?.significantGroomingIncrease === true;
    },
    headlineCondition: null,
    bodyFragmentTemplate: 'Grooming crews stepped it up with noticeably broader coverage on key routes.',
    fragmentOrder: 2
  },

  {
    id: 'terrain_new_trails_opened',
    category: 'terrain',
    priority: 65,
    condition: (rawData, insights) => {
      return rawData.terrain?.newlyOpened?.length > 0 && rawData.terrain?.newlyOpened?.length <= 3;
    },
    headlineCondition: null,
    bodyFragmentTemplate: '{newTrailsCount} {newTrailWord} opened today expanding access to fresh terrain.',
    fragmentOrder: 3
  },

  // ============================================================================
  // LIFT RULES
  // ============================================================================

  {
    id: 'lift_mellow_lines',
    category: 'lifts',
    priority: 50,
    condition: (rawData, insights) => {
      return rawData.lifts?.available &&
             rawData.lifts?.yesterday?.avgWaitTime < 4 &&
             rawData.lifts?.yesterday?.avgWaitTime > 0;
    },
    headlineCondition: null,
    bodyFragmentTemplate: 'Lift lines stayed mellow yesterday, so early laps should feel quick.',
    fragmentOrder: 1
  },

  {
    id: 'lift_watch_crowds',
    category: 'lifts',
    priority: 80,
    condition: (rawData, insights) => {
      return rawData.lifts?.available &&
             rawData.lifts?.yesterday?.maxWaitTime > 10;
    },
    headlineCondition: null,
    bodyFragmentTemplate: 'Watch for crowds at {busiestLift}, which peaked around {maxWait} minutes yesterday.',
    fragmentOrder: 1
  },

  // ============================================================================
  // WEATHER RULES
  // ============================================================================

  // Major storm: 6+ inches forecasted - this is a real storm
  {
    id: 'weather_storm_major',
    category: 'weather',
    priority: 88,
    condition: (rawData, insights) => {
      const outlook = rawData.forecast?.outlook || [];
      const totalForecasted = outlook.reduce((sum, day) => sum + (day.snowfall_expected || 0), 0);
      return totalForecasted >= 6;
    },
    headlineCondition: 'storm_major',
    bodyFragmentTemplate: 'A significant storm is building with {forecastSnowTotal}" expected over the next few days.',
    fragmentOrder: 1
  },

  // Snow coming: 2-6 inches forecasted - something to look forward to
  {
    id: 'weather_snow_coming',
    category: 'weather',
    priority: 55,
    condition: (rawData, insights) => {
      const outlook = rawData.forecast?.outlook || [];
      const totalForecasted = outlook.reduce((sum, day) => sum + (day.snowfall_expected || 0), 0);
      return totalForecasted >= 2 && totalForecasted < 6;
    },
    headlineCondition: 'snow_coming',
    bodyFragmentTemplate: 'Snow showers in the forecast with a few inches expected.',
    fragmentOrder: 1
  },

  // Flurries: <2 inches forecasted - just a mention in body, no headline
  {
    id: 'weather_flurries',
    category: 'weather',
    priority: 30,
    condition: (rawData, insights) => {
      const outlook = rawData.forecast?.outlook || [];
      const totalForecasted = outlook.reduce((sum, day) => sum + (day.snowfall_expected || 0), 0);
      return totalForecasted > 0 && totalForecasted < 2;
    },
    headlineCondition: null,
    bodyFragmentTemplate: 'Light snow possible in the forecast.',
    fragmentOrder: 2
  },

  // Bluebird day: Clear/sunny with cold temps
  {
    id: 'weather_bluebird_day',
    category: 'weather',
    priority: 70,
    condition: (rawData, insights) => {
      const desc = rawData.forecast?.today?.description || '';
      const temp = rawData.forecast?.today?.high_f || 999;
      return (desc.toLowerCase().includes('clear') ||
              desc.toLowerCase().includes('sunny') ||
              desc.toLowerCase().includes('blue')) &&
             temp <= 32 && temp > 10;
    },
    headlineCondition: 'bluebird_day',
    bodyFragmentTemplate: 'Bluebird conditions with a high around {tempHigh}°, so bundle up for crisp turns.',
    fragmentOrder: 1
  },

  // Cold snap: Very cold temps
  {
    id: 'weather_cold_snap',
    category: 'weather',
    priority: 52,
    condition: (rawData, insights) => {
      const temp = rawData.forecast?.today?.high_f || 999;
      return temp <= 10;
    },
    headlineCondition: 'cold_snap',
    bodyFragmentTemplate: 'Frigid temps with a high of only {tempHigh}° - layer up and take warming breaks.',
    fragmentOrder: 1
  },

  // Spring vibes: Warm and sunny
  {
    id: 'weather_spring_vibes',
    category: 'weather',
    priority: 50,
    condition: (rawData, insights) => {
      const desc = rawData.forecast?.today?.description || '';
      const temp = rawData.forecast?.today?.high_f || 0;
      return temp >= 40 &&
             (desc.toLowerCase().includes('clear') ||
              desc.toLowerCase().includes('sunny') ||
              desc.toLowerCase().includes('partly'));
    },
    headlineCondition: 'spring_vibes',
    bodyFragmentTemplate: 'Warmer, springy vibes with snow likely softening by afternoon.',
    fragmentOrder: 1
  },

  {
    id: 'weather_snow_today_tomorrow',
    category: 'weather',
    priority: 85,
    condition: (rawData, insights) => {
      const todaySnow = rawData.forecast?.today?.snowfall_day_inches || 0;
      const tomorrowSnow = rawData.forecast?.tomorrow?.snowfall_expected || 0;
      return todaySnow > 0 || tomorrowSnow > 0;
    },
    headlineCondition: null,
    bodyFragmentTemplate: 'Snow expected today or tomorrow with conditions continuing to improve.',
    fragmentOrder: 2
  },

  // ============================================================================
  // TIME-BASED RULES (day of week)
  // ============================================================================

  {
    id: 'time_weekend_kickoff',
    category: 'time',
    priority: 65,
    condition: (rawData, insights, context) => {
      const dayOfWeek = context?.dayOfWeek || '';
      const openTrails = rawData.terrain?.stats?.openTrails?.today || 0;
      // Only fire if resort is open AND it's Friday
      return openTrails > 0 && dayOfWeek === 'Friday';
    },
    headlineCondition: 'weekend_kickoff',
    bodyFragmentTemplate: null,
    fragmentOrder: 99
  },

  {
    id: 'time_midweek_mellow',
    category: 'time',
    priority: 45,
    condition: (rawData, insights, context) => {
      const dayOfWeek = context?.dayOfWeek || '';
      const openTrails = rawData.terrain?.stats?.openTrails?.today || 0;
      // Only fire if resort is open AND it's a midweek day
      return openTrails > 0 && ['Tuesday', 'Wednesday', 'Thursday'].includes(dayOfWeek);
    },
    headlineCondition: 'midweek_mellow',
    bodyFragmentTemplate: null,
    fragmentOrder: 99
  },

  // ============================================================================
  // FALLBACK RULES (low priority, always fire)
  // ============================================================================

  {
    id: 'fallback_headline',
    category: 'snow',
    priority: 10,
    condition: (rawData, insights) => {
      // Always true - this is our fallback for headline
      return true;
    },
    headlineCondition: 'fallback',
    bodyFragmentTemplate: null,
    fragmentOrder: 99
  },

  {
    id: 'fallback_body',
    category: 'weather',
    priority: 5,
    condition: (rawData, insights) => {
      // Only fire when nothing notable is happening AND resort is actually open
      const openTrails = rawData.terrain?.stats?.openTrails?.today || 0;
      const snow24h = rawData.snow?.['24hour_inches'] || 0;
      const snow7day = rawData.snow?.['7day_inches'] || 0;
      const hasTerrainChanges = (rawData.terrain?.stats?.openTrails?.delta || 0) > 0;
      const hasGrooming = (rawData.terrain?.newlyGroomed?.length || 0) > 5;
      const hasLiftData = rawData.lifts?.available && rawData.lifts?.yesterday?.avgWaitTime > 0;

      // Don't fire if resort is closed (resort_closed handles that case)
      if (openTrails === 0) return false;

      // If none of the notable conditions are true, fire the fallback
      return snow24h === 0 && snow7day < 6 && !hasTerrainChanges && !hasGrooming && !hasLiftData;
    },
    headlineCondition: null,
    bodyFragmentTemplate: '{openTrails} of {totalTrails} {openTrailWord} {openTrailsAre} open with {groomedTrails} groomed. {weatherToday} with a high of {tempHigh}°F.',
    fragmentOrder: 99
  }
];

module.exports = { rules };
