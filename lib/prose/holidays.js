/**
 * Holiday Awareness for Morning Brief Generation
 *
 * Prevents "Quiet Days on the Hill" and "Midweek Mellow" headlines
 * on holidays when crowds are actually expected.
 */

// Major ski holidays for the 2024-2025 and 2025-2026 seasons
// Format: YYYY-MM-DD
const HOLIDAYS = [
  // 2024-2025 Season
  '2024-11-28', // Thanksgiving
  '2024-11-29', // Black Friday
  '2024-12-21', // Winter Break starts (many schools)
  '2024-12-22',
  '2024-12-23',
  '2024-12-24', // Christmas Eve
  '2024-12-25', // Christmas
  '2024-12-26', // Boxing Day
  '2024-12-27',
  '2024-12-28',
  '2024-12-29',
  '2024-12-30',
  '2024-12-31', // New Year's Eve
  '2025-01-01', // New Year's Day
  '2025-01-02',
  '2025-01-03',
  '2025-01-04',
  '2025-01-05',
  '2025-01-20', // MLK Day
  '2025-02-14', // Valentine's Day (some areas busy)
  '2025-02-15', // Presidents Day Weekend
  '2025-02-16',
  '2025-02-17', // Presidents Day

  // 2025-2026 Season
  '2025-11-27', // Thanksgiving
  '2025-11-28', // Black Friday
  '2025-12-20', // Winter Break starts
  '2025-12-21',
  '2025-12-22',
  '2025-12-23',
  '2025-12-24', // Christmas Eve
  '2025-12-25', // Christmas
  '2025-12-26', // Boxing Day
  '2025-12-27',
  '2025-12-28',
  '2025-12-29',
  '2025-12-30',
  '2025-12-31', // New Year's Eve
  '2026-01-01', // New Year's Day
  '2026-01-02',
  '2026-01-03',
  '2026-01-04',
  '2026-01-05',
  '2026-01-19', // MLK Day
  '2026-02-14', // Valentine's Day
  '2026-02-15', // Presidents Day Weekend
  '2026-02-16', // Presidents Day

  // 2026-2027 Season (partial)
  '2026-11-26', // Thanksgiving
  '2026-11-27', // Black Friday
  '2026-12-19',
  '2026-12-20',
  '2026-12-21',
  '2026-12-22',
  '2026-12-23',
  '2026-12-24', // Christmas Eve
  '2026-12-25', // Christmas
  '2026-12-26',
  '2026-12-27',
  '2026-12-28',
  '2026-12-29',
  '2026-12-30',
  '2026-12-31', // New Year's Eve
  '2027-01-01', // New Year's Day
  '2027-01-02',
  '2027-01-03',
  '2027-01-18', // MLK Day
  '2027-02-15', // Presidents Day
];

// School vacation weeks (approximate - varies by region)
// These are typically busier than regular midweek days
const SCHOOL_VACATION_RANGES = [
  // 2024-2025
  { start: '2024-12-21', end: '2025-01-05', name: 'Winter Break 24-25' },
  { start: '2025-02-15', end: '2025-02-23', name: 'February Break 25' },

  // 2025-2026
  { start: '2025-12-20', end: '2026-01-05', name: 'Winter Break 25-26' },
  { start: '2026-02-14', end: '2026-02-22', name: 'February Break 26' },

  // 2026-2027
  { start: '2026-12-19', end: '2027-01-03', name: 'Winter Break 26-27' },
  { start: '2027-02-13', end: '2027-02-21', name: 'February Break 27' },
];

/**
 * Check if a date is a holiday
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @returns {boolean}
 */
function isHoliday(dateStr) {
  return HOLIDAYS.includes(dateStr);
}

/**
 * Check if a date is during a school vacation period
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @returns {boolean}
 */
function isSchoolVacation(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  return SCHOOL_VACATION_RANGES.some(range => {
    const start = new Date(range.start + 'T00:00:00');
    const end = new Date(range.end + 'T23:59:59');
    return date >= start && date <= end;
  });
}

/**
 * Check if a date is expected to be busy (holiday or vacation)
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @returns {boolean}
 */
function isBusyPeriod(dateStr) {
  return isHoliday(dateStr) || isSchoolVacation(dateStr);
}

/**
 * Get the holiday name for a date (if applicable)
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @returns {string|null}
 */
function getHolidayName(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  const month = date.getMonth();
  const day = date.getDate();
  const dayOfWeek = date.getDay();

  // Christmas
  if (month === 11 && day === 25) return 'Christmas';
  if (month === 11 && day === 24) return 'Christmas Eve';
  if (month === 11 && day === 26) return 'Boxing Day';

  // New Year
  if (month === 11 && day === 31) return "New Year's Eve";
  if (month === 0 && day === 1) return "New Year's Day";

  // Thanksgiving (4th Thursday of November)
  if (month === 10 && dayOfWeek === 4 && day >= 22 && day <= 28) return 'Thanksgiving';
  if (month === 10 && dayOfWeek === 5 && day >= 23 && day <= 29) return 'Black Friday';

  // MLK Day (3rd Monday of January)
  if (month === 0 && dayOfWeek === 1 && day >= 15 && day <= 21) return 'MLK Day';

  // Presidents Day (3rd Monday of February)
  if (month === 1 && dayOfWeek === 1 && day >= 15 && day <= 21) return "Presidents' Day";

  // Check school vacation
  for (const range of SCHOOL_VACATION_RANGES) {
    const start = new Date(range.start + 'T00:00:00');
    const end = new Date(range.end + 'T23:59:59');
    if (date >= start && date <= end) {
      return range.name;
    }
  }

  return null;
}

/**
 * Check if the day is a weekend
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @returns {boolean}
 */
function isWeekend(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
}

/**
 * Determine crowd expectation level
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @returns {string} 'low' | 'moderate' | 'high' | 'peak'
 */
function getCrowdExpectation(dateStr) {
  // Peak days: Christmas, NYE, MLK, Presidents Day
  const date = new Date(dateStr + 'T12:00:00');
  const month = date.getMonth();
  const day = date.getDate();

  // Christmas week and NYE week are peak
  if (month === 11 && day >= 24 || month === 0 && day <= 3) {
    return 'peak';
  }

  // Holiday weekends
  if (isHoliday(dateStr)) {
    return 'high';
  }

  // School vacation midweek
  if (isSchoolVacation(dateStr)) {
    return 'moderate';
  }

  // Regular weekends
  if (isWeekend(dateStr)) {
    return 'moderate';
  }

  // Regular midweek
  return 'low';
}

module.exports = {
  HOLIDAYS,
  SCHOOL_VACATION_RANGES,
  isHoliday,
  isSchoolVacation,
  isBusyPeriod,
  getHolidayName,
  isWeekend,
  getCrowdExpectation
};
