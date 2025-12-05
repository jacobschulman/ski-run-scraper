/**
 * Morning Brief Prose Generation Rules
 *
 * Each rule has:
 * - id: unique identifier
 * - category: snow | weather | terrain | lifts
 * - priority: 0-100 (higher = more important for headline selection)
 * - condition: function(rawData, computedInsights) => boolean
 * - headlineTemplate: optional template for headline
 * - bodyFragmentTemplate: optional template for body text
 * - fragmentOrder: order within category for body assembly
 */

const rules = [
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
    headlineTemplate: 'Powder Day Alert!',
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
    headlineTemplate: 'Fresh Coat on the Mountain',
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
    headlineTemplate: 'Soft Snow Holding Strong',
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
    headlineTemplate: null,
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
    headlineTemplate: 'Terrain is Expanding',
    bodyFragmentTemplate: 'Terrain is expanding with {newTrailsCount} new trails opening up more room to roam.',
    fragmentOrder: 1
  },

  {
    id: 'terrain_newly_groomed',
    category: 'terrain',
    priority: 70,
    condition: (rawData, insights) => {
      return rawData.terrain?.newlyGroomed?.length > 5;
    },
    headlineTemplate: null,
    bodyFragmentTemplate: '{groomedCount} runs were freshly groomed overnight, with smooth corduroy calling in {zones}.',
    fragmentOrder: 1
  },

  {
    id: 'terrain_grooming_boost',
    category: 'terrain',
    priority: 75,
    condition: (rawData, insights) => {
      return insights.flags?.significantGroomingIncrease === true;
    },
    headlineTemplate: null,
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
    headlineTemplate: null,
    bodyFragmentTemplate: '{newTrailsCount} trails opened today expanding access to fresh terrain.',
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
    headlineTemplate: null,
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
    headlineTemplate: null,
    bodyFragmentTemplate: 'Watch for crowds at {busiestLift}, which peaked around {maxWait} minutes yesterday.',
    fragmentOrder: 1
  },

  // ============================================================================
  // WEATHER RULES
  // ============================================================================

  {
    id: 'weather_bluebird_cold',
    category: 'weather',
    priority: 70,
    condition: (rawData, insights) => {
      const desc = rawData.forecast?.today?.description || '';
      const temp = rawData.forecast?.today?.high_f || 999;
      return (desc.toLowerCase().includes('clear') ||
              desc.toLowerCase().includes('sunny') ||
              desc.toLowerCase().includes('blue')) &&
             temp <= 25;
    },
    headlineTemplate: null,
    bodyFragmentTemplate: 'Bluebird conditions with a high around {tempHigh}°, so bundle up for crisp turns.',
    fragmentOrder: 1
  },

  {
    id: 'weather_storm_incoming',
    category: 'weather',
    priority: 90,
    condition: (rawData, insights) => {
      // Check if snow is expected in the next 2-3 days
      const outlook = rawData.forecast?.outlook || [];
      return outlook.some(day => (day.snowfall_expected || 0) > 0);
    },
    headlineTemplate: 'Storm on the Horizon',
    bodyFragmentTemplate: 'A storm is lining up, so expect conditions to evolve through the day.',
    fragmentOrder: 1
  },

  {
    id: 'weather_spring_vibes',
    category: 'weather',
    priority: 50,
    condition: (rawData, insights) => {
      const desc = rawData.forecast?.today?.description || '';
      const temp = rawData.forecast?.today?.high_f || 0;
      return temp >= 35 &&
             (desc.toLowerCase().includes('clear') ||
              desc.toLowerCase().includes('sunny') ||
              desc.toLowerCase().includes('partly'));
    },
    headlineTemplate: null,
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
    headlineTemplate: null,
    bodyFragmentTemplate: 'Snow expected today or tomorrow with conditions continuing to improve.',
    fragmentOrder: 2
  },

  // ============================================================================
  // FALLBACK RULES (low priority, always fire)
  // ============================================================================

  {
    id: 'fallback_default',
    category: 'snow',
    priority: 10,
    condition: (rawData, insights) => {
      // Always true - this is our fallback
      return true;
    },
    headlineTemplate: 'Your Morning Mountain Brief',
    bodyFragmentTemplate: null,
    fragmentOrder: 99
  }
];

module.exports = { rules };
