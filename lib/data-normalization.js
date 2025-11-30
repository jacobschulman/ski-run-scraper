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
  const now = new Date();

  return {
    resort: resortKey,
    resortName: resortName,
    date: localDate,
    timestamp: now.toISOString(),
    lastUpdated: inspectorResort.LastUpdate || null,
    conditions: snow.OverallConditions || null,
    operatingStatus: inspectorResort.OperatingStatus || null,

    snowfall: {
      overnight_inches: parseFloat(snow.OvernightSnowfallIn) || 0,
      overnight_cm: parseFloat(snow.OvernightSnowfallCM) || 0,
      "24hour_inches": parseFloat(snow.NewSnow24HoursIn) || 0,
      "24hour_cm": parseFloat(snow.NewSnow24HoursCM) || 0,
      "48hour_inches": parseFloat(snow.NewSnow48HoursIn) || 0,
      "48hour_cm": parseFloat(snow.NewSnow48HoursCM) || 0,
      "7day_inches": parseFloat(snow.NewSnow7DaysIn) || 0,
      "7day_cm": parseFloat(snow.NewSnow7DaysCM) || 0,
      season_total_inches: parseFloat(snow.SeasonTotalIn) || 0,
      season_total_cm: parseFloat(snow.SeasonTotalCm) || 0
    },

    baseDepth: {
      inches: parseFloat(snow.SnowBaseDepthIn) || 0,
      cm: parseFloat(snow.SnowBaseDepthCM) || 0,
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
    }
  };
}

module.exports = {
  normalizeInspectorTrail,
  normalizeInspectorLift,
  normalizeInspectorMountainArea,
  normalizeInspectorResort,
  normalizeInspectorSnowReport
};
