// lib/data-normalization.js - Data normalization utilities
// Normalizes Inspector (Ikon) API data to Vail format while preserving all extra fields

/**
 * Normalize Inspector trail data to Vail format
 * Converts string booleans ("Yes"/"No") to actual booleans
 * Preserves ALL extra Inspector fields: Moguls, Glades, Touring, RunOfTheDay, etc.
 */
function normalizeInspectorTrail(inspectorTrail) {
  // Check if trail is groomed - handles various formats:
  // - "Yes"/"No" (standard)
  // - "First Shift", "Second Shift" (Deer Valley style)
  // - "--" or empty (not groomed)
  const isGroomed = (value) => {
    if (!value || typeof value !== 'string') return false;
    const lower = value.toLowerCase().trim();
    // Not groomed if explicitly "no", empty, or placeholder
    if (lower === 'no' || lower === '--' || lower === '' || lower === 'n/a') {
      return false;
    }
    // Anything else (Yes, First Shift, Second Shift, Groomed, etc.) means groomed
    return true;
  };

  const groomedStatus = isGroomed(inspectorTrail.Grooming);

  return {
    // Core Vail fields (normalized)
    Name: inspectorTrail.Name,
    Status: inspectorTrail.Status,
    IsOpen: inspectorTrail.Status === 'Open',
    Difficulty: inspectorTrail.Difficulty,
    IsGroomed: groomedStatus,
    GroomingStatus: groomedStatus ? inspectorTrail.Grooming : null,
    TrailType: inspectorTrail.Type || 'Skiing',

    // Preserve ALL Inspector-specific fields
    Moguls: inspectorTrail.Moguls,
    Glades: inspectorTrail.Glades,
    Touring: inspectorTrail.Touring,
    RunOfTheDay: inspectorTrail.RunOfTheDay,
    SnowMaking: inspectorTrail.SnowMaking,
    NightSkiing: inspectorTrail.NightSkiing,
    Nordic: inspectorTrail.Nordic,

    // Preserve raw Grooming field for reference
    _inspectorGrooming: inspectorTrail.Grooming
  };
}

/**
 * Normalize Inspector lift data to Vail format
 * Preserves ALL extra Inspector fields: WaitTime, FirstTracks, Hours schedule, etc.
 */
function normalizeInspectorLift(inspectorLift) {
  return {
    // Core Vail fields (normalized)
    Name: inspectorLift.Name,
    Status: inspectorLift.Status,
    IsOpen: inspectorLift.Status === 'Open',
    LiftType: inspectorLift.LiftType,

    // Preserve ALL Inspector-specific fields
    WaitTime: inspectorLift.WaitTime || null,
    WaitTimeString: inspectorLift.WaitTime ? `${inspectorLift.WaitTime} min` : null,
    FirstTracks: inspectorLift.FirstTracks,
    Hours: inspectorLift.Hours || null,  // Full schedule: { Monday: { Open: "8:30am", Close: "4:00pm" }, ... }
    ElevationTop: inspectorLift.ElevationTop,
    ElevationBottom: inspectorLift.ElevationBottom,
    VerticalRise: inspectorLift.VerticalRise,
    LiftLength: inspectorLift.LiftLength
  };
}

/**
 * Normalize Inspector mountain area data to Vail grooming area format
 */
function normalizeInspectorMountainArea(inspectorArea) {
  return {
    Name: inspectorArea.Name,
    Trails: (inspectorArea.Trails || []).map(normalizeInspectorTrail),
    Lifts: (inspectorArea.Lifts || []).map(normalizeInspectorLift)
  };
}

/**
 * Normalize complete Inspector resort data to Vail TerrainStatusFeed format
 * This creates a structure compatible with the existing Vail database/file format
 */
function normalizeInspectorResort(inspectorResort) {
  const normalized = {
    // Vail-compatible structure
    ResortId: inspectorResort.Id,
    Date: inspectorResort.LastUpdate,
    GroomingAreas: (inspectorResort.MountainAreas || []).map(normalizeInspectorMountainArea),

    // Collect all lifts at top level (Vail format)
    Lifts: [],

    // Vail-compatible success flag
    IsSuccessful: true,

    // Provider info
    provider: 'ikon',
    apiProvider: 'inspector',

    // Preserve Inspector-specific snow report data
    _inspectorSnowReport: inspectorResort.SnowReport || null,
    _inspectorOperatingStatus: inspectorResort.OperatingStatus || null
  };

  // Flatten lifts from all mountain areas to top-level Lifts array (Vail format)
  normalized.GroomingAreas.forEach(area => {
    if (area.Lifts) {
      normalized.Lifts.push(...area.Lifts);
    }
  });

  return normalized;
}

/**
 * Convert Inspector snow report to clean, structured format
 * Similar to Vail snow data structure
 */
