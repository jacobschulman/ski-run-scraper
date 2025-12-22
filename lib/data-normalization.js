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

module.exports = {
  // Inspector normalizers
  normalizeInspectorTrail,
  normalizeInspectorLift,
  normalizeInspectorMountainArea,
  normalizeInspectorResort,
  normalizeInspectorSnowReport,

  // ReportPal normalizers
  normalizeReportPalTrail,
  normalizeReportPalLift,
  normalizeReportPalArea,
  normalizeReportPalResort,
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
  mapZanerayDifficulty
};
