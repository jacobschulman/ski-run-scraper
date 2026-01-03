const fs = require('fs');
const path = require('path');
const { generateMorningBrief } = require('./prose/prose-generator');

/**
 * Generate daily morning brief for a resort
 * @param {string} resortKey - Resort key (e.g., 'keystone')
 * @param {string} todayDate - Today's date (YYYY-MM-DD)
 * @param {object} config - Configuration object
 * @param {object} RESORTS - Resort definitions
 * @returns {object} Brief object with rawData and computedInsights
 */
function generateBrief(resortKey, todayDate, config, RESORTS) {
  const brief = {
    resort: resortKey,
    resortName: RESORTS[resortKey]?.name || resortKey,
    date: todayDate,
    generated: new Date().toISOString(),
    rawData: {},
    computedInsights: {
      flags: {},
      alerts: [],
      trends: [],
      recommendations: []
    },
    morningBrief: null,
    errors: []
  };

  // Calculate yesterday's date
  const yesterdayDate = getYesterdayDate(todayDate);

  // Load data files
  const todayTerrain = loadTerrainData(resortKey, todayDate);
  const yesterdayTerrain = loadTerrainData(resortKey, yesterdayDate);
  const todaySnow = loadSnowData(resortKey, todayDate);
  const yesterdaySnow = loadSnowData(resortKey, yesterdayDate);
  const liftsYesterdayPath = path.join('data', resortKey, 'lifts', `${yesterdayDate}.ndjson`);

  // Generate snow comparison
  try {
    const snowData = compareSnow(todaySnow, yesterdaySnow);
    if (snowData) {
      brief.rawData.snow = snowData;
    }
  } catch (error) {
    brief.errors.push(`Snow comparison failed: ${error.message}`);
  }

  // Generate terrain comparison
  try {
    const terrainData = compareTerrain(todayTerrain, yesterdayTerrain);
    if (terrainData) {
      brief.rawData.terrain = terrainData;
    }
  } catch (error) {
    brief.errors.push(`Terrain comparison failed: ${error.message}`);
  }

  // Generate lift insights
  try {
    const liftData = analyzeLiftData(liftsYesterdayPath, yesterdayDate);
    if (liftData) {
      brief.rawData.lifts = liftData;
    }
  } catch (error) {
    brief.errors.push(`Lift analysis failed: ${error.message}`);
  }

  // Extract forecast
  try {
    const forecastData = extractForecast(todaySnow);
    if (forecastData) {
      brief.rawData.forecast = forecastData;
    }
  } catch (error) {
    brief.errors.push(`Forecast extraction failed: ${error.message}`);
  }

  // Calculate insights
  try {
    const insights = calculateInsights(brief.rawData);
    brief.computedInsights = insights;
  } catch (error) {
    brief.errors.push(`Insights calculation failed: ${error.message}`);
  }

  // Generate morning brief prose (only if we have terrain + snow data)
  if (brief.rawData.terrain && brief.rawData.snow) {
    try {
      brief.morningBrief = generateMorningBrief(brief.rawData, brief.computedInsights, {
        resortKey: resortKey,
        resortName: brief.resortName,
        date: brief.date
      });
    } catch (error) {
      brief.errors.push(`Prose generation failed: ${error.message}`);
      brief.morningBrief = {
        headline: 'Your Morning Mountain Brief',
        body: 'Conditions summary unavailable.'
      };
    }
  }

  return brief;
}

/**
 * Compare today's and yesterday's snow data
 */
function compareSnow(today, yesterday) {
  if (!today) return null;

  const result = {
    overnight_inches: today.snowfall?.overnight_inches || 0,
    overnight_cm: today.snowfall?.overnight_cm || 0,
    '24hour_inches': today.snowfall?.['24hour_inches'] || 0,
    '24hour_cm': today.snowfall?.['24hour_cm'] || 0,
    '48hour_inches': today.snowfall?.['48hour_inches'] || 0,
    '48hour_cm': today.snowfall?.['48hour_cm'] || 0,
    '7day_inches': today.snowfall?.['7day_inches'] || 0,
    '7day_cm': today.snowfall?.['7day_cm'] || 0,
    season_total_inches: today.snowfall?.season_total_inches || 0,
    season_total_cm: today.snowfall?.season_total_cm || 0,
    conditions: {
      today: today.conditions || 'Unknown',
      yesterday: yesterday?.conditions || null
    }
  };

  return result;
}