function normalizeInspectorSnowReport(inspectorResort, resortKey, resortName, localDate) {
  const snow = inspectorResort.SnowReport || {};
  const currentConditions = inspectorResort.CurrentConditions || {};
  const baseArea = snow.BaseArea || {};
  const midArea = snow.MidMountainArea || {};
  const summitArea = snow.SummitArea || {};
  const allMountain = snow.AllMountain || {};
  const now = new Date();

  const toNumber = (value) => {
    const num = parseFloat(value);
    return Number.isFinite(num) ? num : null;
  };

  const pickNumber = (...values) => {
    for (const value of values) {
      const num = toNumber(value);
      if (num !== null) return num;
    }
    return 0;
  };

  const normalizeConditionLevel = (level) => {
    if (!level) return null;
    const cleanWeatherText = (text) => {
      if (!text || typeof text !== 'string') return text || null;
      const cleaned = text.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!cleaned) return null;
      return cleaned
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    };

    return {
      location: level.Name || null,
      name: level.Name || null, // Keep both for compatibility
      updated: level.FeedSavedTime || null,
      pressure_in: toNumber(level.PressureIN),
      pressure_mb: toNumber(level.PressureMB),
      temperature_f: toNumber(level.TemperatureF),
      temperature_c: toNumber(level.TemperatureC),
      temperature_high_f: toNumber(level.TemperatureHighF),
      temperature_high_c: toNumber(level.TemperatureHighC),
      temperature_low_f: toNumber(level.TemperatureLowF),
      temperature_low_c: toNumber(level.TemperatureLowC),
      humidity: toNumber(level.Humidity),
      dew_point_f: toNumber(level.DewPointF),
      dew_point_c: toNumber(level.DewPointC),
      wind_direction: level.WindDirection || null,
      wind_speed_mph: toNumber(level.WindStrengthMph),
      wind_speed_kph: toNumber(level.WindStrengthKph),
      wind_gusts_mph: toNumber(level.WindGustsMph),
      wind_gusts_kph: toNumber(level.WindGustsKph),
      wind_chill_f: toNumber(level.WindChillF),
      wind_chill_c: toNumber(level.WindChillC),
      skies: cleanWeatherText(level.Skies) || null,
      conditions: cleanWeatherText(level.Conditions) || null,
      uv_index: level.UvIndex || null,
      icon: level.Icon || null,
      icon_fa: level.IconFA || null,
      // Preserve original data including Lodge, Landmark, Hours, etc.
      _raw: level
    };
  };

  const normalizeForecasts = (forecasts, resortName) => {
    if (!forecasts) return null;
    // Handle both array format [{}] and object format {'0': {}}
    const f = Array.isArray(forecasts) ? forecasts[0] : forecasts['0'];
    if (!f) return null;

    const cleanWeatherText = (text) => {
      if (!text || typeof text !== 'string') return text || null;
      const cleaned = text.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!cleaned) return null;
      return cleaned
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    };

    const mapDay = (day) => {
      if (!day) return null;
      const cleanedSkies = cleanWeatherText(day.skies);
      const cleanedConditions = cleanWeatherText(day.conditions);
      return {
        date: day.date || null,
        skies: cleanedSkies || null,
        conditions: cleanedConditions || null,
        icon: day.icon || null,
        icon_fa: day.icon_fa || null,
        temp_high_f: toNumber(day.temp_high_f),
        temp_low_f: toNumber(day.temp_low_f),
        temp_high_c: toNumber(day.temp_high_c),
        temp_low_c: toNumber(day.temp_low_c),
        forecasted_snow_in: toNumber(day.forecasted_snow_in),
        forecasted_snow_cm: toNumber(day.forecasted_snow_cm),
        forecasted_snow_day_in: toNumber(day.forecasted_snow_day_in),
        forecasted_snow_day_cm: toNumber(day.forecasted_snow_day_cm),
        forecasted_snow_night_in: toNumber(day.forecasted_snow_night_in),
        forecasted_snow_night_cm: toNumber(day.forecasted_snow_night_cm),
        wind: day.avewind?.dir || null,
        wind_speed_mph: toNumber(typeof day.avewind?.mph === 'string' ? day.avewind.mph.replace(/[^0-9.-]/g, '') : day.avewind?.mph),
        wind_speed_kph: toNumber(typeof day.avewind?.kph === 'string' ? day.avewind.kph.replace(/[^0-9.-]/g, '') : day.avewind?.kph)
      };
    };

    const dayOne = mapDay(f.OneDay);
    const dayTwo = mapDay(f.TwoDay);
    const dayThree = mapDay(f.ThreeDay);
    const dayFour = mapDay(f.FourDay);
    const dayFive = mapDay(f.FiveDay);

    const mapToEpicForecastDay = (day) => {
      if (!day) return null;
      const description = day.conditions || day.skies || null;
      return {
        date: day.date || null,
        high_f: day.temp_high_f ?? null,
        high_c: day.temp_high_c ?? null,
        low_f: day.temp_low_f ?? null,
        low_c: day.temp_low_c ?? null,
        description: description,
        snowfall_day_inches: pickNumber(day.forecasted_snow_day_in, day.forecasted_snow_in),
        snowfall_night_inches: pickNumber(day.forecasted_snow_night_in, 0),
        wind: day.wind || null,
        wind_speed: pickNumber(day.wind_speed_mph, day.wind_speed_kph)
      };
    };

    const forecastDaysArray = [dayOne, dayTwo, dayThree, dayFour, dayFive].filter(d => d !== null);
    const epicStyleForecastDays = forecastDaysArray.map(mapToEpicForecastDay).filter(d => d !== null);
    const epicToday = epicStyleForecastDays[0] || null;

    return {
      location: f.ResortName || null,
      issuedAt: f.FeedSavedTime || null,
      temp_high_f: toNumber(f.TempHighF || f.temp_high_f),
      temp_low_f: toNumber(f.TempLowF || f.temp_low_f),
      temp_high_c: toNumber(f.TempHighC || f.temp_high_c || f.TempHigh_c),
      temp_low_c: toNumber(f.TempLowC || f.temp_low_c),
      forecasted_snow_in: toNumber(f.ForecastedSnowIn || f.forecasted_snow_in),
      forecasted_snow_cm: toNumber(f.ForecastedSnowCm || f.forecasted_snow_cm),
      day_comments: f.DayComments || null,
      night_comments: f.NightComments || null,

      // Named days format (Inspector native)
      days: {
        one: dayOne,
        two: dayTwo,
        three: dayThree,
        four: dayFour,
        five: dayFive
      },

      // Array format (compatible with Epic/Vail structure)
      forecast_days: forecastDaysArray,

      // Epic/Vail compatible structure for native app consumers
      locations: [
        {
          name: f.ResortName || resortName || 'Unknown',
          elevation: null,
          today: epicToday,
          forecast_days: epicStyleForecastDays
        }
      ],

      // Preserve original forecast data
      _raw: f
    };
  };

  return {
    resort: resortKey,
    resortName: resortName,
    date: localDate,
    timestamp: now.toISOString(),
    lastUpdated: inspectorResort.LastUpdate || snow.LastUpdate || null,
    conditions: (() => {
      const text = snow.OverallConditions || snow.BaseConditions || null;
      if (!text || typeof text !== 'string') return text;
      const cleaned = text.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!cleaned) return null;
      return cleaned
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    })(),
    operatingStatus: inspectorResort.OperatingStatus || null,

    snowfall: {
      overnight_inches: pickNumber(allMountain.SinceLiftsClosedIn, baseArea.SinceLiftsClosedIn, midArea.SinceLiftsClosedIn, summitArea.SinceLiftsClosedIn),
      overnight_cm: pickNumber(allMountain.SinceLiftsClosedCm, baseArea.SinceLiftsClosedCm, midArea.SinceLiftsClosedCm, summitArea.SinceLiftsClosedCm),
      "24hour_inches": pickNumber(allMountain.Last24HoursIn, baseArea.Last24HoursIn, midArea.Last24HoursIn, summitArea.Last24HoursIn),
      "24hour_cm": pickNumber(allMountain.Last24HoursCm, baseArea.Last24HoursCm, midArea.Last24HoursCm, summitArea.Last24HoursCm),
      "48hour_inches": pickNumber(allMountain.Last48HoursIn, baseArea.Last48HoursIn, midArea.Last48HoursIn, summitArea.Last48HoursIn),
      "48hour_cm": pickNumber(allMountain.Last48HoursCm, baseArea.Last48HoursCm, midArea.Last48HoursCm, summitArea.Last48HoursCm),
      "7day_inches": pickNumber(allMountain.Last7DaysIn, baseArea.Last7DaysIn, midArea.Last7DaysIn, summitArea.Last7DaysIn),
      "7day_cm": pickNumber(allMountain.Last7DaysCm, baseArea.Last7DaysCm, midArea.Last7DaysCm, summitArea.Last7DaysCm),
      season_total_inches: pickNumber(snow.SeasonTotalIn, snow.SecondarySeasonTotalIn),
      season_total_cm: pickNumber(snow.SeasonTotalCm, snow.SecondarySeasonTotalCm)
    },

    baseDepth: {
      inches: pickNumber(snow.SnowBaseRangeIn, baseArea.BaseIn, midArea.BaseIn, summitArea.BaseIn),
      cm: pickNumber(snow.SnowBaseRangeCM, baseArea.BaseCm, midArea.BaseCm, summitArea.BaseCm),
      range_inches: snow.SnowBaseRangeIn || null,
      range_cm: snow.SnowBaseRangeCM || null
    },

    terrain: {
      totalTrails: parseInt(snow.TotalTrails) || 0,
      openTrails: parseInt(snow.TotalOpenTrails) || 0,
      groomedTrails: parseInt(snow.GroomedTrails) || 0,
      totalLifts: parseInt(snow.TotalLifts) || 0,
      openLifts: parseInt(snow.TotalOpenLifts) || 0
    },

    activities: {
      groomingActive: snow.GroomingActive,
      snowMakingActive: snow.SnowMakingActive
    },

    currentConditions: {
      base: normalizeConditionLevel(currentConditions.Base),
      midMountain: normalizeConditionLevel(currentConditions.MidMountain),
      summit: normalizeConditionLevel(currentConditions.Summit),
      lastUpdated: currentConditions.Base?.FeedSavedTime || currentConditions.MidMountain?.FeedSavedTime || currentConditions.Summit?.FeedSavedTime || null
    },

    forecast: normalizeForecasts(inspectorResort.Forecasts || inspectorResort.Forecast, resortName)
  };
}

