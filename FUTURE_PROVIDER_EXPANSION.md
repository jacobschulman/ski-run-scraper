# Future Provider Expansion - Investigation & Implementation Plan

**Date**: December 5, 2025
**Status**: Research Complete - Ready for Future Implementation
**Purpose**: Reference document for adding ReportPal, DOR, and other API providers to expand terrain/lift data coverage

---

## Executive Summary

This document captures a comprehensive investigation into adding terrain/lift data for Ikon resorts currently missing this data via the Inspector API. The investigation identified working API endpoints for 5+ resorts and designed a complete implementation plan for adding multi-provider support while maintaining 100% backward compatibility.

**Key Findings**:
- ✅ Identified working APIs for **5 resorts** (Killington, Sugarloaf, Sunday River, Loon Mountain, Big Sky)
- ✅ Confirmed **2 API types**: ReportPal (4 resorts) and DOR (1 resort)
- ✅ Designed multi-provider plugin architecture
- ✅ Planned data availability flags for frontend applications
- ✅ Ensured 100% backward compatibility with existing scrapers

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Investigation Results](#investigation-results)
3. [Working API Endpoints](#working-api-endpoints)
4. [Data Structure Analysis](#data-structure-analysis)
5. [Current System Architecture](#current-system-architecture)
6. [Recommended Implementation Plan](#recommended-implementation-plan)
7. [Data Availability Flags Strategy](#data-availability-flags-strategy)
8. [Configuration Schema](#configuration-schema)
9. [Implementation Phases](#implementation-phases)
10. [Testing Strategy](#testing-strategy)
11. [Open Questions](#open-questions)

---

## Problem Statement

### Current Situation
- **Vail resorts**: Have full terrain/lift data via Puppeteer scraping
- **Ikon resorts**: Use Inspector API (`mtnpowder.com/feed/v3.json`)
- **Issue**: ~20 Ikon resorts **do not provide terrain/lift data** via Inspector API

**Affected Resorts** (partial list):
- Killington, Sugarloaf, Sunday River, Loon Mountain
- Jackson Hole, Big Sky
- Alta, Snowbird
- Aspen Highlands, Aspen Mountain, Buttermilk
- Copper Mountain, Revelstoke, Lake Louise
- And ~10 more

### Impact
- Missing grooming reports for these resorts
- No trail status information
- No lift status (though most don't have lift wait times anyway)
- Briefs generate with `terrain: null`
- Frontend apps can't show terrain sections

### Goal
Add terrain/lift data for these resorts using alternate APIs while:
- Maintaining 100% backward compatibility
- Adding data availability flags for frontend
- Supporting future provider additions easily

---

## Investigation Results

### Confirmed Working API Endpoints

#### **ReportPal API** (4+ resorts confirmed)

**Pattern**: `https://www.{domain}/api/reportpal?resortName={code}&useReportPal=true`

| Resort | Domain | Code | Status | Notes |
|--------|--------|------|--------|-------|
| Big Sky | bigskyresort.com | `bs` | ✅ Working | 40 lifts, 319 trails |
| Sugarloaf | sugarloaf.com | `sl` | ✅ Working | 15 lifts, 176 trails |
| Sunday River | sundayriver.com | `sr` | ✅ Working | 19 lifts, 144 trails |
| Loon Mountain | loonmtn.com | `loon` | ✅ Working | 14 lifts, 73 trails |

**Data Includes**:
- Complete lift status (name, type, status, hours, wait times, capacity)
- Complete trail status (name, difficulty, groomed, snowmaking, status)
- Terrain parks
- Snow report (overnight, 24hr, 7-day, season total, base depth)
- Current conditions
- Operating hours
- Organized by mountain areas

**Sample Response Structure**:
```json
{
  "name": "Big Sky",
  "updated": "2025-12-05T16:17:11Z",
  "operations": {
    "resortStatus": "Open",
    "openTime": "09:00",
    "closeTime": "16:00"
  },
  "currentConditions": {
    "resortwide": {
      "numLiftsTotal": 40,
      "numLiftsOpen": 7,
      "numTrailsTotal": 319,
      "numTrailsOpen": 9,
      "numTrailsGroomed": 9
    }
  },
  "facilities": {
    "areas": {
      "area": [
        {
          "name": "Explorer Area",
          "lifts": {
            "lift": [
              {
                "name": "Explorer Gondola",
                "status": "Closed",
                "type": "Gondola",
                "capacity": 10
              }
            ]
          },
          "trails": {
            "trail": [
              {
                "name": "Lone Wolf",
                "status": "Open",
                "difficulty": "beginner",
                "groomed": true
              }
            ]
          }
        }
      ]
    }
  }
}
```

---

#### **DOR API** (1+ resorts confirmed)

**Pattern**: `https://api.{domain}/api/v1/dor/lift-trail-report`

| Resort | URL | Status | Notes |
|--------|-----|--------|-------|
| Killington | `api.killington.com/api/v1/dor/lift-trail-report` | ✅ Working | 20 lifts, 222 trails |

**Data Includes**:
- Sectors (mountain areas)
- Lifts with status, type, hours, vertical, capacity, wait times
- Trails with status, difficulty, grooming, snowmaking, properties
- Trail segments (sub-sections with individual status)

**Sample Response Structure**:
```json
{
  "sector": [
    {
      "id": "uuid",
      "name": "North Ridge Area",
      "season": "winter",
      "created": 1761942508,
      "updated": 1762019598
    }
  ],
  "lift": [
    {
      "id": "uuid",
      "name": "Canyon Quad",
      "sector": {"uuid": "...", "name": "Canyon Area"},
      "type": "quad",
      "vertical": "1193",
      "hours": "10:00 - 3:30",
      "status": "open",
      "capacity": "",
      "wait_time": ""
    }
  ],
  "trail": [
    {
      "id": "uuid",
      "name": "Anarchy",
      "sector": {"id": "...", "name": "Killington Peak"},
      "status": "closed",
      "type": "alpine_trail",
      "difficulty": "extreme",
      "groom_status": "not_groomed",
      "properties": {
        "length": 0,
        "area": 0,
        "snowmaking": false,
        "gladed_trail": true
      },
      "segments": [...]
    }
  ]
}
```

---

#### **Other Potential Providers** (Not Yet Investigated)

Based on user-provided context, these may have alternate APIs discoverable via browser DevTools:

- Jackson Hole (`jacksonhole.com`)
- Alta (`alta.com`)
- Snowbird (`snowbird.com`)
- Aspen resorts (`aspensnowmass.com`)
- Copper Mountain (`coppercolorado.com` - DOR pattern didn't work, may use different endpoint)
- Revelstoke (`revelstokemountainresort.com`)
- Lake Louise (`skilouise.com`)

**Next Steps for These**: Use browser DevTools to inspect XHR/fetch calls on mountain report pages to find hidden JSON endpoints.

---

## Data Structure Analysis

### Current Normalized Format (Vail/Inspector)

Both Vail and Ikon scrapers currently normalize to this unified structure:

```json
{
  "Date": "2025-12-05T15:15:59.640Z",
  "ResortId": 3,
  "GroomingAreas": [
    {
      "Id": 314,
      "Name": "Arrowhead",
      "Trails": [
        {
          "Id": 4376,
          "Name": "Cresta",
          "Difficulty": "Blue",
          "IsOpen": false,
          "IsGroomed": false,
          "TrailInfo": "",
          "TrailLength": "0 (ft)",
          "TrailType": "Skiing",
          "IsTrailWork": false
        }
      ],
      "Lifts": []
    }
  ],
  "Lifts": [...]
}
```

### ReportPal → Normalized Format Mapping

**Source Structure**:
```json
{
  "facilities": {
    "areas": {
      "area": [
        {
          "name": "Explorer Area",
          "lifts": {"lift": [...]},
          "trails": {"trail": [...]}
        }
      ]
    }
  }
}
```

**Normalization Logic** (to implement):
```javascript
function normalizeReportPalResort(reportPalData, resortKey) {
  const areas = reportPalData.facilities?.areas?.area || [];

  return {
    Date: new Date().toISOString(),
    ResortId: resortKey,
    GroomingAreas: areas.map(area => ({
      Name: area.name,
      Trails: (area.trails?.trail || []).map(trail => ({
        Name: trail.name,
        Difficulty: mapDifficulty(trail.difficulty), // beginner → Green
        IsOpen: trail.status === "Open",
        IsGroomed: trail.groomed === true,
        TrailType: "Skiing",
        GroomingStatus: trail.groomed ? "Groomed" : null
      })),
      Lifts: []
    })),
    Lifts: areas.flatMap(a => (a.lifts?.lift || []).map(lift => ({
      Name: lift.name,
      Status: lift.status,
      Type: lift.type,
      Capacity: lift.capacity
    }))),
    provider: "ikon",
    apiProvider: "reportpal"
  };
}
```

### DOR → Normalized Format Mapping

**Source Structure**:
```json
{
  "sector": [{id, name}],
  "lift": [{id, name, status, type, sector}],
  "trail": [{id, name, status, difficulty, groom_status, sector}]
}
```

**Normalization Logic** (to implement):
```javascript
function normalizeDORResort(dorData, resortKey) {
  const sectors = dorData.sector || [];
  const sectorMap = {};

  // Group trails by sector
  sectors.forEach(s => {
    sectorMap[s.id] = {
      Name: s.name,
      Trails: [],
      Lifts: []
    };
  });

  dorData.trail.forEach(trail => {
    const sector = sectorMap[trail.sector.id];
    if (sector) {
      sector.Trails.push({
        Name: trail.name,
        Difficulty: mapDORDifficulty(trail.difficulty),
        IsOpen: trail.status === "open",
        IsGroomed: trail.groom_status === "groomed",
        TrailType: trail.type === "alpine_trail" ? "Skiing" : "Other"
      });
    }
  });

  return {
    Date: new Date().toISOString(),
    ResortId: resortKey,
    GroomingAreas: Object.values(sectorMap),
    Lifts: dorData.lift.map(lift => ({
      Name: lift.name,
      Status: lift.status,
      Type: lift.type
    })),
    provider: "ikon",
    apiProvider: "dor"
  };
}
```

---

## Current System Architecture

### File Structure
```
ski-run-scraper/
├── vail-scraper.js              # Puppeteer scraper for Vail resorts
├── ikon-scraper.js              # Inspector API scraper for Ikon resorts
├── lib/
│   ├── data-normalization.js    # Normalizes Inspector → Vail format
│   ├── file-storage.js          # File I/O, index generation
│   ├── brief-generator.js       # Generates daily briefs
│   └── season-utils.js          # Season/window logic
├── config.json                  # Resort configuration
└── data/
    ├── {resort}/
    │   ├── terrain/
    │   │   ├── 2025-12-05.json
    │   │   ├── index.json
    │   │   └── latest.json
    │   ├── snow/
    │   ├── brief/
    │   └── lifts/
    ├── index.json               # Master index (all resorts)
    ├── latest-terrain.json
    ├── latest-snow.json
    └── latest-briefs.json
```

### Current Data Flow

**Vail Resorts**:
1. Config specifies `provider: "vail"`
2. `vail-scraper.js` uses Puppeteer to scrape `terrainUrl` and `snowReportUrl`
3. Extracts data from JavaScript-rendered pages
4. Saves to `data/{resort}/terrain/` and `data/{resort}/snow/`
5. `brief-generator.js` combines terrain + snow + lifts → brief

**Ikon Resorts**:
1. Config specifies `provider: "ikon"` and `inspectorName: "Resort Name"`
2. `ikon-scraper.js` fetches `https://mtnpowder.com/feed/v3.json` (all resorts in one call)
3. Finds resort by `inspectorName`
4. `data-normalization.js` converts Inspector → Vail format
5. Saves to `data/{resort}/terrain/` and `data/{resort}/snow/`
6. `brief-generator.js` generates brief

**Current Issue**: Some Ikon resorts don't have `MountainAreas` in Inspector response, resulting in empty terrain files.

---

## Recommended Implementation Plan

### Architecture: Multi-Provider Plugin System

**Recommended Approach**: Create provider plugins in `lib/providers/` directory

**Why**:
- Clean separation of concerns
- Easy to add future providers (just create new file)
- Minimal changes to existing scrapers
- Each provider self-contained and testable
- Backward compatible (providers are opt-in)

### Directory Structure
```
lib/
├── providers/
│   ├── index.js              # NEW: Provider registry/dispatcher
│   ├── inspector.js          # NEW: Extracted Inspector logic
│   ├── reportpal.js          # NEW: ReportPal API provider
│   └── dor.js                # NEW: DOR API provider
├── data-normalization.js     # MODIFY: Add ReportPal/DOR normalizers
├── file-storage.js           # MODIFY: Add capability computation
└── brief-generator.js        # MODIFY: Include capabilities
```

### Provider Interface
```javascript
// lib/providers/index.js
const providers = {
  inspector: require('./inspector'),
  reportpal: require('./reportpal'),
  dor: require('./dor')
};

async function fetchResortData(resort, config) {
  const providerName = resort.apiProvider || 'inspector';
  const provider = providers[providerName];

  if (!provider) {
    throw new Error(`Unknown provider: ${providerName}`);
  }

  return await provider.fetch(resort, config);
}

module.exports = { fetchResortData, providers };
```

### Provider Implementation Example
```javascript
// lib/providers/reportpal.js
const https = require('https');

async function fetch(resort, config) {
  const url = `${resort.apiConfig.baseUrl}${resort.apiConfig.endpoint}?resortName=${resort.apiConfig.resortCode}&useReportPal=true`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

module.exports = { fetch };
```

---

## Data Availability Flags Strategy

### Purpose
Frontend applications need to know what data is available for each resort to:
- Show/hide UI sections (terrain map, grooming report, lift status)
- Display badges ("Terrain data available")
- Route guards ("Does this resort have briefs?")
- Feature flags

### Recommended Multi-Location Strategy

#### **1. Global Index (`data/index.json`)** - PRIMARY

**Best for**: App initialization, routing, quick lookups

```json
{
  "resorts": {
    "killington": {
      "name": "Killington",
      "provider": "ikon",
      "apiProvider": "dor",
      "files": ["2025-12-05.json"],
      "latest": "2025-12-05.json",
      "count": 30,

      "dataCapabilities": {
        "terrainAvailable": true,
        "snowReportAvailable": true,
        "liftStatusAvailable": false,
        "dailyBriefAvailable": true,
        "liftWaitTimesAvailable": false,
        "lastTerrainUpdate": "2025-12-05T12:00:00Z",
        "lastSnowUpdate": "2025-12-05T15:00:00Z",
        "lastBriefUpdate": "2025-12-05T15:30:00Z"
      }
    }
  },
  "lastUpdated": "2025-12-05T15:49:39.375Z"
}
```

**Usage**:
```javascript
// Frontend app initialization
const index = await fetch('/data/index.json');
const resort = index.resorts['killington'];

if (resort.dataCapabilities.terrainAvailable) {
  // Show terrain section
}

if (resort.dataCapabilities.liftWaitTimesAvailable) {
  // Enable lift wait time features
}
```

---

#### **2. Brief Files (`data/{resort}/brief/latest.json`)** - SECONDARY

**Best for**: Resort detail pages

```json
{
  "resort": "killington",
  "date": "2025-12-05",

  "dataCapabilities": {
    "terrainAvailable": true,
    "snowReportAvailable": true,
    "liftStatusAvailable": false,
    "dailyBriefAvailable": true
  },

  "rawData": {
    "snow": {...},
    "terrain": {...},
    "lifts": {
      "available": false
    }
  },
  "computedInsights": {...}
}
```

**Usage**:
```javascript
// Resort detail page
const brief = await fetch('/data/killington/brief/latest.json');

if (brief.dataCapabilities.terrainAvailable) {
  renderTerrainSection(brief.rawData.terrain);
} else {
  showMessage("Terrain data not available for this resort");
}
```

---

### Flag Computation Logic

**Add to `lib/file-storage.js`**:

```javascript
function computeDataCapabilities(resortKey) {
  const capabilities = {
    terrainAvailable: false,
    snowReportAvailable: false,
    liftStatusAvailable: false,
    dailyBriefAvailable: false,
    liftWaitTimesAvailable: false,
    lastTerrainUpdate: null,
    lastSnowUpdate: null,
    lastBriefUpdate: null
  };

  // Check terrain/ directory
  const terrainDir = path.join('data', resortKey, 'terrain');
  if (fs.existsSync(terrainDir)) {
    const files = fs.readdirSync(terrainDir)
      .filter(f => f.endsWith('.json') && f !== 'index.json' && f !== 'latest.json');

    if (files.length > 0) {
      capabilities.terrainAvailable = true;

      // Check if lifts present
      const latestFile = path.join(terrainDir, files.sort().reverse()[0]);
      const data = JSON.parse(fs.readFileSync(latestFile));
      capabilities.liftStatusAvailable = !!(data.Lifts && data.Lifts.length > 0);
      capabilities.lastTerrainUpdate = new Date(data.Date).toISOString();
    }
  }

  // Check snow/ directory
  const snowDir = path.join('data', resortKey, 'snow');
  if (fs.existsSync(snowDir)) {
    const files = fs.readdirSync(snowDir)
      .filter(f => f.endsWith('.json') && f !== 'index.json' && f !== 'latest.json');

    if (files.length > 0) {
      capabilities.snowReportAvailable = true;
      const latestFile = path.join(snowDir, files.sort().reverse()[0]);
      const data = JSON.parse(fs.readFileSync(latestFile));
      capabilities.lastSnowUpdate = data.timestamp || null;
    }
  }

  // Check brief/ directory
  const briefDir = path.join('data', resortKey, 'brief');
  if (fs.existsSync(briefDir)) {
    const files = fs.readdirSync(briefDir)
      .filter(f => f.endsWith('.json') && f !== 'index.json' && f !== 'latest.json');

    capabilities.dailyBriefAvailable = files.length > 0;
    capabilities.lastBriefUpdate = files.length > 0
      ? new Date().toISOString()
      : null;
  }

  // Check lifts/ directory for wait time data (NDJSON files)
  const liftsDir = path.join('data', resortKey, 'lifts');
  if (fs.existsSync(liftsDir)) {
    const files = fs.readdirSync(liftsDir).filter(f => f.endsWith('.ndjson'));
    capabilities.liftWaitTimesAvailable = files.length > 0;
  }

  return capabilities;
}

module.exports = {
  // ... existing exports
  computeDataCapabilities
};
```

**Call from**:
- `generateDataIndex()` - Updates global index
- `generateBrief()` - Adds to brief files

---

## Configuration Schema

### Enhanced Config (Backward Compatible)

**All existing configs remain valid**. New optional fields for alternate APIs:

```json
{
  "resorts": [
    {
      "key": "killington",
      "name": "Killington",
      "timezone": "America/New_York",
      "provider": "ikon",
      "inspectorName": "Killington",
      "seasonStart": "10-15",
      "seasonEnd": "05-26",

      "apiProvider": "dor",
      "apiConfig": {
        "baseUrl": "https://api.killington.com",
        "endpoint": "/api/v1/dor/lift-trail-report"
      }
    },
    {
      "key": "sugarloaf",
      "name": "Sugarloaf",
      "timezone": "America/New_York",
      "provider": "ikon",
      "inspectorName": "Sugarloaf",
      "seasonStart": "11-15",

      "apiProvider": "reportpal",
      "apiConfig": {
        "baseUrl": "https://www.sugarloaf.com",
        "endpoint": "/api/reportpal",
        "resortCode": "sl"
      }
    }
  ]
}
```

### Fallback Behavior

```javascript
// In ikon-scraper.js
const providerName = resort.apiProvider || 'inspector';

if (providerName === 'inspector') {
  // Use Inspector API (existing behavior)
} else {
  // Use alternate provider
  const data = await providers.fetchResortData(resort, config);
  const normalized = normalizationFunctions[providerName](data, resort);
  saveTerrainData(resort.key, normalized);
}

// Snow data still uses Inspector if inspectorName present
if (resort.inspectorName) {
  const snowData = inspectorResponse.find(r => r.Name === resort.inspectorName);
  if (snowData) {
    saveSnowData(resort.key, normalizeSnowData(snowData));
  }
}
```

---

## Implementation Phases

### **Phase 1: Provider Infrastructure** (~1 week)

**Files to create**:
- `lib/providers/index.js` (~60 lines) - Provider registry
- `lib/providers/inspector.js` (~100 lines) - Extract existing logic
- `lib/providers/reportpal.js` (~120 lines) - ReportPal integration
- `lib/providers/dor.js` (~100 lines) - DOR integration

**Testing**:
- Unit test each provider with mock data
- Verify provider selection logic
- Test error handling

---

### **Phase 2: Data Normalization** (~1 week)

**Files to modify**:
- `lib/data-normalization.js` - Add 6 new functions:
  - `normalizeReportPalResort()`
  - `normalizeReportPalTrail()`
  - `normalizeReportPalLift()`
  - `normalizeDORResort()`
  - `normalizeDORTrail()`
  - `normalizeDORLift()`

**Testing**:
- Test with real API responses
- Verify output matches Vail format exactly
- Compare with existing Vail/Inspector output
- Edge case testing (missing fields, null values)

---

### **Phase 3: Scraper Integration** (~1 week)

**Files to modify**:
- `ikon-scraper.js`:
  - Import provider system
  - Modify `scrapeIkonResorts()` to group by provider
  - Add provider-specific scraping logic
  - Maintain Inspector batch processing

**Key logic**:
```javascript
// Group resorts by API provider
const resortsByProvider = {};
resortsToScrape.forEach(resort => {
  const provider = resort.apiProvider || 'inspector';
  if (!resortsByProvider[provider]) resortsByProvider[provider] = [];
  resortsByProvider[provider].push(resort);
});

// Batch process Inspector (existing)
if (resortsByProvider.inspector) {
  await scrapeInspectorResorts(resortsByProvider.inspector);
}

// Individual process for ReportPal/DOR
for (const resort of resortsByProvider.reportpal || []) {
  const data = await providers.fetchResortData(resort, config);
  const normalized = dataNormalization.normalizeReportPalResort(data, resort);
  saveTerrainData(resort.key, normalized);
}
```

**Testing**:
- Full scraper run with mix of providers
- Verify files created correctly
- Check no regressions for existing resorts

---

### **Phase 4: Data Availability Flags** (~3 days)

**Files to modify**:
- `lib/file-storage.js`:
  - Add `computeDataCapabilities()` function
  - Modify `generateDataIndex()` to include capabilities

- `lib/brief-generator.js`:
  - Import `computeDataCapabilities()`
  - Add `dataCapabilities` to brief output

**Testing**:
- Verify flags accurate for all resort types
- Test edge cases (no data, partial data)
- Check timestamps

---

### **Phase 5: Configuration** (~1 day)

**Files to modify**:
- `config.json`:
  - Add `apiProvider` and `apiConfig` for 5 resorts
  - Update documentation

**Testing**:
- Full end-to-end scraper run
- Verify all resorts scrape correctly
- No regressions

---

## Testing Strategy

### Unit Tests
- Provider selection logic
- Each normalizer function (6 total)
- Capability computation with various scenarios
- Edge cases (missing data, malformed responses)

### Integration Tests
- Full scraper run with mix of providers
- File creation in correct locations
- Index generation includes capabilities
- Brief generation with all data types

### Regression Tests
- Existing Vail resorts unchanged
- Existing Ikon (Inspector) resorts unchanged
- Landing page generation works
- No performance degradation

---

## Backward Compatibility Guarantees

### ✅ **Zero Breaking Changes**
- All existing file paths unchanged
- All existing data structures preserved
- New fields are additive only (JSON)
- Vail resorts: Zero logic changes
- Ikon resorts without `apiProvider`: Continue using Inspector
- Data consumers: No code changes required

### ✅ **Graceful Fallbacks**
- API failures → Log error, continue with other resorts
- Missing `apiProvider` → Default to Inspector
- Invalid data → Skip file creation, add to brief errors

### ✅ **Provider Metadata**
Every data file includes:
```json
{
  "provider": "ikon",        // Existing field
  "apiProvider": "reportpal" // New field (null for Vail/Inspector)
}
```

Consumers can ignore `apiProvider` - data format is identical regardless of source.

---

## Open Questions & Recommendations

### 1. **Snow Data Strategy**
**Question**: ReportPal APIs include comprehensive snow data. Should we use it instead of Inspector?

**Options**:
- **A** (Recommended): Continue using Inspector for snow (simpler, current behavior)
- **B**: Use ReportPal/DOR for snow too (more consistent, fewer API calls)

**Recommendation**: Start with **Option A**. Can switch to B later if Inspector snow quality issues arise.

---

### 2. **Error Handling**
**Question**: What should happen when a provider API fails?

**Options**:
- **A** (Recommended): Log error, add to brief `errors` array, skip resort
- **B**: Send notification (email/Slack)
- **C**: Create empty file with error metadata

**Recommendation**: **Option A** with monitoring dashboard

---

### 3. **Testing Approach**
**Question**: How to test before full integration?

**Options**:
- **A**: Create standalone test script to validate APIs
- **B** (Recommended): Implement with built-in unit tests
- **C**: Build incrementally with manual testing

**Recommendation**: **Option B** - unit tests ensure quality, faster iteration

---

### 4. **API Rate Limits**
**Unknown**: Do ReportPal/DOR have rate limits?

**Action**: Monitor first production runs, add throttling if needed (can add delay between requests)

---

### 5. **Historical Backfill**
**Question**: Should we backfill historical data?

**Recommendation**: **No** - focus on forward-looking data, not worth effort/API load

---

## File Reference

### Critical Files for Implementation

| File | Status | Purpose | Est. Lines |
|------|--------|---------|-----------|
| `lib/providers/index.js` | NEW | Provider registry | ~60 |
| `lib/providers/inspector.js` | NEW | Extracted Inspector logic | ~100 |
| `lib/providers/reportpal.js` | NEW | ReportPal integration | ~120 |
| `lib/providers/dor.js` | NEW | DOR integration | ~100 |
| `lib/data-normalization.js` | MODIFY | Add normalizers | +300 |
| `ikon-scraper.js` | MODIFY | Provider integration | +150 |
| `lib/file-storage.js` | MODIFY | Capability flags | +100 |
| `lib/brief-generator.js` | MODIFY | Include capabilities | +10 |
| `config.json` | MODIFY | Configure resorts | +50 |

**Total New Code**: ~940 lines
**Total Modified Code**: ~260 lines

---

## API Response Samples

### ReportPal Sample (Big Sky)
Stored in: `/tmp/reportpal-bigsky-sample.json` (if needed for testing)

Key structure:
- `facilities.areas.area[]` - Mountain areas
- Each area has `lifts.lift[]` and `trails.trail[]`
- Complete snow report in `currentConditions`

### DOR Sample (Killington)
Stored in: `/tmp/dor-killington-sample.json` (if needed for testing)

Key structure:
- `sector[]` - Mountain sections
- `lift[]` - All lifts with status
- `trail[]` - All trails with grooming/status

---

## Success Metrics

### Functional
- [ ] ReportPal scrapes 4 resorts successfully
- [ ] DOR scrapes Killington successfully
- [ ] All terrain data normalized to Vail format
- [ ] Data availability flags accurate for all 70+ resorts
- [ ] Flags in `data/index.json`
- [ ] Flags in brief files
- [ ] Zero regressions

### Performance
- [ ] Scraper execution < 10 minutes
- [ ] File sizes < 500KB per terrain file
- [ ] Memory usage < 1GB

### Quality
- [ ] 100% backward compatibility
- [ ] Existing tests pass
- [ ] 80%+ code coverage for new code

---

## Next Steps When Ready to Implement

1. Review this document
2. Answer open questions
3. Create provider infrastructure (Phase 1)
4. Test with live APIs
5. Implement normalizers (Phase 2)
6. Integrate with scraper (Phase 3)
7. Add capability flags (Phase 4)
8. Update config (Phase 5)
9. Full E2E testing
10. Deploy

---

## Additional Resources

- Inspector API: `https://mtnpowder.com/feed/v3.json` (requires bearer token from config)
- ReportPal pattern: `{domain}/api/reportpal?resortName={code}&useReportPal=true`
- DOR pattern: `api.{domain}/api/v1/dor/lift-trail-report`

**Last Updated**: December 5, 2025