/**
 * Compare today's and yesterday's terrain data
 */
function compareTerrain(today, yesterday) {
  if (!today || !today.GroomingAreas) return null;

  const todayTrails = flattenTrails(today.GroomingAreas);
  const yesterdayTrails = yesterday ? flattenTrails(yesterday.GroomingAreas) : [];

  // Find trail changes
  const changes = findTrailChanges(todayTrails, yesterdayTrails);

  // Calculate stats
  const todayOpen = todayTrails.filter(t => t.IsOpen).length;
  const yesterdayOpen = yesterdayTrails.filter(t => t.IsOpen).length;
  const todayGroomed = todayTrails.filter(t => t.IsGroomed && t.IsOpen).length;
  const yesterdayGroomed = yesterdayTrails.filter(t => t.IsGroomed && t.IsOpen).length;

  const result = {
    stats: {
      openTrails: {
        today: todayOpen,
        yesterday: yesterdayOpen,
        delta: todayOpen - yesterdayOpen
      },
      groomedTrails: {
        today: todayGroomed,
        yesterday: yesterdayGroomed,
        delta: todayGroomed - yesterdayGroomed
      },
      totalTrails: todayTrails.length
    },
    newlyOpened: changes.opening.map(formatTrailInfo),
    newlyClosed: changes.closing.map(formatTrailInfo),
    newlyGroomed: changes.newlyGroomed.map(formatTrailInfo),
    ungroomed: changes.lostGrooming.map(formatTrailInfo)
  };

  return result;
}

/**
 * Analyze lift wait time data from yesterday
 */
function analyzeLiftData(ndjsonPath, date) {
  if (!fs.existsSync(ndjsonPath)) {
    return { available: false };
  }

  const lines = fs.readFileSync(ndjsonPath, 'utf8')
    .split('\n')
    .filter(l => l.trim());

  if (lines.length === 0) {
    return { available: false };
  }

  const records = lines.map(line => {
    try {
      return JSON.parse(line);
    } catch (e) {
      return null;
    }
  }).filter(r => r !== null);

  // Group by lift name
  const liftStats = {};
  records.forEach(record => {
    if (!liftStats[record.name]) {
      liftStats[record.name] = {
        waits: [],
        type: record.type || 'unknown',
        mountain: record.mountain || 'unknown'
      };
    }
    if (record.waitMinutes !== null && record.waitMinutes > 0) {
      liftStats[record.name].waits.push(record.waitMinutes);
    }
  });

  // Calculate averages and find busiest
  const busiest = Object.entries(liftStats)
    .map(([name, data]) => ({
      name,
      avgWait: data.waits.length > 0
        ? Math.round(data.waits.reduce((a, b) => a + b, 0) / data.waits.length * 10) / 10
        : 0,
      peakWait: data.waits.length > 0 ? Math.max(...data.waits) : 0,
      type: data.type,
      mountain: data.mountain
    }))
    .filter(l => l.avgWait > 0)
    .sort((a, b) => b.avgWait - a.avgWait)
    .slice(0, 5);

  const allWaits = Object.values(liftStats)
    .flatMap(l => l.waits);

  return {
    available: true,
    yesterday: {
      date: date,
      avgWaitTime: allWaits.length > 0
        ? Math.round(allWaits.reduce((a, b) => a + b, 0) / allWaits.length * 10) / 10
        : 0,
      maxWaitTime: allWaits.length > 0 ? Math.max(...allWaits) : 0,
      totalLiftsTracked: Object.keys(liftStats).length,
      busiest
    }
  };
}

/**
 * Extract forecast data from snow report
 */
