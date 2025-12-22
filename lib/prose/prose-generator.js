/**
 * Morning Brief Prose Generator
 *
 * Generates natural language headlines and body text from resort data
 * using a rule-based template system with headline variations and rotation.
 */

const fs = require('fs');
const path = require('path');
const { rules } = require('./rules');

// Load brief copy configuration (headlines + body variations)
const briefCopyPath = path.join(__dirname, 'brief_copy.json');
let briefCopy = { conditions: {} };
try {
  briefCopy = JSON.parse(fs.readFileSync(briefCopyPath, 'utf8'));
} catch (e) {
  console.warn('Could not load brief_copy.json, using fallback copy');
}

// Path for headline history (per-resort tracking)
const historyPath = path.join(__dirname, '../../data/headline-history.json');

/**
 * Load headline history for all resorts
 */
function loadHeadlineHistory() {
  try {
    if (fs.existsSync(historyPath)) {
      return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    }
  } catch (e) {
    console.warn('Could not load headline history:', e.message);
  }
  return {};
}

/**
 * Save headline history
 */
function saveHeadlineHistory(history) {
  try {
    const dir = path.dirname(historyPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  } catch (e) {
    console.warn('Could not save headline history:', e.message);
  }
}

/**
 * Simple string hash for deterministic selection
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Get day of week from date string
 */
function getDayOfWeek(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

/**
 * Check if a date is a weekend (Saturday or Sunday)
 */
function isWeekend(dateStr) {
  const day = getDayOfWeek(dateStr);
  return day === 'Saturday' || day === 'Sunday';
}

/**
 * Select a headline variation with rotation logic
 *
 * @param {string} condition - The condition key (e.g., 'powder_alert')
 * @param {string} resortKey - Resort identifier
 * @param {string} date - Date string (YYYY-MM-DD)
 * @param {object} history - Full headline history
 * @returns {object} { headline, variationIndex, totalVariations, usedWeekendVariation }
 */
function selectHeadlineVariation(condition, resortKey, date, history) {
  const conditionConfig = briefCopy.conditions[condition];

  if (!conditionConfig || !conditionConfig.headlines || conditionConfig.headlines.length === 0) {
    // Fallback if condition not found
    return {
      headline: 'Your Morning Mountain Brief',
      variationIndex: 0,
      totalVariations: 1,
      usedWeekendVariation: false,
      condition: 'fallback'
    };
  }

  const resortHistory = history[resortKey] || {};
  const dayOfWeek = getDayOfWeek(date);

  // Start with all standard headlines
  let candidates = [...conditionConfig.headlines];
  let usedWeekendVariation = false;

  // Check for weekend-specific headlines (use ~40% of the time on weekends)
  if (isWeekend(date) && conditionConfig.weekendHeadlines && conditionConfig.weekendHeadlines.length > 0) {
    const seed = hashString(`${resortKey}-${date}-weekend`);
    if (seed % 100 < 40) {
      candidates = [...conditionConfig.weekendHeadlines];
      usedWeekendVariation = true;
    }
  }

  // Filter out yesterday's headline if it was the same condition
  if (resortHistory.lastCondition === condition && candidates.length > 1) {
    const filtered = candidates.filter(v => v !== resortHistory.lastHeadline);
    if (filtered.length > 0) {
      candidates = filtered;
    }
  }

  // Deterministic selection based on resort + date (reproducible)
  const seed = hashString(`${resortKey}-${date}-${condition}`);
  const index = seed % candidates.length;

  return {
    headline: candidates[index],
    variationIndex: index,
    totalVariations: conditionConfig.headlines.length + (conditionConfig.weekendHeadlines?.length || 0),
    usedWeekendVariation,
    condition
  };
}

/**
 * Select a body variation for a condition
 *
 * @param {string} condition - The condition key
 * @param {string} resortKey - Resort identifier
 * @param {string} date - Date string
 * @param {object} history - Full history
 * @returns {string|null} Body template or null if none
 */
function selectBodyVariation(condition, resortKey, date, history) {
  const conditionConfig = briefCopy.conditions[condition];

  if (!conditionConfig || !conditionConfig.body || conditionConfig.body.length === 0) {
    return null;
  }

  const resortHistory = history[resortKey] || {};
  let candidates = [...conditionConfig.body];

  // Filter out yesterday's body if it was the same condition
  if (resortHistory.lastCondition === condition && resortHistory.lastBody && candidates.length > 1) {
    const filtered = candidates.filter(v => v !== resortHistory.lastBody);
    if (filtered.length > 0) {
      candidates = filtered;
    }
  }

  // Deterministic selection (different seed than headline so they vary independently)
  const seed = hashString(`${resortKey}-${date}-${condition}-body`);
  const index = seed % candidates.length;

  return candidates[index];
}

/**
 * Generate morning brief prose (headline + body)
 *
 * @param {object} rawData - Raw data from brief (snow, terrain, lifts, forecast)
 * @param {object} computedInsights - Computed insights (flags, alerts, trends)
 * @param {object} options - Options (resortName, date, resortKey)
 * @returns {object} { headline: string, body: string, debug: object }
 */
function generateMorningBrief(rawData, computedInsights, options = {}) {
  const resortKey = options.resortKey || options.resortName?.toLowerCase() || 'unknown';
  const date = options.date || new Date().toISOString().split('T')[0];
  const dayOfWeek = getDayOfWeek(date);

  // Context object for rule evaluation
  const context = {
    dayOfWeek,
    isWeekend: isWeekend(date),
    date
  };

  // Evaluate all rules (pass context for time-based rules)
  const firedRules = evaluateRules(rawData, computedInsights, context);

  // Load headline history
  const history = loadHeadlineHistory();

  // Select headline (highest priority rule with headlineCondition)
  const { headline, headlineRule, headlineSelection } = selectHeadlineFromRules(
    firedRules,
    resortKey,
    date,
    history,
    rawData,
    computedInsights,
    options
  );

  // Update history for this resort
  if (headlineSelection) {
    history[resortKey] = {
      lastHeadline: headlineSelection.headline,
      lastCondition: headlineSelection.condition,
      lastDate: date,
      history: [
        { date, condition: headlineSelection.condition, headline: headlineSelection.headline },
        ...(history[resortKey]?.history || []).slice(0, 6) // Keep last 7 days
      ]
    };
    saveHeadlineHistory(history);
  }

  // Select body fragments (up to 3, ordered by category)
  // Now uses body variations from brief_copy.json when available
  const { templates: bodyFragments, rules: bodyRules } = selectBodyFragmentsWithVariations(
    firedRules,
    resortKey,
    date,
    history,
    3
  );

  // Render templates
  const headlineText = renderTemplate(headline, rawData, computedInsights, options);
  const bodyText = bodyFragments
    .map(template => renderTemplate(template, rawData, computedInsights, options))
    .filter(text => text && text.length > 0)
    .join(' ');

  // Build debug info for rules that actually contributed to output
  const debugRules = [];

  // Add headline rule
  if (headlineRule) {
    debugRules.push({
      id: headlineRule.id,
      category: headlineRule.category,
      priority: headlineRule.priority,
      usedFor: 'headline'
    });
  }

  // Add body rules
  for (const rule of bodyRules) {
    debugRules.push({
      id: rule.id,
      category: rule.category,
      priority: rule.priority,
      usedFor: 'body'
    });
  }

  return {
    headline: headlineText,
    body: bodyText,
    debug: {
      firedRules: debugRules,
      totalRulesFired: firedRules.length,
      headlineSelection: headlineSelection ? {
        condition: headlineSelection.condition,
        variationIndex: headlineSelection.variationIndex,
        totalVariations: headlineSelection.totalVariations,
        usedWeekendVariation: headlineSelection.usedWeekendVariation,
        previousHeadline: history[resortKey]?.history?.[1]?.headline || null
      } : null,
      dayOfWeek
    }
  };
}

/**
 * Evaluate all rules and return those that fired
 *
 * @param {object} rawData - Raw data from brief
 * @param {object} computedInsights - Computed insights
 * @param {object} context - Context (dayOfWeek, isWeekend, date)
 * @returns {Array} Array of fired rules
 */
function evaluateRules(rawData, computedInsights, context = {}) {
  const firedRules = [];

  for (const rule of rules) {
    try {
      if (rule.condition(rawData, computedInsights, context)) {
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
 * Select headline from fired rules with variation rotation
 *
 * @param {Array} firedRules - Array of fired rules
 * @param {string} resortKey - Resort identifier
 * @param {string} date - Date string
 * @param {object} history - Headline history
 * @param {object} rawData - Raw data
 * @param {object} computedInsights - Computed insights
 * @param {object} options - Options
 * @returns {object} { headline, headlineRule, headlineSelection }
 */
function selectHeadlineFromRules(firedRules, resortKey, date, history, rawData, computedInsights, options) {
  // Filter to rules with headline conditions
  const headlineRules = firedRules.filter(rule => rule.headlineCondition);

  // Sort by priority (descending)
  headlineRules.sort((a, b) => b.priority - a.priority);

  if (headlineRules.length === 0) {
    return {
      headline: 'Your Morning Mountain Brief',
      headlineRule: null,
      headlineSelection: null
    };
  }

  // Get the highest priority rule
  const winningRule = headlineRules[0];

  // Select a variation from this condition
  const selection = selectHeadlineVariation(
    winningRule.headlineCondition,
    resortKey,
    date,
    history
  );

  return {
    headline: selection.headline,
    headlineRule: winningRule,
    headlineSelection: selection
  };
}

/**
 * Select the headline from fired rules (legacy function for compatibility)
 *
 * @param {Array} firedRules - Array of fired rules
 * @returns {string} Headline template
 */
function selectHeadline(firedRules) {
  const headlineRules = firedRules.filter(rule => rule.headlineCondition);
  headlineRules.sort((a, b) => b.priority - a.priority);

  if (headlineRules.length > 0) {
    const condition = headlineRules[0].headlineCondition;
    const conditionConfig = briefCopy.conditions[condition];
    if (conditionConfig && conditionConfig.headlines && conditionConfig.headlines.length > 0) {
      return conditionConfig.headlines[0];
    }
  }

  return 'Your Morning Mountain Brief';
}

/**
 * Select body fragments with variations from brief_copy.json
 *
 * @param {Array} firedRules - Array of fired rules
 * @param {string} resortKey - Resort identifier
 * @param {string} date - Date string
 * @param {object} history - Copy history
 * @param {number} maxFragments - Maximum number of fragments to include
 * @returns {object} { templates: Array, rules: Array }
 */
function selectBodyFragmentsWithVariations(firedRules, resortKey, date, history, maxFragments = 3) {
  // Filter to rules that can contribute body content
  // Either has headlineCondition (check brief_copy.json for body) or bodyFragmentTemplate
  const candidateRules = firedRules.filter(rule =>
    rule.headlineCondition || rule.bodyFragmentTemplate
  );

  // Check if resort_closed is among the fired rules - if so, it's the primary body source
  const resortClosedRule = candidateRules.find(r => r.id === 'resort_closed');

  // If resort is closed, only use that body (it's comprehensive)
  if (resortClosedRule) {
    const bodyTemplate = selectBodyVariation('resort_closed', resortKey, date, history);
    if (bodyTemplate) {
      return { templates: [bodyTemplate], rules: [resortClosedRule] };
    }
  }

  // Category order for body assembly
  const categoryOrder = ['snow', 'terrain', 'lifts', 'weather', 'time'];

  // Group by category
  const byCategory = {};
  for (const rule of candidateRules) {
    if (!byCategory[rule.category]) {
      byCategory[rule.category] = [];
    }
    byCategory[rule.category].push(rule);
  }

  // Sort within each category by fragmentOrder (or priority if no fragmentOrder)
  for (const category in byCategory) {
    byCategory[category].sort((a, b) =>
      (a.fragmentOrder || a.priority) - (b.fragmentOrder || b.priority)
    );
  }

  // Assemble fragments in category order
  const templates = [];
  const selectedRules = [];
  const usedConditions = new Set(); // Avoid duplicate body from same condition
  const usedCategories = new Set(); // Track categories to limit to 1 per category

  for (const category of categoryOrder) {
    if (byCategory[category]) {
      for (const rule of byCategory[category]) {
        if (templates.length >= maxFragments) break;

        // Only allow one body fragment per category to avoid duplication
        if (usedCategories.has(category)) continue;

        // Try to get body from brief_copy.json first
        if (rule.headlineCondition) {
          const condition = rule.headlineCondition;

          // Skip if we already used this condition's body
          if (usedConditions.has(condition)) continue;

          const bodyTemplate = selectBodyVariation(condition, resortKey, date, history);
          if (bodyTemplate) {
            templates.push(bodyTemplate);
            selectedRules.push(rule);
            usedConditions.add(condition);
            usedCategories.add(category);
            continue;
          }
        }

        // Fall back to rule's static bodyFragmentTemplate
        if (rule.bodyFragmentTemplate && !usedConditions.has(rule.id)) {
          templates.push(rule.bodyFragmentTemplate);
          selectedRules.push(rule);
          usedConditions.add(rule.id);
          usedCategories.add(category);
        }
      }
    }
  }

  return { templates, rules: selectedRules };
}

/**
 * Select body fragments from fired rules, returning both templates and rules (legacy)
 *
 * @param {Array} firedRules - Array of fired rules
 * @param {number} maxFragments - Maximum number of fragments to include
 * @returns {object} { templates: Array, rules: Array }
 */
function selectBodyFragmentsWithRules(firedRules, maxFragments = 3) {
  // Filter to rules with body fragment templates
  const fragmentRules = firedRules.filter(rule => rule.bodyFragmentTemplate);

  // Category order for body assembly
  const categoryOrder = ['snow', 'terrain', 'lifts', 'weather', 'time'];

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
  const templates = [];
  const selectedRules = [];
  for (const category of categoryOrder) {
    if (byCategory[category]) {
      for (const rule of byCategory[category]) {
        if (templates.length < maxFragments) {
          templates.push(rule.bodyFragmentTemplate);
          selectedRules.push(rule);
        }
      }
    }
  }

  return { templates, rules: selectedRules };
}

/**
 * Select body fragments from fired rules (legacy function)
 */
function selectBodyFragments(firedRules, maxFragments = 3) {
  const { templates } = selectBodyFragmentsWithRules(firedRules, maxFragments);
  return templates;
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

  // Calculate forecast snow total
  const outlook = rawData.forecast?.outlook || [];
  const forecastSnowTotal = outlook.reduce((sum, day) => sum + (day.snowfall_expected || 0), 0);

  // Token mapping: {tokenName} -> value
  const newTrailsCount = rawData.terrain?.newlyOpened?.length || 0;
  const groomedCount = rawData.terrain?.newlyGroomed?.length || 0;
  const openTrailsCount = rawData.terrain?.stats?.openTrails?.today || 0;
  const groomedTrailsCount = rawData.terrain?.stats?.groomedTrails?.today || 0;

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
    newTrailsCount: newTrailsCount,
    groomedCount: groomedCount,
    totalTrails: rawData.terrain?.stats?.totalTrails || 0,

    // Pluralization helpers for terrain (lowercase for body text)
    newTrailWord: newTrailsCount === 1 ? 'trail' : 'trails',
    newRunWord: newTrailsCount === 1 ? 'run' : 'runs',
    groomedTrailWord: groomedCount === 1 ? 'trail' : 'trails',
    groomedRunWord: groomedCount === 1 ? 'run' : 'runs',
    // Capitalized versions for headlines
    NewTrailWord: newTrailsCount === 1 ? 'Trail' : 'Trails',
    NewRunWord: newTrailsCount === 1 ? 'Run' : 'Runs',
    GroomedTrailWord: groomedCount === 1 ? 'Trail' : 'Trails',
    GroomedRunWord: groomedCount === 1 ? 'Run' : 'Runs',
    // Verb conjugation helpers
    newTrailsAre: newTrailsCount === 1 ? 'is' : 'are',
    newTrailsWere: newTrailsCount === 1 ? 'was' : 'were',
    groomedAre: groomedCount === 1 ? 'is' : 'are',
    groomedWere: groomedCount === 1 ? 'was' : 'were',
    // Total counts pluralization (for fallback templates)
    openTrailWord: openTrailsCount === 1 ? 'trail' : 'trails',
    openTrailsAre: openTrailsCount === 1 ? 'is' : 'are',
    totalGroomedWord: groomedTrailsCount === 1 ? 'trail' : 'trails',

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
    forecastSnowTotal: forecastSnowTotal,

    // Time
    dayOfWeek: getDayOfWeek(options.date || new Date().toISOString().split('T')[0]),

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
  renderTemplate,
  // Export for testing
  selectHeadlineVariation,
  loadHeadlineHistory,
  saveHeadlineHistory,
  getDayOfWeek
};
