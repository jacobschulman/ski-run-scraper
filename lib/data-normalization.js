// lib/data-normalization.js - Data normalization utilities
// Normalizes Inspector (Ikon) API data to Vail format while preserving all extra fields

/**
 * Normalize Inspector trail data to Vail format
 * Converts string booleans ("Yes"/"No") to actual booleans
 * Preserves ALL extra Inspector fields: Moguls, Glades, Touring, RunOfTheDay, etc.
 */
function normalizeInspectorTrail(inspectorTrail) {
  // Helper to convert string boolean to actual boolean
  const parseBool = (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      return lower === 'yes' || lower === 'true' || lower === '1';
    }
    return false;
  };

  return {
    // Core Vail fields (normalized)
    Name: inspectorTrail.Name,
    Status: inspectorTrail.Status,
    IsOpen: inspectorTrail.Status === 'Open',
    Difficulty: inspectorTrail.Difficulty,
    IsGroomed: parseBool(inspectorTrail.Grooming),
    GroomingStatus: parseBool(inspectorTrail.Grooming) ? inspectorTrail.Grooming : null,
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
      skies: level.Skies || null,
      conditions: level.Conditions || null,
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

    const mapDay = (day) => {
      if (!day) return null;
      return {
        date: day.date || null,
        skies: day.skies || null,
        conditions: day.conditions || null,
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
      return {
        date: day.date || null,
        high_f: day.temp_high_f ?? null,
        high_c: day.temp_high_c ?? null,
        low_f: day.temp_low_f ?? null,
        low_c: day.temp_low_c ?? null,
        description: day.conditions || day.skies || null,
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
    conditions: snow.OverallConditions || snow.BaseConditions || null,
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

module.exports = {
  normalizeInspectorTrail,
  normalizeInspectorLift,
  normalizeInspectorMountainArea,
  normalizeInspectorResort,
  normalizeInspectorSnowReport
};