function extractForecast(snowData) {
  if (!snowData || !snowData.forecast || !snowData.forecast.locations || snowData.forecast.locations.length === 0) {
    return null;
  }

  const location = snowData.forecast.locations[0];
  const today = location.today || {};
  const forecastDays = location.forecast_days || [];

  const result = {
    today: {
      date: today.date || snowData.date,
      high_f: today.high_f,
      low_f: today.low_f,
      high_c: today.high_c,
      low_c: today.low_c,
      description: today.description || 'Unknown',
      snowfall_day_inches: today.snowfall_day_inches || 0,
      snowfall_night_inches: today.snowfall_night_inches || 0
    },
    outlook: forecastDays.slice(1, 4).map(day => ({
      date: day.date,
      high_f: day.high_f,
      low_f: day.low_f,
      high_c: day.high_c,
      low_c: day.low_c,
      description: day.description || 'Unknown',
      snowfall_day_inches: day.snowfall_day_inches || 0,
      snowfall_night_inches: day.snowfall_night_inches || 0,
      snowfall_expected: (day.snowfall_day_inches || 0) + (day.snowfall_night_inches || 0)
    }))
  };

  // Add tomorrow if available
  if (forecastDays.length > 1) {
    const tomorrow = forecastDays[1];
    result.tomorrow = {
      date: tomorrow.date,
      high_f: tomorrow.high_f,
      low_f: tomorrow.low_f,
      high_c: tomorrow.high_c,
      low_c: tomorrow.low_c,
      description: tomorrow.description || 'Unknown',
      snowfall_day_inches: tomorrow.snowfall_day_inches || 0,
      snowfall_night_inches: tomorrow.snowfall_night_inches || 0,
      snowfall_expected: (tomorrow.snowfall_day_inches || 0) + (tomorrow.snowfall_night_inches || 0)
    };
  }

  return result;
}

/**
 * Calculate insights from raw data
 */
function calculateInsights(rawData) {
  const insights = {
    flags: {},
    alerts: [],
    trends: [],
    recommendations: []
  };

  // Snow insights
  if (rawData.snow) {
    const snow = rawData.snow;

    // Flags
    insights.flags.hasFreshSnow = snow.overnight_inches >= 1;
    insights.flags.isPowderDay = snow['24hour_inches'] >= 6;

    // Alerts
    if (snow.overnight_inches >= 2) {
      insights.alerts.push(`${snow.overnight_inches}" fresh snow overnight`);
    } else if (snow.overnight_inches >= 1) {
      insights.alerts.push(`${snow.overnight_inches}" new snow overnight`);
    }

    if (snow['24hour_inches'] >= 6) {
      insights.alerts.push(`${snow['24hour_inches']}" in last 24 hours - powder day!`);
    }

    // Trends
    if (snow['7day_inches'] >= 12) {
      insights.trends.push(`Great week for snow - ${snow['7day_inches']}" in last 7 days`);
    } else if (snow['7day_inches'] >= 6) {
      insights.trends.push(`Steady snowfall - ${snow['7day_inches']}" in last 7 days`);
    }
  }

  // Terrain insights
  if (rawData.terrain) {
    const terrain = rawData.terrain;

    // Flags
    insights.flags.hasNewTrails = terrain.newlyOpened.length > 0;
    insights.flags.significantGroomingIncrease = false;

    if (terrain.stats.groomedTrails.yesterday > 0) {
      const groomingIncrease = (terrain.stats.groomedTrails.delta / terrain.stats.groomedTrails.yesterday) * 100;
      insights.flags.significantGroomingIncrease = groomingIncrease >= 20;
    }

    // Alerts
    if (terrain.newlyOpened.length > 0) {
      const trailWord = terrain.newlyOpened.length === 1 ? 'trail' : 'trails';
      insights.alerts.push(`${terrain.newlyOpened.length} new ${trailWord} opened today`);
    }

    if (terrain.newlyGroomed.length > 0) {
      const groomedTrailWord = terrain.newlyGroomed.length === 1 ? 'trail' : 'trails';
      insights.alerts.push(`${terrain.newlyGroomed.length} ${groomedTrailWord} freshly groomed`);
    }

    // Trends
    if (terrain.stats.groomedTrails.delta > 0 && terrain.stats.groomedTrails.yesterday > 0) {
      const pct = Math.round((terrain.stats.groomedTrails.delta / terrain.stats.groomedTrails.yesterday) * 100);
      if (pct >= 20) {
        insights.trends.push(`Grooming increased ${pct}% from yesterday`);
      }
    }

    if (terrain.stats.openTrails.delta > 0) {
      const deltaTrailWord = terrain.stats.openTrails.delta === 1 ? 'trail' : 'trails';
      insights.trends.push(`${terrain.stats.openTrails.delta} more ${deltaTrailWord} open than yesterday`);
    }

    // Recommendations - highlight a few notable groomed trails
    terrain.newlyGroomed.slice(0, 3).forEach(trail => {
      const diffDesc = getDifficultyDescription(trail.difficulty);
      insights.recommendations.push(`Fresh corduroy on ${trail.name} - ${diffDesc}`);
    });
  }

  // Lift insights
  if (rawData.lifts && rawData.lifts.available) {
    const lifts = rawData.lifts.yesterday;

    // Flags
    insights.flags.highLiftDemand = lifts.avgWaitTime > 10;

    // Trends
    if (lifts.avgWaitTime > 10) {
      insights.trends.push(`High demand yesterday - average wait time ${lifts.avgWaitTime} min`);
    }

    // Recommendations
    if (lifts.busiest.length > 0) {
      const busiest = lifts.busiest[0];
      if (busiest.avgWait > 10) {
        insights.recommendations.push(`${busiest.name} had longest waits (${busiest.avgWait} min avg) - consider alternatives`);
      }
    }
  }

  // Forecast insights
  if (rawData.forecast && rawData.forecast.outlook) {
    const upcomingSnow = rawData.forecast.outlook.filter(day => day.snowfall_expected > 0);
    if (upcomingSnow.length > 0) {
      const nextSnow = upcomingSnow[0];
      const date = new Date(nextSnow.date);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
      insights.trends.push(`${nextSnow.snowfall_expected}" snow expected ${dayName}`);
    }
  }

  return insights;
}

