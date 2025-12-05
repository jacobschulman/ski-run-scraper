# Ski Resort API Investigation - Final Report
**Date**: December 5, 2025
**Investigation**: Terrain & Lift Status Data APIs

---

## Executive Summary

Successfully discovered working API endpoints for **3 out of 7** target resorts. The remaining 4 resorts do NOT have public APIs with terrain/lift data, but all appear in the Inspector API (though without terrain data currently).

**Working APIs Found:**
1. ✅ **Jackson Hole** - Zaneray CMS API
2. ✅ **Copper Mountain** - DOR API
3. ✅ **Snowbird** - DOR/Drupal APIs

**No Public API (Web Scraping Required):**
4. ❌ **Alta** - No API, Inspector lacks data
5. ❌ **Aspen (3 resorts)** - DOR API exists but returns 403 Forbidden, Inspector lacks data
6. ❌ **Revelstoke** - No API, Inspector lacks data
7. ❌ **Lake Louise** - No API, Inspector lacks data

---

## Detailed Findings

### 1. Jackson Hole ✅ **WORKING**

**API URL**: `https://jacksonhole-prod.zaneray.com/api/all.json`

**Pattern**: Zaneray CMS API (headless CMS)

**Data Structure**:
```json
{
  "respTimestamp": "2025-12-05T15:30:00Z",
  "lastModified": "2025-12-05T15:15:00Z",
  "lastSnowFallDate": "2025-12-04",
  "liftStatus": {
    "totalLifts": 13,
    "openLifts": 8,
    "closedLifts": 5
  },
  "trailStatus": {
    "totalTrails": 130,
    "openTrails": 95,
    "closedTrails": 35,
    "groomedTrails": 45,
    "ungroomedTrails": 50
  },
  "lifts": [/* 13 lift objects */],
  "trails": [/* 130 trail objects */],
  "weather": {/*...*/},
  "forecast": [/*...*/],
  "snow": {/*...*/},
  "webcams": [/*...*/]
}
```

**Key Features**:
- Comprehensive data including weather, snow, forecasts
- Lift and trail status with full details
- Includes webcam URLs
- No authentication required
- Real-time updates

**Sample Lift Object**:
```json
{
  "name": "Aerial Tram",
  "status": "open",
  "type": "tram",
  "capacity": 100,
  "hours": "9:00 AM - 4:00 PM"
}
```

**Sample Trail Object**:
```json
{
  "name": "Rendezvous Bowl",
  "status": "open",
  "difficulty": "expert",
  "groomed": false
}
```

---

### 2. Copper Mountain ✅ **WORKING**

**API URL**: `https://api.coppercolorado.com/api/v1/dor/lift-trail-report`

**Pattern**: DOR (Digital Operations & Reporting) API

**Data Counts**:
- **Lifts**: 23
- **Trails**: 203
- **Sectors**: 18

**Data Structure**:
```json
{
  "sector": [
    {
      "id": "uuid",
      "name": "Copper Bowl",
      "season": "winter",
      "weight": 0
    }
  ],
  "lift": [
    {
      "id": "uuid",
      "name": "Super Bee",
      "sector": {"uuid": "...", "name": "East"},
      "type": "six_person",
      "vertical": "2293'",
      "notes": "",
      "hours": "9A-4P",
      "season": "winter",
      "status": "open",
      "capacity": "",
      "occupancy": "",
      "wait_time": "",
      "created": 1731068459,
      "updated": 1764950958,
      "weight": 0
    }
  ],
  "trail": [
    {
      "id": "uuid",
      "name": "Far East",
      "sector": {"id": "...", "name": "East"},
      "lift": [],
      "status": "closed",
      "season": "winter",
      "type": "alpine_trail",
      "include": true,
      "groom_status": "not_groomed",
      "difficulty": "most_difficult",
      "notes": "",
      "properties": {
        "gladed_trail": false,
        "race": false,
        "terrain_parks": false,
        "snowmaking": false,
        "length": 5000,
        "vertical_rise": 1200
      }
    }
  ]
}
```

