/**
 * Morning Brief Prose Generator
 *
 * Generates natural language headlines and body text from resort data
 * using a rule-based template system.
 */

const { rules } = require('./rules');

/**
 * Generate morning brief prose (headline + body)
 *
 * @param {object} rawData - Raw data from brief (snow, terrain, lifts, forecast)
 * @param {object} computedInsights - Computed insights (flags, alerts, trends)
 * @param {object} options - Options (resortName, date)
 * @returns {object} { headline: string, body: string }
 */
function generateMorningBrief(rawData, computedInsights, options = {}) {
  // Evaluate all rules
  const firedRules = evaluateRules(rawData, computedInsights);

  // Select headline (highest priority rule with headlineTemplate)
  const headline = selectHeadline(firedRules);

  // Select body fragments (up to 3, ordered by category)
  const bodyFragments = selectBodyFragments(firedRules, 3);

  // Render templates
  const headlineText = renderTemplate(headline, rawData, computedInsights, options);
  const bodyText = bodyFragments
    .map(template => renderTemplate(template, rawData, computedInsights, options))
    .filter(text => text && text.length > 0)
    .join(' ');

  return {
    headline: headlineText,
    body: bodyText
  };
}

/**
 * Evaluate all rules and return those that fired
 *
 * @param {object} rawData - Raw data from brief
 * @param {object} computedInsights - Computed insights
 * @returns {Array} Array of fired rules
 */
function evaluateRules(rawData, computedInsights) {
  const firedRules = [];

  for (const rule of rules) {
    try {
      if (rule.condition(rawData, computedInsights)) {
        firedRules.push(rule);
      }
    } catch (error) {
      // Silently skip rules that error (e.g., due to missing data)
      console.warn(`Rule ${rule.id} failed to evaluate:`, error.message);
    }
  }

  return firedRules;
}

/**
 * Select the headline from fired rules
 * (Highest priority rule with a headlineTemplate)
 *
 * @param {Array} firedRules - Array of fired rules
 * @returns {string} Headline template
 */
function selectHeadline(firedRules) {
  // Filter to rules with headline templates
  const headlineRules = firedRules.filter(rule => rule.headlineTemplate);

  // Sort by priority (descending)
  headlineRules.sort((a, b) => b.priority - a.priority);

  // Return the highest priority headline, or default
  return headlineRules.length > 0
    ? headlineRules[0].headlineTemplate
    : 'Your Morning Mountain Brief';
}

/**
 * Select body fragments from fired rules
 * (Up to maxFragments, ordered by category and fragmentOrder)
 *
 * @param {Array} firedRules - Array of fired rules
 * @param {number} maxFragments - Maximum number of fragments to include
 * @returns {Array} Array of body fragment templates
 */
function selectBodyFragments(firedRules, maxFragments = 3) {
  // Filter to rules with body fragment templates
  const fragmentRules = firedRules.filter(rule => rule.bodyFragmentTemplate);

  // Category order for body assembly
  const categoryOrder = ['snow', 'terrain', 'lifts', 'weather'];

  // Group by category
  const byCategory = {};
  for (const rule of fragmentRules) {
    if (!byCategory[rule.category]) {
      byCategory[rule.category] = [];
    }
    byCategory[rule.category].push(rule);
  }

  // Sort within each category by fragmentOrder
  for (const category in byCategory) {
    byCategory[category].sort((a, b) => a.fragmentOrder - b.fragmentOrder);
  }

  // Assemble fragments in category order
  const fragments = [];
  for (const category of categoryOrder) {
    if (byCategory[category]) {
      for (const rule of byCategory[category]) {
        if (fragments.length < maxFragments) {
          fragments.push(rule.bodyFragmentTemplate);
        }
      }
    }
  }

  return fragments;
}

/**
 * Render a template by replacing tokens with actual values
 *
 * @param {string} template - Template string with {tokens}
 * @param {object} rawData - Raw data from brief
 * @param {object} computedInsights - Computed insights
 * @param {object} options - Options (resortName, date)
 * @returns {string} Rendered text
 */
function renderTemplate(template, rawData, computedInsights, options = {}) {
  if (!template) return '';

  let rendered = template;

  // Token mapping: {tokenName} -> value
  const tokens = {
    // Snow
    snow24h: rawData.snow?.['24hour_inches'] || 0,
    snow48h: rawData.snow?.['48hour_inches'] || 0,
    snow7day: rawData.snow?.['7day_inches'] || 0,
    snowOvernight: rawData.snow?.overnight_inches || 0,
    snowSeasonTotal: rawData.snow?.season_total_inches || 0,

    // Terrain
    openTrails: rawData.terrain?.stats?.openTrails?.today || 0,
    groomedTrails: rawData.terrain?.stats?.groomedTrails?.today || 0,
    newTrailsCount: rawData.terrain?.newlyOpened?.length || 0,
    groomedCount: rawData.terrain?.newlyGroomed?.length || 0,
    totalTrails: rawData.terrain?.stats?.totalTrails || 0,

    // Terrain zones (construct from newly groomed areas)
    zones: getGroomingZones(rawData.terrain?.newlyGroomed || []),

    // Lifts
    avgWait: rawData.lifts?.yesterday?.avgWaitTime || 0,
    maxWait: rawData.lifts?.yesterday?.maxWaitTime || 0,
    busiestLift: rawData.lifts?.yesterday?.busiest?.[0]?.name || 'N/A',

    // Weather
    tempHigh: rawData.forecast?.today?.high_f || null,
    tempLow: rawData.forecast?.today?.low_f || null,
    weatherToday: rawData.forecast?.today?.description || 'Unknown',
    weatherTomorrow: rawData.forecast?.tomorrow?.description || 'Unknown',

    // Meta
    resortName: options.resortName || 'the resort',
    date: options.date || 'today'
  };

  // Replace all tokens
  for (const [tokenName, tokenValue] of Object.entries(tokens)) {
    const regex = new RegExp(`\\{${tokenName}\\}`, 'g');
    rendered = rendered.replace(regex, String(tokenValue));
  }

  return rendered;
}

/**
 * Get a comma-separated list of grooming zones
 *
 * @param {Array} newlyGroomed - Array of newly groomed trails
 * @returns {string} Comma-separated zone names
 */
function getGroomingZones(newlyGroomed) {
  if (!newlyGroomed || newlyGroomed.length === 0) {
    return 'various areas';
  }

  // Extract unique area names
  const areas = new Set();
  for (const trail of newlyGroomed) {
    if (trail.area) {
      areas.add(trail.area);
    }
  }

  const areaList = Array.from(areas);

  // Return formatted string
  if (areaList.length === 0) {
    return 'various areas';
  } else if (areaList.length === 1) {
    return areaList[0];
  } else if (areaList.length === 2) {
    return `${areaList[0]} and ${areaList[1]}`;
  } else {
    // Take first 2-3 areas
    const first = areaList.slice(0, 2).join(', ');
    return `${first}, and more`;
  }
}

module.exports = {
  generateMorningBrief,
  evaluateRules,
  selectHeadline,
  selectBodyFragments,
  renderTemplate
};