/**
 * Helper: Flatten trails from grooming areas
 */
function flattenTrails(groomingAreas) {
  const trails = [];
  groomingAreas.forEach(area => {
    if (area.Trails) {
      area.Trails.forEach(trail => {
        trails.push({
          ...trail,
          Area: area.Name
        });
      });
    }
  });
  return trails;
}

/**
 * Helper: Find trail changes between today and yesterday
 */
function findTrailChanges(todayTrails, yesterdayTrails) {
  const todayMap = new Map(todayTrails.map(t => [t.Name, t]));
  const yesterdayMap = new Map(yesterdayTrails.map(t => [t.Name, t]));

  const opening = [];
  const closing = [];
  const newlyGroomed = [];
  const lostGrooming = [];

  todayMap.forEach((today, name) => {
    const yesterday = yesterdayMap.get(name);
    if (!yesterday) return; // Trail doesn't exist in yesterday's data

    if (!yesterday.IsOpen && today.IsOpen) {
      opening.push(today);
    }
    if (yesterday.IsOpen && !today.IsOpen) {
      closing.push(today);
    }
    if (!yesterday.IsGroomed && today.IsGroomed && today.IsOpen) {
      newlyGroomed.push(today);
    }
    if (yesterday.IsGroomed && !today.IsGroomed && today.IsOpen) {
      lostGrooming.push(today);
    }
  });

  return { opening, closing, newlyGroomed, lostGrooming };
}

/**
 * Helper: Format trail info for output
 */
function formatTrailInfo(trail) {
  return {
    name: trail.Name,
    difficulty: trail.Difficulty,
    area: trail.Area
  };
}

/**
 * Helper: Get difficulty description
 */
function getDifficultyDescription(difficulty) {
  const descriptions = {
    'Green': 'great for beginners',
    'Blue': 'perfect for intermediate skiers',
    'Black': 'challenging for advanced skiers',
    'DoubleBlack': 'expert terrain only'
  };
  return descriptions[difficulty] || 'all skill levels';
}

/**
 * Helper: Load terrain data for a date
 */
function loadTerrainData(resortKey, date) {
  const filePath = path.join('data', resortKey, 'terrain', `${date}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

/**
 * Helper: Load snow data for a date
 */
function loadSnowData(resortKey, date) {
  const filePath = path.join('data', resortKey, 'snow', `${date}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

/**
 * Helper: Get yesterday's date
 */
function getYesterdayDate(dateString) {
  const date = new Date(dateString);
  date.setDate(date.getDate() - 1);
  return date.toISOString().split('T')[0];
}

/**
 * Helper: Ensure directory exists
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

module.exports = {
  generateBrief,
  compareSnow,
  compareTerrain,
  analyzeLiftData,
  extractForecast,
  calculateInsights,
  ensureDirectoryExists
};