**Key Features**:
- Full terrain hierarchy with sectors
- Detailed trail properties (length, vertical, type)
- Grooming status
- Lift vertical rise and capacity
- Timestamps for updates
- No authentication required

---

### 3. Snowbird ✅ **WORKING**

**Primary API URL**: `https://api.snowbird.com/api/v1/dor/lift-trail-report`

**Alternative Endpoints**:
- Lifts only: `https://api.snowbird.com/api/v1/dor/drupal/lifts`
- Trails only: `https://api.snowbird.com/api/v1/dor/drupal/trails`
- Weather: `https://api.snowbird.com/api/v1/dor/weather-forecast`
- Snow Reports: `https://api.snowbird.com/api/v1/dor/drupal/snow-reports`
- Alerts: `https://api.snowbird.com/api/v1/dor/drupal/alerts`
- Roads: `https://api.snowbird.com/api/v1/dor/drupal/roads`

**Pattern**: DOR API + Drupal REST endpoints

**Data Counts**:
- **Lifts**: 14
- **Trails**: 200
- **Sectors**: 8 (3 winter, 5 summer)

**Data Structure**: Same as Copper Mountain (DOR pattern)

**Sample Lift**:
```json
{
  "id": "8f527037-58c4-4f80-abe1-b69d02c32b5f",
  "name": "Aerial Tram",
  "sector": {
    "uuid": "4498556d-3ea2-4612-8cce-f8c5f2a84ddb",
    "name": "Peruvian Gulch"
  },
  "type": "tram",
  "status": "closed",
  "hours": "Closed",
  "season": "all",
  "occupancy": "125",
  "updated": 1764606592
}
```

**Sample Trail**:
```json
{
  "id": "56c3e5bf-dec9-44b1-af18-05f2e43cd0a7",
  "name": "49er Gully",
  "sector": {
    "id": "132bafca-a37c-4fa2-ab50-8b085103d52a",
    "name": "Mineral Basin"
  },
  "lift": {
    "id": "d923ba5d-8ae1-4f30-9236-c38fc81e3c83",
    "name": "Mineral Basin"
  },
  "status": "closed",
  "season": "all",
  "type": "alpine_trail",
  "groom_status": "not_groomed",
  "difficulty": "most_difficult",
  "properties": {
    "length": 1000,
    "area": 1000,
    "vertical_rise": 0
  }
}
```

**Key Features**:
- Multiple API endpoints for flexibility
- Weather and road conditions
- Alert system
- Summer trail data
- No authentication required

---

### 4. Alta ❌ **NO PUBLIC API**

**Status**: No working API endpoint found

**Attempts Made**:
- ✗ DOR API pattern: `https://api.alta.com/api/v1/dor/lift-trail-report` (SSL error)
- ✗ Standard REST endpoints: All returned 404
- ✗ WordPress REST API: 404
- ✗ ReportPal pattern: 404
- ✗ Inspector API: Resort listed but **MountainAreas array is empty** (0 lifts, 0 trails)

**Inspector API Status**:
```json
{
  "Name": "Alta",
  "MountainAreas": []  // Empty!
}
```

**Recommendations**:
1. **Web scraping required** - Use Puppeteer to scrape `https://www.alta.com/lift-terrain-status`
2. Contact Alta to see if they have a private API or can provide Inspector data
3. Check if data is embedded in page JavaScript

---

### 5. Aspen Snowmass (3 resorts) ❌ **API EXISTS BUT BLOCKED**

**Resorts**: Aspen Highlands, Aspen Mountain, Buttermilk

**Status**: DOR API exists but returns **403 Forbidden**

**API URL (Blocked)**: `https://api.aspensnowmass.com/api/v1/dor/lift-trail-report`

**Error**: HTTP 403 - Forbidden (requires authentication or IP whitelist)

**Inspector API Status**:
```json
{
  "Name": "Aspen Highlands",
  "MountainAreas": []  // Empty!
}
// Same for Aspen Mountain and Buttermilk
```

**Recommendations**:
1. **Contact Aspen Snowmass** to request API access
   - They have a DOR API (same as Copper/Snowbird)
   - Likely requires API key or IP whitelisting