/**
 * Extract weather/forecast data from Inspector API resort object
 * Used to supplement custom provider data (SnoCountry, ReportPal) with weather info
 * @param {Object} inspectorResort - Inspector API resort object
 * @returns {Object} - { currentConditions, forecast }
 */
function extractInspectorWeatherData(inspectorResort) {
  if (!inspectorResort) {
    return { currentConditions: null, forecast: null };
  }

  const currentConditions = inspectorResort.CurrentConditions || {};
  const now = new Date();

  const toNumber = (value) => {
    const num = parseFloat(value);
    return Number.isFinite(num) ? num : null;
  };

  const pickNumber = (...values) => {
    for (const value of values) {
      const num = toNumber(value);
      if (num !== null) return num;
    }
    return 0;
  };

  const normalizeConditionLevel = (level) => {
    if (!level) return null;
    const cleanWeatherText = (text) => {
      if (!text || typeof text !== 'string') return text || null;
      const cleaned = text.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!cleaned) return null;
      return cleaned
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    };

    return {
      location: level.Name || null,
      name: level.Name || null,
      updated: level.FeedSavedTime || null,
      temperature_f: toNumber(level.TemperatureF),
      temperature_c: toNumber(level.TemperatureC),
      temperature_high_f: toNumber(level.TemperatureHighF),
      temperature_low_f: toNumber(level.TemperatureLowF),
      humidity: toNumber(level.Humidity),
      wind_direction: level.WindDirection || null,
      wind_speed_mph: toNumber(level.WindStrengthMph),
      wind_gusts_mph: toNumber(level.WindGustsMph),
      skies: cleanWeatherText(level.Skies) || null,
      conditions: cleanWeatherText(level.Conditions) || null
    };
  };

  const normalizeForecasts = (forecasts, resortName) => {
    if (!forecasts) return null;
    const f = Array.isArray(forecasts) ? forecasts[0] : forecasts['0'];
    if (!f) return null;

    const cleanWeatherText = (text) => {
      if (!text || typeof text !== 'string') return text || null;
      const cleaned = text.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!cleaned) return null;
      return cleaned
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    };

    const mapDay = (day) => {
      if (!day) return null;
      return {
        date: day.date || null,
        skies: cleanWeatherText(day.skies) || null,
        conditions: cleanWeatherText(day.conditions) || null,
        temp_high_f: toNumber(day.temp_high_f),
        temp_low_f: toNumber(day.temp_low_f),
        forecasted_snow_in: toNumber(day.forecasted_snow_in),
        wind: day.avewind?.dir || null,
        wind_speed_mph: toNumber(typeof day.avewind?.mph === 'string' ? day.avewind.mph.replace(/[^0-9.-]/g, '') : day.avewind?.mph)
      };
    };

    const days = [f.OneDay, f.TwoDay, f.ThreeDay, f.FourDay, f.FiveDay].map(mapDay).filter(d => d !== null);

    return {
      location: f.ResortName || resortName || null,
      issuedAt: f.FeedSavedTime || null,
      temp_high_f: toNumber(f.TempHighF),
      temp_low_f: toNumber(f.TempLowF),
      forecasted_snow_in: toNumber(f.ForecastedSnowIn),
      forecast_days: days,
      locations: [{
        name: f.ResortName || resortName || 'Unknown',
        elevation: null,
        today: days[0] ? {
          date: days[0].date,
          high_f: days[0].temp_high_f,
          low_f: days[0].temp_low_f,
          description: days[0].conditions || days[0].skies,
          snowfall_day_inches: days[0].forecasted_snow_in || 0
        } : null,
        forecast_days: days.map(d => ({
          date: d.date,
          high_f: d.temp_high_f,
          low_f: d.temp_low_f,
          description: d.conditions || d.skies,
          snowfall_day_inches: d.forecasted_snow_in || 0
        }))
      }]
    };
  };

  // Build current conditions from Inspector data
  const extractedConditions = {
    base: normalizeConditionLevel(currentConditions.Base),
    midMountain: normalizeConditionLevel(currentConditions.MidMountain),
    summit: normalizeConditionLevel(currentConditions.Summit),
    lastUpdated: currentConditions.Base?.FeedSavedTime || currentConditions.MidMountain?.FeedSavedTime || currentConditions.Summit?.FeedSavedTime || null
  };

  // Check if we have any actual condition data
  const hasConditions = extractedConditions.base || extractedConditions.midMountain || extractedConditions.summit;

  // Build forecast from Inspector data
  const extractedForecast = normalizeForecasts(inspectorResort.Forecasts || inspectorResort.Forecast, inspectorResort.Name);

  return {
    currentConditions: hasConditions ? extractedConditions : null,
    forecast: extractedForecast
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTPAL API NORMALIZERS
// Used by: Big Sky, Sugarloaf, Sunday River, Loon Mountain
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Map ReportPal difficulty to standard format
 */
function mapReportPalDifficulty(difficulty) {
  const mapping = {
    'beginner': 'Green',
    'intermediate': 'Blue',
    'advanced': 'Black',
    'expert': 'Double Black',
    'extreme': 'Double Black'
  };
  return mapping[difficulty?.toLowerCase()] || difficulty || 'Unknown';
}

/**
 * Normalize ReportPal trail data to Vail format
 */
function normalizeReportPalTrail(trail) {
  const isOpen = trail.status === 'Open' || trail.status === 'OPEN';
  const isGroomed = trail.groomed === true || trail.groomed === 'true';

  return {
    Name: trail.name,
    Status: trail.status,
    IsOpen: isOpen,
    Difficulty: mapReportPalDifficulty(trail.difficulty),
    IsGroomed: isGroomed,
    GroomingStatus: isGroomed ? 'Groomed' : null,
    TrailType: trail.type || 'Skiing',
    SnowMaking: trail.snowMaking || null,
    NightSkiing: trail.nightStatus || null,
    _reportpalId: trail.id
  };
}

/**
 * Normalize ReportPal lift data to Vail format
 */
function normalizeReportPalLift(lift) {
  const isOpen = lift.status === 'Open' || lift.status === 'OPEN';

  return {
    Name: lift.name,
    Status: lift.status,
    IsOpen: isOpen,
    LiftType: lift.type || lift.liftIcon || 'Chairlift',
    WaitTime: lift.skierWaitTime || null,
    WaitTimeString: lift.skierWaitTime ? `${lift.skierWaitTime} min` : null,
    Capacity: lift.capacity || null,
    Hours: {
      Open: lift.openTime || null,
      Close: lift.closeTime || null
    },
    _reportpalId: lift.id
  };
}

/**
 * Normalize ReportPal area data to Vail grooming area format
 */
function normalizeReportPalArea(area) {
  const trails = area.trails?.trail || [];
  const lifts = area.lifts?.lift || [];

  return {
    Name: area.name,
    Trails: trails.map(normalizeReportPalTrail),
    Lifts: lifts.map(normalizeReportPalLift)
  };
}

/**
 * Normalize complete ReportPal resort data to Vail TerrainStatusFeed format
 */
function normalizeReportPalResort(reportPalData, resortKey) {
  const areas = reportPalData.facilities?.areas?.area || [];

  const normalized = {
    ResortId: resortKey,
    Date: reportPalData.updated || new Date().toISOString(),
    GroomingAreas: areas.map(normalizeReportPalArea),
    Lifts: [],
    IsSuccessful: true,
    provider: 'ikon',
    apiProvider: 'reportpal',
    _reportpalName: reportPalData.name,
    _reportpalOperations: reportPalData.operations || null
  };

  // Flatten lifts from all areas to top-level Lifts array
  normalized.GroomingAreas.forEach(area => {
    if (area.Lifts) {
      normalized.Lifts.push(...area.Lifts);
    }
  });

  return normalized;
}

/**
 * Normalize ReportPal snow report data to standard format
 * Used by: Big Sky, Sugarloaf, Sunday River, Loon Mountain, Cypress Mountain
 */
function normalizeReportPalSnowReport(reportPalData, resortKey, resortName, localDate) {
  const now = new Date();

  const toNumber = (value) => {
    if (value === '' || value === '--' || value === null || value === undefined) return null;
    const num = parseFloat(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? num : null;
  };

  const pickNumber = (...values) => {
    for (const value of values) {
      const num = toNumber(value);
      if (num !== null) return num;
    }
    return 0;
  };

  // Extract snow data from currentConditions.resortLocations.location[0]
  const locations = reportPalData.currentConditions?.resortLocations?.location || [];
  const primaryLocation = locations[0] || {};

  // ReportPal provides both inches and centimeters variants
  const snowData = {
    overnight_in: toNumber(primaryLocation.snowOverNight?.inches) ?? toNumber(primaryLocation.snowOverNight),
    overnight_cm: toNumber(primaryLocation.snowOverNight?.centimeters),
    snow24_in: toNumber(primaryLocation.snow24Hours?.inches) ?? toNumber(primaryLocation.snow24Hours),
    snow24_cm: toNumber(primaryLocation.snow24Hours?.centimeters),
    snow48_in: toNumber(primaryLocation.snow48Hours?.inches) ?? toNumber(primaryLocation.snow48Hours),
    snow48_cm: toNumber(primaryLocation.snow48Hours?.centimeters),
    snow7d_in: toNumber(primaryLocation.snow7Days?.inches) ?? toNumber(primaryLocation.snow7Days),
    snow7d_cm: toNumber(primaryLocation.snow7Days?.centimeters),
    seasonTotal_in: toNumber(primaryLocation.snowSeasonTotal?.inches) ?? toNumber(primaryLocation.snowSeasonTotal),
    seasonTotal_cm: toNumber(primaryLocation.snowSeasonTotal?.centimeters),
    base_in: toNumber(primaryLocation.base?.inches) ?? toNumber(primaryLocation.base),
    base_cm: toNumber(primaryLocation.base?.centimeters),
    baseMin_in: toNumber(primaryLocation.baseMin?.inches) ?? toNumber(primaryLocation.baseMin),
    baseMax_in: toNumber(primaryLocation.baseMax?.inches) ?? toNumber(primaryLocation.baseMax)
  };

  // Get terrain counts from facilities
  const areas = reportPalData.facilities?.areas?.area || [];
  let totalTrails = 0, openTrails = 0, groomedTrails = 0;
  let totalLifts = 0, openLifts = 0;

  areas.forEach(area => {
    const trails = area.trails?.trail || [];
    const lifts = area.lifts?.lift || [];

    totalTrails += trails.length;
    openTrails += trails.filter(t => t.status === 'Open' || t.status === 'OPEN').length;
    groomedTrails += trails.filter(t => t.groomed === true || t.groomed === 'true').length;

    totalLifts += lifts.length;
    openLifts += lifts.filter(l => l.status === 'Open' || l.status === 'OPEN').length;
  });

  return {
    resort: resortKey,
    resortName: resortName,
    date: localDate,
    timestamp: now.toISOString(),
    lastUpdated: reportPalData.updated || null,
    conditions: primaryLocation.primarySurface || primaryLocation.secondarySurface || null,
    operatingStatus: reportPalData.operations?.status || null,

    snowfall: {
      overnight_inches: pickNumber(snowData.overnight_in),
      overnight_cm: snowData.overnight_cm !== null ? snowData.overnight_cm : Math.round(pickNumber(snowData.overnight_in) * 2.54),
      "24hour_inches": pickNumber(snowData.snow24_in),
      "24hour_cm": snowData.snow24_cm !== null ? snowData.snow24_cm : Math.round(pickNumber(snowData.snow24_in) * 2.54),
      "48hour_inches": pickNumber(snowData.snow48_in),
      "48hour_cm": snowData.snow48_cm !== null ? snowData.snow48_cm : Math.round(pickNumber(snowData.snow48_in) * 2.54),
      "7day_inches": pickNumber(snowData.snow7d_in),
      "7day_cm": snowData.snow7d_cm !== null ? snowData.snow7d_cm : Math.round(pickNumber(snowData.snow7d_in) * 2.54),
      season_total_inches: pickNumber(snowData.seasonTotal_in),
      season_total_cm: snowData.seasonTotal_cm !== null ? snowData.seasonTotal_cm : Math.round(pickNumber(snowData.seasonTotal_in) * 2.54)
    },

    baseDepth: {
      inches: pickNumber(snowData.base_in),
      cm: snowData.base_cm !== null ? snowData.base_cm : Math.round(pickNumber(snowData.base_in) * 2.54),
      range_inches: snowData.baseMin_in !== null && snowData.baseMax_in !== null
        ? `${snowData.baseMin_in}-${snowData.baseMax_in}`
        : null,
      range_cm: null
    },

    terrain: {
      totalTrails,
      openTrails,
      groomedTrails,
      totalLifts,
      openLifts
    },

    activities: {},

    currentConditions: {
      base: null,
      midMountain: null,
      summit: null,
      lastUpdated: reportPalData.updated || null
    },

    forecast: null
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOR API NORMALIZERS
// Used by: Killington, Copper Mountain, Snowbird
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Map DOR difficulty to standard format
 */
function mapDORDifficulty(difficulty) {
  const mapping = {
    'beginner': 'Green',
    'more_difficult': 'Blue',
    'most_difficult': 'Black',
    'extreme': 'Double Black',
    'expert': 'Double Black'
  };
  return mapping[difficulty?.toLowerCase()] || difficulty || 'Unknown';
}

/**
 * Normalize DOR trail data to Vail format
 */
function normalizeDORTrail(trail) {
  const isOpen = trail.status === 'open' || trail.status === 'Open';
  const isGroomed = trail.groom_status === 'groomed';

  return {
    Name: trail.name,
    Status: trail.status === 'open' ? 'Open' : trail.status === 'closed' ? 'Closed' : trail.status,
    IsOpen: isOpen,
    Difficulty: mapDORDifficulty(trail.difficulty),
    IsGroomed: isGroomed,
    GroomingStatus: isGroomed ? 'Groomed' : null,
    TrailType: trail.type === 'alpine_trail' ? 'Skiing' : trail.type || 'Other',
    SnowMaking: trail.properties?.snowmaking || null,
    Glades: trail.properties?.gladed_trail || null,
    _dorId: trail.id,
    _dorSector: trail.sector?.name || null
  };
}

/**
 * Normalize DOR lift data to Vail format
 */
function normalizeDORLift(lift) {
  const isOpen = lift.status === 'open' || lift.status === 'Open';

  // Map lift types
  const liftTypeMap = {
    'quad': 'Quad',
    'triple': 'Triple',
    'double': 'Double',
    'six_person': 'Six Pack',
    'gondola': 'Gondola',
    'tram': 'Tram',
    'surface': 'Surface Lift',
    'conveyor': 'Magic Carpet'
  };

  return {
    Name: lift.name,
    Status: lift.status === 'open' ? 'Open' : lift.status === 'closed' ? 'Closed' : lift.status,
    IsOpen: isOpen,
    LiftType: liftTypeMap[lift.type?.toLowerCase()] || lift.type || 'Chairlift',
    WaitTime: lift.wait_time ? parseInt(lift.wait_time) : null,
    WaitTimeString: lift.wait_time ? `${lift.wait_time} min` : null,
    Capacity: lift.capacity || null,
    VerticalRise: lift.vertical || null,
    Hours: lift.hours || null,
    _dorId: lift.id,
    _dorSector: lift.sector?.name || null
  };
}

/**
 * Normalize complete DOR resort data to Vail TerrainStatusFeed format
 */
function normalizeDORResort(dorData, resortKey) {
  const sectors = dorData.sector || [];
  const lifts = dorData.lift || [];
  const trails = dorData.trail || [];

  // Group trails and lifts by sector
  const sectorMap = {};
  sectors.forEach(s => {
    sectorMap[s.id] = {
      Name: s.name,
      Trails: [],
      Lifts: []
    };
  });

  // Add trails to sectors
  trails.forEach(trail => {
    const sectorId = trail.sector?.id;
    if (sectorId && sectorMap[sectorId]) {
      sectorMap[sectorId].Trails.push(normalizeDORTrail(trail));
    }
  });

  // Add lifts to sectors
  lifts.forEach(lift => {
    const sectorId = lift.sector?.uuid;
    if (sectorId && sectorMap[sectorId]) {
      sectorMap[sectorId].Lifts.push(normalizeDORLift(lift));
    }
  });

  // Filter out empty sectors and convert to array
  const groomingAreas = Object.values(sectorMap).filter(
    area => area.Trails.length > 0 || area.Lifts.length > 0
  );

  const normalized = {
    ResortId: resortKey,
    Date: new Date().toISOString(),
    GroomingAreas: groomingAreas,
    Lifts: lifts.map(normalizeDORLift),
    IsSuccessful: true,
    provider: 'ikon',
    apiProvider: 'dor'
  };

  return normalized;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZANERAY API NORMALIZERS
// Used by: Jackson Hole
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Map Zaneray trail level to standard difficulty
 */
function mapZanerayDifficulty(trailLevel) {
  const mapping = {
    'GREEN_CIRCLE': 'Green',
    'BLUE_SQUARE': 'Blue',
    'DOUBLE_BLUE_SQUARE': 'Blue',
    'BLACK_DIAMOND': 'Black',
    'DOUBLE_BLACK_DIAMOND': 'Double Black',
    'EXPERT': 'Double Black'
  };
  return mapping[trailLevel] || trailLevel || 'Unknown';
}

/**
 * Normalize Zaneray trail data to Vail format
 */
function normalizeZanerayTrail(trailKey, trail) {
  const isOpen = trail.openingStatus === 'OPEN';
  const isGroomed = trail.groomingStatus && trail.groomingStatus !== '';

  return {
    Name: trail.name,
    Status: isOpen ? 'Open' : 'Closed',
    IsOpen: isOpen,
    Difficulty: mapZanerayDifficulty(trail.trailLevel),
    IsGroomed: isGroomed,
    GroomingStatus: trail.groomingStatus || null,
    TrailType: trail.trailType === 'DOWNHILL_SKIING' ? 'Skiing' : trail.trailType || 'Other',
    _zanerayId: trail.id,
    _zanerayKey: trailKey
  };
}

/**
 * Normalize Zaneray lift data to Vail format
 */
function normalizeZanerayLift(liftKey, lift) {
  const isOpen = lift.openingStatus === 'OPEN';

  // Map lift types
  const liftTypeMap = {
    'CHAIRLIFT': 'Chairlift',
    'DETACHABLE_CHAIRLIFT': 'Chairlift',
    'GONDOLA': 'Gondola',
    'TRAM': 'Tram',
    'SURFACE_LIFT': 'Surface Lift',
    'MAGIC_CARPET': 'Magic Carpet'
  };

  return {
    Name: lift.name,
    Status: isOpen ? 'Open' : 'Closed',
    IsOpen: isOpen,
    LiftType: liftTypeMap[lift.liftType] || lift.liftType || 'Chairlift',
    WaitTime: null, // Zaneray doesn't provide wait times in this endpoint
    _zanerayId: lift.id,
    _zanerayKey: liftKey
  };
}

/**
 * Normalize Zaneray snow report data to standard format
 * Used by: Jackson Hole
 */
function normalizeZaneraySnowReport(zanerayData, resortKey, resortName, localDate) {
  const snow = zanerayData.snow || {};
  const weather = zanerayData.weather || {};
  const forecast = zanerayData.forecast || {};
  const now = new Date();

  const toNumber = (value) => {
    if (value === '' || value === '--' || value === null || value === undefined) return null;
    const num = parseFloat(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? num : null;
  };

  const pickNumber = (...values) => {
    for (const value of values) {
      const num = toNumber(value);
      if (num !== null) return num;
    }
    return 0;
  };

  // Extract snow data from elevation levels (Zaneray uses midMountain, tramSummit, base)
  const midMountain = snow.midMountain || {};
  const tramSummit = snow.tramSummit || {};
  const base = snow.base || {};

  // Helper to extract value from Zaneray's nested object format { value: "123", unit: "INCH" }
  const extractValue = (obj) => {
    if (obj === null || obj === undefined) return null;
    if (typeof obj === 'object' && 'value' in obj) return obj.value;
    return obj;
  };

  // Extract weather data from elevation levels
  const midWeather = weather.midMountain || weather['mid-mountain'] || {};
  const summitWeather = weather.tramSummit || weather['tram-summit'] || {};
  const baseWeather = weather.base || {};

  const normalizeConditionLevel = (weatherData, name) => {
    if (!weatherData || Object.keys(weatherData).length === 0) return null;
    return {
      location: name,
      name: name,
      updated: weatherData.lastModified || null,
      // Zaneray returns temperature as { value: "34", unit: "FAHRENHEIT" }
      temperature_f: toNumber(extractValue(weatherData.temperature) || weatherData.temperatureF),
      temperature_c: toNumber(weatherData.temperatureC),
      wind_direction: weatherData.windDirection || null,
      // Zaneray returns wind as { value: "13", unit: "MPH" }
      wind_speed_mph: toNumber(extractValue(weatherData.wind) || weatherData.windSpeedMph || weatherData.windSpeed),
      wind_gusts_mph: toNumber(weatherData.windGustsMph),
      skies: weatherData.conditions || weatherData.skies || null,
      conditions: weatherData.conditions || null
    };
  };

  // Build forecast structure from Zaneray's forecast object
  const normalizeZanerayForecast = (forecastData) => {
    if (!forecastData) return null;

    const dayKeys = ['day1', 'day2', 'day3', 'day4', 'day5', 'OneDay', 'TwoDay', 'ThreeDay', 'FourDay', 'FiveDay'];
    const days = [];

    for (const key of dayKeys) {
      const day = forecastData[key];
      if (day) {
        days.push({
          date: day.date || null,
          skies: day.skies || day.conditions || null,
          conditions: day.conditions || null,
          temp_high_f: toNumber(day.temp_high_f || day.highTemp),
          temp_low_f: toNumber(day.temp_low_f || day.lowTemp),
          temp_high_c: toNumber(day.temp_high_c),
          temp_low_c: toNumber(day.temp_low_c),
          forecasted_snow_in: toNumber(day.forecasted_snow_in || day.snowfall),
          forecasted_snow_cm: toNumber(day.forecasted_snow_cm),
          wind: day.avewind?.dir || day.windDirection || null,
          wind_speed_mph: toNumber(day.avewind?.mph || day.windSpeed)
        });
      }
    }

    if (days.length === 0) return null;

    return {
      location: resortName,
      issuedAt: forecastData.lastModified || forecastData.FeedSavedTime || null,
      temp_high_f: days[0]?.temp_high_f,
      temp_low_f: days[0]?.temp_low_f,
      temp_high_c: days[0]?.temp_high_c,
      temp_low_c: days[0]?.temp_low_c,
      forecasted_snow_in: days[0]?.forecasted_snow_in,
      forecasted_snow_cm: days[0]?.forecasted_snow_cm,
      forecast_days: days,
      locations: [{
        name: resortName,
        elevation: null,
        today: days[0] ? {
          date: days[0].date,
          high_f: days[0].temp_high_f,
          high_c: days[0].temp_high_c,
          low_f: days[0].temp_low_f,
          low_c: days[0].temp_low_c,
          description: days[0].conditions || days[0].skies,
          snowfall_day_inches: days[0].forecasted_snow_in || 0,
          snowfall_night_inches: 0,
          wind: days[0].wind,
          wind_speed: days[0].wind_speed_mph
        } : null,
        forecast_days: days.map(d => ({
          date: d.date,
          high_f: d.temp_high_f,
          high_c: d.temp_high_c,
          low_f: d.temp_low_f,
          low_c: d.temp_low_c,
          description: d.conditions || d.skies,
          snowfall_day_inches: d.forecasted_snow_in || 0,
          snowfall_night_inches: 0,
          wind: d.wind,
          wind_speed: d.wind_speed_mph
        }))
      }]
    };
  };

  return {
    resort: resortKey,
    resortName: resortName,
    date: localDate,
    timestamp: now.toISOString(),
    lastUpdated: snow.lastModified || zanerayData.lastModified || null,
    conditions: snow.detail || snow.psa || null,
    operatingStatus: zanerayData.liftStatus || null,

    snowfall: {
      // Zaneray returns snow values as objects like { value: "0", unit: "INCH" }
      overnight_inches: pickNumber(extractValue(tramSummit.newSnowSinceLiftsClosed), extractValue(midMountain.newSnowSinceLiftsClosed), extractValue(base.newSnowSinceLiftsClosed)),
      overnight_cm: Math.round(pickNumber(extractValue(tramSummit.newSnowSinceLiftsClosed), extractValue(midMountain.newSnowSinceLiftsClosed)) * 2.54),
      "24hour_inches": pickNumber(extractValue(tramSummit.newSnowLast24H), extractValue(midMountain.newSnowLast24H), extractValue(base.newSnowLast24H)),
      "24hour_cm": Math.round(pickNumber(extractValue(tramSummit.newSnowLast24H), extractValue(midMountain.newSnowLast24H)) * 2.54),
      "48hour_inches": pickNumber(extractValue(tramSummit.newSnowLast48H), extractValue(midMountain.newSnowLast48H), extractValue(base.newSnowLast48H)),
      "48hour_cm": Math.round(pickNumber(extractValue(tramSummit.newSnowLast48H), extractValue(midMountain.newSnowLast48H)) * 2.54),
      "7day_inches": pickNumber(extractValue(tramSummit.newSnowLast7D), extractValue(midMountain.newSnowLast7D), extractValue(base.newSnowLast7D)),
      "7day_cm": Math.round(pickNumber(extractValue(tramSummit.newSnowLast7D), extractValue(midMountain.newSnowLast7D)) * 2.54),
      season_total_inches: pickNumber(extractValue(tramSummit.seasonTotalSnow), extractValue(midMountain.seasonTotalSnow), extractValue(base.seasonTotalSnow)),
      season_total_cm: Math.round(pickNumber(extractValue(tramSummit.seasonTotalSnow), extractValue(midMountain.seasonTotalSnow)) * 2.54)
    },

    baseDepth: {
      inches: pickNumber(extractValue(midMountain.totalSnowDepth), extractValue(tramSummit.totalSnowDepth), extractValue(base.totalSnowDepth)),
      cm: Math.round(pickNumber(extractValue(midMountain.totalSnowDepth), extractValue(tramSummit.totalSnowDepth)) * 2.54),
      range_inches: null,
      range_cm: null
    },

    terrain: {
      totalTrails: 0,
      openTrails: 0,
      groomedTrails: 0,
      totalLifts: 0,
      openLifts: 0
    },

    activities: {},

    currentConditions: {
      base: normalizeConditionLevel(baseWeather, 'Base'),
      midMountain: normalizeConditionLevel(midWeather, 'Mid Mountain'),
      summit: normalizeConditionLevel(summitWeather, 'Summit'),
      lastUpdated: weather.lastModified || null
    },

    forecast: normalizeZanerayForecast(forecast)
  };
}

/**
 * Normalize complete Zaneray resort data to Vail TerrainStatusFeed format
 */
function normalizeZanerayResort(zanerayData, resortKey) {
  // Zaneray uses object format with keys as IDs, not arrays
  const liftsObj = zanerayData.lifts || {};
  const trailsObj = zanerayData.trails || {};

  // Convert objects to arrays
  const lifts = Object.entries(liftsObj).map(([key, lift]) => normalizeZanerayLift(key, lift));
  const trails = Object.entries(trailsObj).map(([key, trail]) => normalizeZanerayTrail(key, trail));

  // Zaneray doesn't have area groupings, so we put all trails in one area
  const groomingAreas = [
    {
      Name: 'All Terrain',
      Trails: trails,
      Lifts: lifts
    }
  ];

  const normalized = {
    ResortId: resortKey,
    Date: zanerayData.lastModified || new Date().toISOString(),
    GroomingAreas: groomingAreas,
    Lifts: lifts,
    IsSuccessful: true,
    provider: 'ikon',
    apiProvider: 'zaneray',
    _zanerayLiftStatus: zanerayData.liftStatus || null,
    _zanerayTrailStatus: zanerayData.trailStatus || null
  };

  return normalized;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SNOCOUNTRY API NORMALIZERS
// Used by: Snowbird, Killington, Copper Mountain
// Documentation: http://feeds.snocountry.net/
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize SnoCountry snow report data to standard format
 * Used by: Snowbird, Killington, Copper Mountain
 */
function normalizeSnoCountrySnowReport(snoCountryData, resortKey, resortName, localDate) {
  const now = new Date();

  const toNumber = (value) => {
    if (value === '' || value === '--' || value === null || value === undefined) return null;
    // Handle strings like "24" or "18-20" (take first number)
    const str = String(value);
    const match = str.match(/^(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
    const num = parseFloat(str.replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? num : null;
  };

  const pickNumber = (...values) => {
    for (const value of values) {
      const num = toNumber(value);
      if (num !== null) return num;
    }
    return 0;
  };

  // Parse recent snowfall string like "5\" past 6 days" or "2\" past 6 days"
  const parseRecentSnowfall = (str) => {
    if (!str || typeof str !== 'string') return null;
    const match = str.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  };

  // Extract data from SnoCountry response
  const baseDepthMin = toNumber(snoCountryData.avgBaseDepthMin);
  const baseDepthMax = toNumber(snoCountryData.avgBaseDepthMax);
  const baseDepth = baseDepthMax || baseDepthMin || 0;

  const newSnowMin = toNumber(snoCountryData.newSnowMin);
  const newSnowMax = toNumber(snoCountryData.newSnowMax);
  const snowLast48 = toNumber(snoCountryData.snowLast48Hours);
  const recentSnowfall = parseRecentSnowfall(snoCountryData.weatherToday_RecentSnowfall);

  // Calculate overnight from newSnow fields (usually represents last 24h)
  const overnight = newSnowMax || newSnowMin || 0;
  // Use snowLast48Hours if available
  const snow48 = snowLast48 || overnight;

  return {
    resort: resortKey,
    resortName: resortName,
    date: localDate,
    timestamp: now.toISOString(),
    lastUpdated: snoCountryData.reportDateTime || null,
    conditions: snoCountryData.primarySurfaceCondition || null,
    operatingStatus: snoCountryData.resortStatus === '1' ? 'Open' : 'Closed',

    snowfall: {
      overnight_inches: overnight,
      overnight_cm: Math.round(overnight * 2.54),
      "24hour_inches": overnight,
      "24hour_cm": Math.round(overnight * 2.54),
      "48hour_inches": snow48,
      "48hour_cm": Math.round(snow48 * 2.54),
      "7day_inches": recentSnowfall || snow48,
      "7day_cm": Math.round((recentSnowfall || snow48) * 2.54),
      season_total_inches: 0, // SnoCountry doesn't provide season total
      season_total_cm: 0
    },

    baseDepth: {
      inches: baseDepth,
      cm: Math.round(baseDepth * 2.54),
      range_inches: baseDepthMin && baseDepthMax && baseDepthMin !== baseDepthMax
        ? `${baseDepthMin}-${baseDepthMax}`
        : null,
      range_cm: null
    },

    terrain: {
      // SnoCountry uses maxOpenDownHillTrails/Lifts for totals
      totalTrails: pickNumber(snoCountryData.maxOpenDownHillTrails),
      openTrails: pickNumber(snoCountryData.openDownHillTrails),
      groomedTrails: 0, // Not provided by SnoCountry
      totalLifts: pickNumber(snoCountryData.maxOpenDownHillLifts),
      openLifts: pickNumber(snoCountryData.openDownHillLifts)
    },

    activities: {},

    currentConditions: {
      base: null,
      midMountain: null,
      summit: null,
      lastUpdated: snoCountryData.reportDateTime || null
    },

    forecast: null,

    // Preserve raw SnoCountry data for debugging
    _snoCountryRaw: {
      id: snoCountryData.id,
      resortName: snoCountryData.resortName,
      primarySurfaceCondition: snoCountryData.primarySurfaceCondition,
      secondarySurfaceCondition: snoCountryData.secondarySurfaceCondition,
      openDownHillTrails: snoCountryData.openDownHillTrails,
      openDownHillLifts: snoCountryData.openDownHillLifts,
      openDownHillMiles: snoCountryData.openDownHillMiles,
      openDownHillAcres: snoCountryData.openDownHillAcres,
      terrainParkOpen: snoCountryData.terrainParkOpen,
      weatherToday_RecentSnowfall: snoCountryData.weatherToday_RecentSnowfall
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format lift type string for consistent, readable display
 * Converts lowercase/inconsistent formats to properly capitalized versions
 * e.g., "quad" -> "Quad", "t-bar" -> "T-Bar", "conveyor" -> "Conveyor"
 */
function formatLiftType(type) {
  if (!type || typeof type !== 'string') return 'Unknown';

  // Common lift type mappings for normalization
  const liftTypeMap = {
    'quad': 'Quad',
    'triple': 'Triple',
    'double': 'Double',
    'single': 'Single',
    'six': 'Six Pack',
    'six_person': 'Six Pack',
    'gondola': 'Gondola',
    'tram': 'Tram',
    'conveyor': 'Conveyor',
    'carpet': 'Carpet',
    'magic carpet': 'Magic Carpet',
    'surface': 'Surface Lift',
    'surface_lift': 'Surface Lift',
    't-bar': 'T-Bar',
    'tbar': 'T-Bar',
    'j-bar': 'J-Bar',
    'jbar': 'J-Bar',
    'poma': 'Poma',
    'platter': 'Platter',
    'rope tow': 'Rope Tow',
    'tow': 'Tow',
    'chairlift': 'Chairlift',
    'detachable_chairlift': 'Detachable Chairlift',
    'fixed_grip': 'Fixed Grip',
    'high_speed_quad': 'High-Speed Quad',
    'high-speed quad': 'High-Speed Quad',
    'high speed quad': 'High-Speed Quad',
    'high_speed_six': 'High-Speed Six',
    'high-speed six': 'High-Speed Six',
  };

  const lower = type.toLowerCase().trim();

  // Check for exact match in map
  if (liftTypeMap[lower]) {
    return liftTypeMap[lower];
  }

  // If already properly formatted (has capital letter), return as-is
  if (type[0] === type[0].toUpperCase() && type.length > 1) {
    return type;
  }

  // Default: capitalize first letter of each word
  return type
    .split(/[\s-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

module.exports = {
  // Inspector normalizers
  normalizeInspectorTrail,
  normalizeInspectorLift,
  normalizeInspectorMountainArea,
  normalizeInspectorResort,
  normalizeInspectorSnowReport,
  extractInspectorWeatherData,

  // ReportPal normalizers
  normalizeReportPalTrail,
  normalizeReportPalLift,
  normalizeReportPalArea,
  normalizeReportPalResort,
  normalizeReportPalSnowReport,
  mapReportPalDifficulty,

  // DOR normalizers
  normalizeDORTrail,
  normalizeDORLift,
  normalizeDORResort,
  mapDORDifficulty,

  // Zaneray normalizers
  normalizeZanerayTrail,
  normalizeZanerayLift,
  normalizeZanerayResort,
  normalizeZaneraySnowReport,
  mapZanerayDifficulty,

  // SnoCountry normalizers
  normalizeSnoCountrySnowReport,

  // Utilities
  formatLiftType
};
