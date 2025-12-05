# Ikon Resort API Investigation Results

**Date:** 2025-12-05
**Purpose:** Identify alternate data sources for Ikon resorts that don't provide terrain/lift data via Inspector API

---

## Executive Summary

Of the ~20 Ikon resorts missing terrain data in the Inspector API, I've successfully identified working API endpoints for **4 resorts** using two different API platforms:
- **3 resorts** use **ReportPal** (Sugarloaf, Sunday River, Loon Mountain)
- **1 resort** uses **custom DOR API** (Killington)

These represent high-quality data sources with comprehensive lift and trail information.

---

## ✅ Resorts With Working APIs

### 1. **Killington** - Custom DOR API
- **URL:** `https://api.killington.com/api/v1/dor/lift-trail-report`
- **Status:** ✅ Working
- **Data Quality:** Excellent
- **Structure:**
  ```json
  {
    "sector": [...],  // Mountain areas
    "lift": [...],    // 20 lifts with status, type, hours, vertical
    "trail": [...]    // 222 trails with status, difficulty, grooming
  }
  ```
- **Current Stats:** 7/20 lifts open, 50/222 trails open, 30 groomed
- **Key Fields:**
  - Lifts: `status`, `type`, `hours`, `vertical`, `capacity`, `wait_time`
  - Trails: `status`, `difficulty`, `groom_status`, `properties` (length, area, snowmaking)
  - Organized by sectors (mountain areas)

---

### 2. **Sugarloaf** - ReportPal API
- **URL:** `https://www.sugarloaf.com/api/reportpal?resortName=sl&useReportPal=true`
- **Status:** ✅ Working
- **Data Quality:** Excellent
- **Structure:**
  ```json
  {
    "facilities": {
      "areas": {
        "area": [...]  // 12 mountain areas with lifts/trails
      }
    },
    "currentConditions": {...},
    "operations": {...}
  }
  ```
- **Current Stats:** 5/15 lifts open, 29/176 trails open, 19 groomed
- **Key Features:**
  - Organized by 12 mountain areas
  - Snow data: 1" (24hr), 15" (7-day), 19" (season)
  - Detailed operating hours and resort status

---

### 3. **Sunday River** - ReportPal API
- **URL:** `https://www.sundayriver.com/api/reportpal?resortName=sr&useReportPal=true`
- **Status:** ✅ Working
- **Data Quality:** Excellent
- **Current Stats:** 7/19 lifts open, 31/144 trails open
- **Features:** Lift features (heated, bubble), terrain parks (7), comprehensive snow data

---

### 4. **Loon Mountain** - ReportPal API
- **URL:** `https://www.loonmtn.com/api/reportpal?resortName=loon&useReportPal=true`
- **Status:** ✅ Working
- **Data Quality:** Excellent
- **Current Stats:** 5/14 lifts open, 27/73 trails open
- **Features:** Acreage tracking (161/403 acres open), terrain parks

---

## ⚠️ Resorts Needing Further Investigation

### Potential ReportPal Candidates (Need Testing)
Based on resort ownership/management patterns, these may use ReportPal:

1. **Big Sky** - May use ReportPal (redirects observed, needs investigation)
2. **Copper Mountain** - Try: `https://www.coppercolorado.com/api/reportpal?resortName=copper&useReportPal=true`
3. **Revelstoke** - Try: `https://www.revelstokemountainresort.com/api/reportpal?resortName=revelstoke&useReportPal=true`

### Aspen Snowmass Resorts (3 total)
- **Aspen Highlands**
- **Aspen Mountain**
- **Buttermilk**
- **Alternative:** Raw weather data at `https://weather.aspensnowmass.com/`
- **Note:** All managed together, may have unified API not yet discovered

### Jackson Hole
- Liftie.info returned no data (may be stale/offline)
- Need to investigate direct website API

### Alta & Snowbird
- Liftie.info theoretically works but returned no data
- Need direct investigation

### Lake Louise
- Canadian resort, may have different data providers
- SSL issues prevented investigation

---

## 📊 API Platform Comparison

