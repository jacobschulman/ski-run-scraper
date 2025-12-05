# Ski Resort API Investigation Results
## Date: 2025-12-05

## Successfully Found APIs

### 1. **Copper Mountain** ✅
- **API URL**: `https://api.coppercolorado.com/api/v1/dor/lift-trail-report`
- **Pattern**: DOR (Digital Operations & Reporting) API
- **Data Structure**:
  - 23 lifts
  - 203 trails
  - Full status, grooming, difficulty data
- **Sample**:
  ```json
  {
    "sector": [...],
    "lift": [{
      "id": "...",
      "name": "Super Bee",
      "type": "six_person",
      "status": "open",
      "hours": "9A-4P"
    }],
    "trail": [{
      "id": "...",
      "name": "Far East",
      "status": "closed",
      "groom_status": "not_groomed",
      "difficulty": "most_difficult"
    }]
  }
  ```

### 2. **Snowbird** ✅
- **API URLs**:
  - Primary: `https://api.snowbird.com/api/v1/dor/lift-trail-report` (comprehensive)
  - Alternate: `https://api.snowbird.com/api/v1/dor/drupal/lifts` (14 lifts)
  - Alternate: `https://api.snowbird.com/api/v1/dor/drupal/trails` (200 trails)
- **Pattern**: DOR API + Drupal endpoints
- **Data Structure**:
  - 14 lifts (Aerial Tram, Peruvian, Chickadee, etc.)
  - 200 trails with full details
  - Includes sectors, status, grooming, difficulty
- **Additional APIs**:
  - Weather: `https://api.snowbird.com/api/v1/dor/weather-forecast`
  - Snow Reports: `https://api.snowbird.com/api/v1/dor/drupal/snow-reports`
  - Alerts: `https://api.snowbird.com/api/v1/dor/drupal/alerts`

### 3. **Jackson Hole** ✅
- **API URL**: `https://jacksonhole-prod.zaneray.com/api/all.json`
- **Pattern**: Zaneray CMS API
- **Data Structure**:
  - Comprehensive data including:
    - `liftStatus` object (3 summary keys)
    - `trailStatus` object (5 summary keys)
    - `lifts` array (13 lifts)
    - `trails` array (130 trails)
    - `weather`, `forecast`, `snow` data
    - `webcams` array
- **Keys**: `respTimestamp`, `lastModified`, `lastSnowFallDate`, `liftStatus`, `lifts`, `trailStatus`, `trails`, `weather`, `forecast`, `snow`, `webcams`
- **Notes**: Primary data source is comprehensive JSON with nested structures

## APIs Still Needed

### 4. **Alta** ⚠️
- **Status**: No public API found
- **Attempts**:
  - ✗ DOR pattern not available (`api.alta.com` - SSL error)
  - ✗ Standard API paths (all 404)
  - ✗ WordPress REST API endpoints (404)
- **URL Tested**: `https://www.alta.com/lift-terrain-status`
- **Next Steps**:
  - May require web scraping with Puppeteer
  - Check if data is embedded in page HTML/JavaScript
  - Look for GraphQL endpoints

### 5. **Aspen Snowmass** (All 3 resorts) ⚠️
- **Status**: API exists but returns 403 Forbidden
- **URLs Attempted**:
  - ✗ `https://api.aspensnowmass.com/api/v1/dor/lift-trail-report` (403)
  - ✗ Standard API paths (404)
- **Page URL**: `https://www.aspensnowmass.com/four-mountains/terrain-lifts`
- **Notes**:
  - API exists but requires authentication/authorization
  - May need to inspect web page for embedded data
  - Could use Inspector API if resorts are on Ikon network

### 6. **Revelstoke** ⚠️
- **Status**: No public API found
- **Attempts**:
  - ✗ DOR pattern not available (DNS error)
  - ✗ Standard API paths (all 404)
- **URL Tested**: `https://www.revelstokemountainresort.com/trail-lift-status`
- **Next Steps**:
  - Web scraping with Puppeteer
  - Check page source for embedded JSON
  - Look for alternative data feeds

### 7. **Lake Louise** ⚠️
- **Status**: No public API found (SSL certificate issues)
- **Attempts**:
  - ✗ All HTTPS requests fail with SSL verification errors
  - ✗ DOR pattern returns 302 redirect