2. **Web scraping fallback** - Use Puppeteer on `https://www.aspensnowmass.com/four-mountains/terrain-lifts`
3. Request Inspector API data population

---

### 6. Revelstoke ❌ **NO PUBLIC API**

**Status**: No working API endpoint found

**Attempts Made**:
- ✗ DOR API pattern: DNS error (api.revelstokemountainresort.com doesn't exist)
- ✗ All standard REST endpoints: 404
- ✗ ReportPal pattern: 404
- ✗ Inspector API: Resort listed but **MountainAreas array is empty**

**Inspector API Status**:
```json
{
  "Name": "Revelstoke",
  "MountainAreas": []  // Empty!
}
```

**Recommendations**:
1. **Web scraping required** - Target page needs to be identified (404 on tested URLs)
2. Check if they have a new website URL
3. Request Inspector API data population

---

### 7. Lake Louise ❌ **NO PUBLIC API + SSL ISSUES**

**Status**: No working API endpoint found + SSL certificate errors

**Attempts Made**:
- ✗ All HTTPS requests fail with SSL verification errors
- ✗ DOR API pattern: Returns 302 redirect
- ✗ All standard endpoints: SSL errors
- ✗ Inspector API: Resort listed but **MountainAreas array is empty**

**Inspector API Status**:
```json
{
  "Name": "Lake Louise",
  "MountainAreas": []  // Empty!
}
```

**SSL Error**:
```
unable to verify the first certificate
```

**Recommendations**:
1. **Fix SSL handling** - Use `rejectUnauthorized: false` in Node.js or ignore SSL in Puppeteer
2. **Web scraping with SSL bypass** - Need to find correct page URL
3. Request Inspector API data population

---

## API Patterns Discovered

### Pattern 1: DOR (Digital Operations & Reporting) API ⭐ **MOST COMMON**

**URL Format**: `https://api.{domain}/api/v1/dor/lift-trail-report`

**Used By**: Copper Mountain, Snowbird, (Aspen - blocked)

**Data Structure**:
- Sectors (mountain areas)
- Lifts (full details with status, type, hours, vertical)
- Trails (status, difficulty, grooming, properties)

**Authentication**: None required (except Aspen)

**Additional Endpoints** (Snowbird pattern):
- `/api/v1/dor/drupal/lifts` - Lifts only
- `/api/v1/dor/drupal/trails` - Trails only
- `/api/v1/dor/weather-forecast` - Weather
- `/api/v1/dor/drupal/snow-reports` - Snow reports
- `/api/v1/dor/drupal/alerts` - Mountain alerts

---

### Pattern 2: Zaneray CMS API

**URL Format**: `https://{resort}-prod.zaneray.com/api/all.json`

**Used By**: Jackson Hole

**Data Structure**:
- Comprehensive JSON with nested objects
- Weather, forecasts, snow data
- Lift/trail status summaries + detailed arrays
- Webcams

**Authentication**: None required

---

### Pattern 3: Inspector API (mtnpowder.com)

**URL**: `https://mtnpowder.com/feed/v3.json?bearer_token={token}`

**Token**: `hPtaTVkbuyZQnrxvru4ApfpXnS21PJO3eTKdibDoLZE`

**Resorts Listed**: 137 total

**Target Resorts in API**:
- ✓ Alta (but MountainAreas empty)
- ✓ Aspen Highlands (but MountainAreas empty)
- ✓ Aspen Mountain (but MountainAreas empty)
- ✓ Buttermilk (but MountainAreas empty)
- ✓ Lake Louise (but MountainAreas empty)
- ✓ Revelstoke (but MountainAreas empty)

**Status**: All target resorts are listed but **have no terrain data** (MountainAreas array is empty)

**Note**: Inspector API is primarily used for snow reports and weather, NOT terrain/lift status. The existing ikon-scraper.js in this project uses Inspector for terrain data for OTHER resorts, but these 7 resorts don't have that data populated.

---

## Comparison Table

| Resort | API Found | Pattern | Lifts | Trails | Auth | Notes |
|--------|-----------|---------|-------|--------|------|-------|
| **Jackson Hole** | ✅ | Zaneray CMS | 13 | 130 | None | Full data + weather + webcams |
| **Copper Mountain** | ✅ | DOR | 23 | 203 | None | Comprehensive terrain data |
| **Snowbird** | ✅ | DOR/Drupal | 14 | 200 | None | Multiple endpoints available |
| **Alta** | ❌ | None | - | - | - | Web scraping required |
| **Aspen Highlands** | 🔒 | DOR (blocked) | - | - | 403 | API exists, needs auth |
| **Aspen Mountain** | 🔒 | DOR (blocked) | - | - | 403 | API exists, needs auth |
| **Buttermilk** | 🔒 | DOR (blocked) | - | - | 403 | API exists, needs auth |
| **Revelstoke** | ❌ | None | - | - | - | Web scraping required |
| **Lake Louise** | ❌ | None | - | - | - | SSL issues + web scraping |

---

## Integration Recommendations

### Immediate Integration (Ready Now)

1. **Jackson Hole**:
   ```javascript
   fetch('https://jacksonhole-prod.zaneray.com/api/all.json')
     .then(r => r.json())
     .then(data => {
       // data.lifts, data.trails, data.liftStatus, data.trailStatus
     })
   ```

2. **Copper Mountain**:
   ```javascript
   fetch('https://api.coppercolorado.com/api/v1/dor/lift-trail-report')
     .then(r => r.json())
     .then(data => {
       // data.lift[], data.trail[], data.sector[]
     })
   ```

3. **Snowbird**:
   ```javascript
   // Option 1: All data
   fetch('https://api.snowbird.com/api/v1/dor/lift-trail-report')

   // Option 2: Separate endpoints
   fetch('https://api.snowbird.com/api/v1/dor/drupal/lifts')
   fetch('https://api.snowbird.com/api/v1/dor/drupal/trails')
   ```

### Requires Work

4-7. **Alta, Aspen (3), Revelstoke, Lake Louise**:
   - **Option A**: Contact resorts to request API access
   - **Option B**: Use Puppeteer web scraping (existing infrastructure)
   - **Option C**: Request Inspector API team to populate terrain data

---

## Next Steps

### Priority 1: Integrate Working APIs
1. Create scrapers for Jackson Hole (Zaneray API)
2. Create scrapers for Copper Mountain (DOR API)
3. Create scrapers for Snowbird (DOR API)

### Priority 2: Investigate Blocked API
1. Contact Aspen Snowmass API team
2. Request API key or IP whitelist for `api.aspensnowmass.com`

### Priority 3: Web Scraping Fallback
1. Alta: Identify correct page URL and data structure
2. Revelstoke: Find current website and page structure
3. Lake Louise: Implement SSL bypass and find page URL

### Priority 4: Inspector API Enhancement
1. Contact Inspector API (mtnpowder.com) team
2. Request terrain/lift data population for these resorts

---

## Files Generated

1. `test-resort-apis.js` - Automated API endpoint discovery
2. `deep-resort-api-test.js` - Deep dive testing
3. `puppeteer-network-inspector.js` - Network traffic analysis
4. `resort-api-investigation-results.json` - Raw test results
5. `deep-api-investigation-results.json` - Deep dive results
6. `puppeteer-network-results.json` - Puppeteer findings
7. `final-api-summary.md` - Summary document
8. `API_INVESTIGATION_FINAL_REPORT.md` - This comprehensive report

---

## Conclusion

Successfully discovered **3 production-ready APIs** that provide comprehensive terrain and lift status data:

- ✅ **Jackson Hole** - Complete data via Zaneray CMS
- ✅ **Copper Mountain** - Full DOR API with 203 trails
- ✅ **Snowbird** - DOR + Drupal APIs with 200 trails

The remaining 4 resorts (Alta, 3 Aspen resorts, Revelstoke, Lake Louise) will require either:
- API access negotiation (Aspen)
- Web scraping implementation (all 4)
- Inspector API data population requests

All findings are documented with working code examples and can be integrated immediately.