| Platform | Resorts Found | Data Structure | Pros | Cons |
|----------|---------------|----------------|------|------|
| **ReportPal** | 3+ (Sugarloaf, Sunday River, Loon) | Hierarchical JSON with areas → lifts/trails | - Comprehensive data<br>- Consistent format<br>- Snow reports included | - Requires resort-specific codes<br>- Not all resorts use it |
| **DOR (Digital Operations Report)** | 1 (Killington) | Flat arrays with sector references | - Rich metadata<br>- Detailed trail properties<br>- Segment-level data | - Custom per resort<br>- Different structure |
| **Liftie.info** | 0 (not working) | Third-party aggregator | - Multi-resort coverage<br>- Open source | - No trail data<br>- May be stale |

---

## 🏗️ Proposed Solution Architecture

### Option 1: Multi-Provider Scraper (Recommended)
Create a flexible scraper that supports multiple API types:

```
lib/
  providers/
    reportpal-provider.js    # Handle ReportPal resorts
    dor-provider.js          # Handle DOR/custom APIs
    inspector-provider.js    # Existing Inspector/Ikon API
```

**Benefits:**
- Each provider handles its own data normalization
- Easy to add new providers
- Maintains existing Inspector API integration

**Configuration:**
```json
{
  "key": "killington",
  "provider": "dor",
  "apiUrl": "https://api.killington.com/api/v1/dor/lift-trail-report"
},
{
  "key": "sugarloaf",
  "provider": "reportpal",
  "apiUrl": "https://www.sugarloaf.com/api/reportpal",
  "reportpalCode": "sl"
}
```

### Option 2: Extend Existing ikon-scraper.js
Add provider-specific logic within ikon-scraper.js:

```javascript
if (resort.apiUrl && resort.apiProvider === 'reportpal') {
  // Fetch from ReportPal
} else if (resort.apiUrl && resort.apiProvider === 'dor') {
  // Fetch from DOR
} else {
  // Use Inspector API (existing)
}
```

**Benefits:**
- Simpler file structure
- All Ikon resorts in one scraper

**Drawbacks:**
- File becomes complex
- Harder to maintain multiple providers

---

## 🎯 Recommended Implementation Plan

### Phase 1: Add Known Working Resorts (High Priority)
1. **Add ReportPal support** for:
   - Sugarloaf ✅
   - Sunday River ✅
   - Loon Mountain ✅

2. **Add DOR support** for:
   - Killington ✅

**Impact:** Adds terrain data for 4 more resorts immediately

### Phase 2: Investigate & Add Remaining Resorts (Medium Priority)
1. Test ReportPal pattern on:
   - Big Sky
   - Copper Mountain
   - Revelstoke

2. Investigate Aspen Snowmass API
3. Investigate Jackson Hole direct API

**Impact:** Could add 5-7 more resorts

### Phase 3: Third-Party Alternatives (Low Priority)
For resorts without direct APIs:
- OnTheSnow API (commercial)
- Custom web scraping (Puppeteer)

---

## 💡 Next Steps

1. **Decide on architecture** (Option 1 vs Option 2)
2. **Create data normalization** for ReportPal → Vail format
3. **Create data normalization** for DOR → Vail format
4. **Update config.json** with new `apiProvider` and `apiUrl` fields
5. **Test with one resort** (recommend Sugarloaf as proof of concept)
6. **Roll out to remaining 3 working APIs**
7. **Continue investigation** for other resorts

---

## 📝 Notes

- All identified APIs are publicly accessible (no authentication required)
- Data structures are well-organized and parse-friendly
- Real-time updates (timestamps in API responses)
- ReportPal appears to be a common platform for ski resort management
- Some resorts may share parent company APIs (e.g., Boyne Resorts owns Sunday River and Loon Mountain)

---

## Appendix: ReportPal Resort Code Patterns

From successful tests, ReportPal URL pattern:
```
https://www.{domain}/api/reportpal?resortName={code}&useReportPal=true
```

Known codes:
- `sl` = Sugarloaf
- `sr` = Sunday River
- `loon` = Loon Mountain
- `bs` = Big Sky (needs verification)

Codes often match resort abbreviations or shortened names.
