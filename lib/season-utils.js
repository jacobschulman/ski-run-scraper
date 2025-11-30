// lib/season-utils.js - Shared season and timezone utilities
// Used by both Vail (Puppeteer) and Inspector (HTTP API) scrapers

const { formatInTimeZone } = require('date-fns-tz');

/**
 * Get current date in YYYY-MM-DD format for a specific timezone
 */
function getResortLocalDate(timezone) {
  const now = new Date();
  return formatInTimeZone(now, timezone, 'yyyy-MM-dd');
}

/**
 * Get current hour (0-23) in a specific timezone
 */
function getResortLocalHour(timezone) {
  const now = new Date();
  return parseInt(formatInTimeZone(now, timezone, 'H'));
}

/**
 * Get current time formatted for display in a specific timezone
 */
function getResortLocalTimeFormatted(timezone) {
  const now = new Date();
  return formatInTimeZone(now, timezone, 'h:mm a zzz');
}

/**
 * Get current time in HH:mm format for a specific timezone
 */
function getResortLocalTime(timezone) {
  const now = new Date();
  return formatInTimeZone(now, timezone, 'HH:mm');
}

/**
 * Check if a resort is currently in season
 * Uses resort-specific seasonStart/seasonEnd or falls back to defaults from config
 */
function isResortInSeason(resort, config) {
  const timezone = resort.timezone;
  const localDate = getResortLocalDate(timezone);
  const [currentYear, currentMonth, currentDay] = localDate.split('-').map(Number);

  // Get season dates (use resort-specific or defaults)
  const seasonStart = resort.seasonStart || config.schedule.defaultSeasonStart;
  const seasonEnd = resort.seasonEnd || config.schedule.defaultSeasonEnd;

  const [startMonth, startDay] = seasonStart.split('-').map(Number);
  const [endMonth, endDay] = seasonEnd.split('-').map(Number);

  const seasonCrossesYear = startMonth > endMonth || (startMonth === endMonth && startDay > endDay);

  // Handle both cross-year (Northern hemisphere) and same-year (Southern hemisphere) seasons
  let seasonStartYear;
  let seasonEndYear;

  if (seasonCrossesYear) {
    // e.g., Nov 2024 - May 2025
    if (currentMonth >= startMonth) {
      seasonStartYear = currentYear;
      seasonEndYear = currentYear + 1;
    } else {
      seasonStartYear = currentYear - 1;
      seasonEndYear = currentYear;
    }
  } else {
    // e.g., May 2025 - Oct 2025 (same calendar year)
    seasonStartYear = currentYear;
    seasonEndYear = currentYear;
  }

  const seasonStartDate = new Date(seasonStartYear, startMonth - 1, startDay);
  const seasonEndDate = new Date(seasonEndYear, endMonth - 1, endDay);
  const currentDate = new Date(currentYear, currentMonth - 1, currentDay);

  return currentDate >= seasonStartDate && currentDate < seasonEndDate;
}

/**
 * Get the start date of the current ski season for a resort
 */
function getSeasonStartDate(resort, config) {
  const timezone = resort.timezone || 'America/Denver';
  const localDate = getResortLocalDate(timezone);
  const [currentYear, currentMonth] = localDate.split('-').map(Number);

  const seasonStart = resort.seasonStart || config.schedule.defaultSeasonStart;
  const [startMonth, startDay] = seasonStart.split('-').map(Number);

  // Determine which year the season started
  let seasonStartYear;
  if (currentMonth >= startMonth) {
    // We're in the second half of the year (e.g., Nov-Dec)
    seasonStartYear = currentYear;
  } else {
    // We're in the first half of the year (e.g., Jan-Jun)
    // Season started last year
    seasonStartYear = currentYear - 1;
  }

  const year = String(seasonStartYear);
  const month = String(startMonth).padStart(2, '0');
  const day = String(startDay).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Check if current time is within the scraping window for a resort
 */
function isInScrapingWindow(resort, config) {
  const currentHour = getResortLocalHour(resort.timezone);
  const targetHour = resort.targetHour !== undefined ? resort.targetHour : config.schedule.targetHour;
  const windowHours = config.schedule.scrapingWindowHours;

  // Check if current hour is within [targetHour, targetHour + windowHours)
  // e.g., if target is 7 and window is 3, allow 7, 8, 9
  return currentHour >= targetHour && currentHour < (targetHour + windowHours);
}

module.exports = {
  getResortLocalDate,
  getResortLocalHour,
  getResortLocalTime,
  getResortLocalTimeFormatted,
  isResortInSeason,
  getSeasonStartDate,
  isInScrapingWindow
};