- **URL Tested**: `https://www.skilouise.com/conditions`
- **Notes**:
  - Site has SSL configuration issues
  - May need custom SSL handling or web scraping
  - Check if data is available through Inspector API

## API Patterns Discovered

### 1. **DOR (Digital Operations & Reporting) Pattern** - MOST COMMON
- URL Format: `https://api.{domain}/api/v1/dor/lift-trail-report`
- Used by: Copper Mountain, Snowbird
- Data: Comprehensive lift and trail status with sectors
- Authentication: None required (public endpoint)

### 2. **Zaneray CMS Pattern**
- URL Format: `https://{resort}-prod.zaneray.com/api/all.json`
- Used by: Jackson Hole
- Data: Comprehensive resort data including weather, webcams
- Authentication: None required

### 3. **Drupal REST API Pattern**
- URL Format: `https://api.{domain}/api/v1/dor/drupal/{resource}`
- Used by: Snowbird
- Resources: `lifts`, `trails`, `snow-reports`, `alerts`, `roads`, `sensors`
- Authentication: None required

### 4. **ReportPal Pattern** - NOT FOUND
- URL Format: `{domain}/api/reportpal?resortName={code}&useReportPal=true`
- Status: Not used by any tested resorts
- Note: This pattern may be Vail Resorts specific

## Recommendations

### For Working APIs:
1. **Copper Mountain**: Use DOR API - ready for integration
2. **Snowbird**: Use DOR API or Drupal endpoints - ready for integration
3. **Jackson Hole**: Use Zaneray API - ready for integration

### For Pending APIs:
1. **Alta**:
   - Try web scraping the lift-terrain-status page
   - Check Inspector API if on Ikon network

2. **Aspen Snowmass**:
   - Check Inspector API (all 3 resorts are on Ikon)
   - Investigate authentication requirements for api.aspensnowmass.com
   - Consider web scraping as fallback

3. **Revelstoke**:
   - Check Inspector API (on Ikon network)
   - Web scraping as fallback

4. **Lake Louise**:
   - Check Inspector API (on Ikon network)
   - Fix SSL verification issues or use web scraping

## Inspector API Status

Based on config.json, these resorts ARE configured to use Inspector API:
- ✅ Stratton
- ✅ Palisades Tahoe
- ✅ Jackson Hole (but we found a better direct API)
- ✅ Copper Mountain (but we found a better direct API)
- ✅ **Alta** - Should work with Inspector
- ✅ **Snowbird** - Should work with Inspector (but we found a better direct API)
- ✅ **Aspen Highlands** - Should work with Inspector
- ✅ **Aspen Mountain** - Should work with Inspector
- ✅ **Buttermilk** - Should work with Inspector
- ✅ **Revelstoke** - Should work with Inspector
- ✅ **Lake Louise** - Should work with Inspector

**Inspector API URL**: `https://mtnpowder.com/feed/v3.json?bearer_token={token}`
**Status**: Should have all Ikon resorts including Alta, Aspen, Revelstoke, Lake Louise

## Next Steps

1. ✅ Integrate Copper Mountain DOR API
2. ✅ Integrate Snowbird DOR/Drupal APIs
3. ✅ Integrate Jackson Hole Zaneray API
4. ✓ Verify Inspector API has Alta, Aspen, Revelstoke, Lake Louise data
5. Fallback to web scraping if Inspector data is insufficient

## Data Comparison

| Resort | API Type | Lifts | Trails | Full Data | Authentication |
|--------|----------|-------|--------|-----------|----------------|
| Copper Mountain | DOR | 23 | 203 | ✅ | None |
| Snowbird | DOR/Drupal | 14 | 200 | ✅ | None |
| Jackson Hole | Zaneray | 13 | 130 | ✅ | None |
| Alta | Inspector? | ? | ? | ? | Bearer Token |
| Aspen (3) | Inspector? | ? | ? | ? | Bearer Token |
| Revelstoke | Inspector? | ? | ? | ? | Bearer Token |
| Lake Louise | Inspector? | ? | ? | ? | Bearer Token |
