// lib/providers/canadian-big3.js
// Scraper for Canadian SkiBig3 resorts: Lake Louise, Sunshine Village (Banff), Mt Norquay
// Uses custom data sources instead of Inspector API which returns zeros for these resorts
// Supports both HTTP-only and Puppeteer-based scraping for resorts with JS-rendered content

const https = require('https');
const http = require('http');

// Puppeteer is optional - passed in from caller when available
let puppeteerPage = null;

// ═══════════════════════════════════════════════════════════════════════════════
// UNIT CONVERSION UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

const CM_TO_INCHES = 0.393701;
const INCHES_TO_CM = 2.54;

function cmToInches(cm) {
  if (cm === null || cm === undefined || isNaN(cm)) return null;
  return Math.round(parseFloat(cm) * CM_TO_INCHES * 10) / 10;
}

function celsiusToFahrenheit(c) {
  if (c === null || c === undefined || isNaN(c)) return null;
  return Math.round((parseFloat(c) * 9/5 + 32) * 10) / 10;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP FETCH UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const requestOptions = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': options.accept || '*/*',
        ...options.headers
      }
    };

    protocol.get(url, requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAKE LOUISE - XML API
// ═══════════════════════════════════════════════════════════════════════════════

const LAKE_LOUISE_API = 'https://ski-louise-status-page.vercel.app/api/ski-data';

function parseXmlAttribute(xml, tag, attr) {
  const regex = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i');
  const match = xml.match(regex);
  return match ? match[1] : null;
}

function parseXmlTag(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function parseXmlElements(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*(?:/>|>[^<]*</${tag}>)`, 'gi');
  return xml.match(regex) || [];
}

async function scrapeLakeLouise() {
  const xml = await fetchUrl(LAKE_LOUISE_API, { accept: 'application/xml' });

  // Parse snow conditions from location elements
  const lowerMountain = xml.match(/<location[^>]*name="Lower Mountain"[^>]*>/i);
  const upperMountain = xml.match(/<location[^>]*name="Upper Mountain"[^>]*>/i);

  const lowerBase = toNumber(parseXmlAttribute(xml, 'location[^>]*name="Lower Mountain"', 'base')) || 0;
  const upperBase = toNumber(parseXmlAttribute(xml, 'location[^>]*name="Upper Mountain"', 'base')) || 0;

  // Extract snow data - find the location tags and parse their attributes
  const locationRegex = /<location\s+name="([^"]+)"[^>]*\s+base="(\d+)"[^>]*\s+snowOverNight="(\d+)"[^>]*\s+snow24Hours="(\d+)"[^>]*\s+snow48Hours="(\d+)"[^>]*\s+snow7Days="(\d+)"[^>]*\s+snowYearToDate="(\d+)"[^>]*\s+weatherConditions="([^"]*)"[^>]*\s+temperature="([^"]*)"/gi;

  const locations = {};
  let match;
  while ((match = locationRegex.exec(xml)) !== null) {
    locations[match[1]] = {
      base_cm: toNumber(match[2]),
      overnight_cm: toNumber(match[3]),
      snow24_cm: toNumber(match[4]),
      snow48_cm: toNumber(match[5]),
      snow7day_cm: toNumber(match[6]),
      season_cm: toNumber(match[7]),
      conditions: match[8],
      temperature_c: toNumber(match[9])
    };
  }

  const lower = locations['Lower Mountain'] || {};
  const upper = locations['Upper Mountain'] || {};

  // Parse lifts
  const lifts = [];
  const liftRegex = /<lift\s+id="(\d+)"\s+name="([^"]+)"\s+status="([^"]+)"[^>]*type="([^"]*)"/gi;
  while ((match = liftRegex.exec(xml)) !== null) {
    lifts.push({
      Name: match[2],
      Status: match[3],
      IsOpen: match[3] === 'Open',
      Type: match[4] || 'Unknown',
      LiftId: match[1]
    });
  }

  // Parse trails
  const trails = [];
  const trailRegex = /<trail\s+id="(\d+)"\s+name="([^"]+)"\s+status="([^"]+)"\s+groomed="([^"]+)"[^>]*difficulty="([^"]+)"/gi;
  while ((match = trailRegex.exec(xml)) !== null) {
    trails.push({
      Name: match[2],
      Status: match[3],
      IsOpen: match[3] === 'Open',
      IsGroomed: match[4] === 'yes',
      Difficulty: mapDifficulty(match[5]),
      TrailId: match[1]
    });
  }

  // Parse terrain park
  const terrainParkStatus = parseXmlAttribute(xml, 'terrainPark', 'status');
  const terrainParkFeatures = toNumber(parseXmlAttribute(xml, 'terrainPark', 'features'));

  // Parse forecast
  const forecast = [];
  const dayRegex = /<day\s+name="([^"]+)"\s+high="([^"]+)"\s+low="([^"]+)"\s+weather="([^"]+)"/gi;
  while ((match = dayRegex.exec(xml)) !== null) {
    forecast.push({
      day: match[1],
      high_c: toNumber(match[2]),
      low_c: toNumber(match[3]),
      high_f: celsiusToFahrenheit(toNumber(match[2])),
      low_f: celsiusToFahrenheit(toNumber(match[3])),
      weather: match[4]
    });
  }

  // Parse lifts and runs summary
  const liftsAndRuns = {
    runs: toNumber(parseXmlAttribute(xml, 'liftsAndRuns', 'runs')),
    lifts: toNumber(parseXmlAttribute(xml, 'liftsAndRuns', 'lifts')),
    groomed: toNumber(parseXmlAttribute(xml, 'liftsAndRuns', 'groomed'))
  };

  return {
    resort: 'lakelouise',
    resortName: 'Lake Louise',
    provider: 'canadian-big3',
    apiProvider: 'ski-louise-xml',
    scrapedAt: new Date().toISOString(),

    // Terrain data
    Lifts: lifts,
    Trails: trails,
    GroomingAreas: groupByArea(trails, lifts, xml),

    // Snow data
    snow: {
      overnight_cm: upper.overnight_cm || lower.overnight_cm || 0,
      overnight_inches: cmToInches(upper.overnight_cm || lower.overnight_cm || 0),
      snow24_cm: upper.snow24_cm || lower.snow24_cm || 0,
      snow24_inches: cmToInches(upper.snow24_cm || lower.snow24_cm || 0),
      snow48_cm: upper.snow48_cm || lower.snow48_cm || 0,
      snow48_inches: cmToInches(upper.snow48_cm || lower.snow48_cm || 0),
      snow7day_cm: upper.snow7day_cm || lower.snow7day_cm || 0,
      snow7day_inches: cmToInches(upper.snow7day_cm || lower.snow7day_cm || 0),
      season_cm: upper.season_cm || lower.season_cm || 0,
      season_inches: cmToInches(upper.season_cm || lower.season_cm || 0),
      base_lower_cm: lower.base_cm || 0,
      base_lower_inches: cmToInches(lower.base_cm || 0),
      base_upper_cm: upper.base_cm || 0,
      base_upper_inches: cmToInches(upper.base_cm || 0)
    },

    // Current conditions
    conditions: {
      lower: lower.conditions || null,
      upper: upper.conditions || null,
      temperature_c: upper.temperature_c || lower.temperature_c,
      temperature_f: celsiusToFahrenheit(upper.temperature_c || lower.temperature_c)
    },

    // Summary stats
    stats: {
      liftsOpen: lifts.filter(l => l.IsOpen).length,
      liftsTotal: lifts.length,
      trailsOpen: trails.filter(t => t.IsOpen).length,
      trailsTotal: trails.length,
      trailsGroomed: trails.filter(t => t.IsGroomed).length,
      ...liftsAndRuns
    },

    // Terrain parks
    terrainPark: {
      status: terrainParkStatus,
      features: terrainParkFeatures
    },

    // Forecast
    forecast
  };
}

function groupByArea(trails, lifts, xml) {
  // Parse areas from XML
  const areaRegex = /<area\s+name="([^"]+)">([\s\S]*?)<\/area>/gi;
  const areas = [];
  let match;

  while ((match = areaRegex.exec(xml)) !== null) {
    const areaName = match[1];
    const areaContent = match[2];

    // Get trails for this area
    const areaTrails = [];
    const trailRegex = /<trail\s+id="(\d+)"\s+name="([^"]+)"\s+status="([^"]+)"\s+groomed="([^"]+)"[^>]*difficulty="([^"]+)"/gi;
    let trailMatch;
    while ((trailMatch = trailRegex.exec(areaContent)) !== null) {
      areaTrails.push({
        Name: trailMatch[2],
        Status: trailMatch[3],
        IsOpen: trailMatch[3] === 'Open',
        IsGroomed: trailMatch[4] === 'yes',
        Difficulty: mapDifficulty(trailMatch[5])
      });
    }

    // Get lifts for this area
    const areaLifts = [];
    const liftRegex = /<lift\s+id="(\d+)"\s+name="([^"]+)"\s+status="([^"]+)"[^>]*type="([^"]*)"/gi;
    let liftMatch;
    while ((liftMatch = liftRegex.exec(areaContent)) !== null) {
      areaLifts.push({
        Name: liftMatch[2],
        Status: liftMatch[3],
        IsOpen: liftMatch[3] === 'Open',
        Type: liftMatch[4] || 'Unknown'
      });
    }

    if (areaTrails.length > 0 || areaLifts.length > 0) {
      areas.push({
        Name: areaName,
        Trails: areaTrails,
        Lifts: areaLifts
      });
    }
  }

  return areas;
}

function mapDifficulty(diff) {
  const map = {
    'beginner': 'beginner',
    'easy': 'beginner',
    'green': 'beginner',
    'intermediate': 'intermediate',
    'blue': 'intermediate',
    'advanced': 'advanced',
    'black': 'advanced',
    'expert': 'expert',
    'doubleblack': 'expert',
    'double black': 'expert'
  };
  return map[diff?.toLowerCase()] || diff || 'unknown';
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUNSHINE VILLAGE (BANFF) - intermaps HTML scraper
// ═══════════════════════════════════════════════════════════════════════════════

const SUNSHINE_URL = 'https://sdds4.intermaps.com/sunshine_village/sunshine_village.aspx?lang=en&region_id=2486';

// Status icon mapping based on intermaps icon filenames
const STATUS_ICONS = {
  '169': 'Open',      // Green circle
  '94': 'Closed',     // Red circle
  '205': 'Hold',      // Limited/On Hold (yellow/orange)
  '98': 'Scheduled'   // Scheduled to open
};

// Difficulty icon mapping
const DIFFICULTY_ICONS = {
  '288': 'intermediate',  // Blue square
  '320': 'beginner',      // Green circle
  '326': 'advanced',      // Black diamond
  '404': 'expert'         // Double black diamond
};

async function scrapeSunshineVillage() {
  const html = await fetchUrl(SUNSHINE_URL);

  const lifts = [];
  const trails = [];

  // Parse lifts - look for lift rows with status and type icons
  // Format: <img src="...status_icon_set_6/169.png"...> <img src="...lift_type_set_7/608.png"...> Name
  const liftRegex = /<tr[^>]*>.*?src="[^"]*status_icon_set_6\/(\d+)\.png".*?src="[^"]*lift_type_set_7\/(\d+)\.png".*?class="td_icon_text_v3"[^>]*>([^<]+)/gi;
  let match;

  while ((match = liftRegex.exec(html)) !== null) {
    const statusCode = match[1];
    const typeCode = match[2];
    const name = match[3].trim();

    lifts.push({
      Name: name,
      Status: STATUS_ICONS[statusCode] || 'Unknown',
      IsOpen: statusCode === '169',
      Type: mapLiftType(typeCode)
    });
  }

  // Parse trails/slopes - look for slope rows
  // Format: <img src="...status_icon_set_6/169.png"...> <img src="...slope_diff_set_6/.../288.png"...> Name
  const trailRegex = /<tr[^>]*>.*?src="[^"]*status_icon_set_6\/(\d+)\.png".*?src="[^"]*slope_diff_set_6[^"]*\/(\d+)\.png".*?class="td_icon_text_v3"[^>]*>([^<]+)/gi;

  while ((match = trailRegex.exec(html)) !== null) {
    const statusCode = match[1];
    const diffCode = match[2];
    const name = match[3].trim();

    trails.push({
      Name: name,
      Status: STATUS_ICONS[statusCode] || 'Unknown',
      IsOpen: statusCode === '169',
      IsGroomed: false, // Intermaps doesn't seem to show grooming status directly
      Difficulty: DIFFICULTY_ICONS[diffCode] || 'unknown'
    });
  }

  // Parse weather forecast from the page
  // Weather info appears in td_wetter_grad elements
  const tempRegex = /(-?\d+)\s*\/\s*(-?\d+)\s*°C/gi;
  const temps = [];
  while ((match = tempRegex.exec(html)) !== null) {
    temps.push({
      low_c: toNumber(match[1]),
      high_c: toNumber(match[2]),
      low_f: celsiusToFahrenheit(toNumber(match[1])),
      high_f: celsiusToFahrenheit(toNumber(match[2]))
    });
  }

  return {
    resort: 'banff',
    resortName: 'Banff Sunshine Village',
    provider: 'canadian-big3',
    apiProvider: 'intermaps',
    scrapedAt: new Date().toISOString(),

    // Terrain data
    Lifts: lifts,
    Trails: trails,
    GroomingAreas: groupSunshineByArea(trails, lifts, html),

    // Stats
    stats: {
      liftsOpen: lifts.filter(l => l.IsOpen).length,
      liftsTotal: lifts.length,
      trailsOpen: trails.filter(t => t.IsOpen).length,
      trailsTotal: trails.length,
      trailsGroomed: trails.filter(t => t.IsGroomed).length
    },

    // Weather (if available)
    forecast: temps.map((t, i) => ({
      day: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `Day ${i + 1}`,
      ...t
    }))
  };
}

function groupSunshineByArea(trails, lifts, html) {
  // Parse area sections from the HTML
  // Areas are marked with td_caption_v2 class containing area names
  const areaRegex = /<td[^>]*class="td_caption_v2"[^>]*>([^<]+)</gi;
  const areas = [];
  let match;
  const areaNames = [];

  while ((match = areaRegex.exec(html)) !== null) {
    const name = match[1].trim();
    if (name && name !== 'lifts') {
      areaNames.push(name);
    }
  }

  // For now, group all trails into a single "All Terrain" area
  // since parsing the exact area boundaries from intermaps HTML is complex
  return [{
    Name: 'All Terrain',
    Trails: trails,
    Lifts: lifts
  }];
}

function mapLiftType(code) {
  const typeMap = {
    '604': 'Gondola',
    '608': 'Quad Chair',
    '617': 'Magic Carpet',
    '609': 'Triple Chair',
    '610': 'Double Chair',
    '611': 'Surface Lift'
  };
  return typeMap[code] || 'Chair';
}

// ═══════════════════════════════════════════════════════════════════════════════
// MT NORQUAY - WordPress HTML scraper
// ═══════════════════════════════════════════════════════════════════════════════

const NORQUAY_URL = 'https://banffnorquay.com/winter/conditions/';

async function scrapeNorquay() {
  const html = await fetchUrl(NORQUAY_URL);

  // Parse snow conditions from snow-height elements
  // Order: overnight, 24h, 7day, base_lower, season_lower, base_upper, season_upper
  const snow = {
    overnight_cm: 0,
    snow24_cm: 0,
    snow7day_cm: 0,
    base_lower_cm: 0,
    base_upper_cm: 0,
    season_lower_cm: 0,
    season_upper_cm: 0
  };

  // Extract all snow-height values in order - format: <p class="snow-height">0cm</p>
  const snowHeightRegex = /<p[^>]*class="snow-height"[^>]*>(\d+)cm<\/p>/gi;
  const snowValues = [];
  let match;
  while ((match = snowHeightRegex.exec(html)) !== null) {
    snowValues.push(toNumber(match[1]));
  }

  // Map values to fields based on order (as seen in the page structure)
  if (snowValues.length >= 7) {
    snow.overnight_cm = snowValues[0] || 0;
    snow.snow24_cm = snowValues[1] || 0;
    snow.snow7day_cm = snowValues[2] || 0;
    snow.base_lower_cm = snowValues[3] || 0;
    snow.season_lower_cm = snowValues[4] || 0;
    snow.base_upper_cm = snowValues[5] || 0;
    snow.season_upper_cm = snowValues[6] || 0;
  }

  // Parse temperature - look for °C in the page
  const tempMatch = html.match(/>(-?\d+)\s*°C</i) || html.match(/temperature[^>]*>(-?\d+)/i);
  const temperature_c = tempMatch ? toNumber(tempMatch[1]) : null;

  // Parse lifts
  const lifts = [];
  // Look for lift entries with status - Norquay uses different patterns
  // Common patterns: "North American Chair" with Open/Closed status
  const liftNames = [
    'North American Chair',
    'Cascade Lift',
    'Spirit Chair',
    'Mystic Chair',
    'Sundance Carpet',
    'Tube Park Carpet',
    'Rundle Conveyor'
  ];

  for (const liftName of liftNames) {
    const liftRegex = new RegExp(`${liftName}[^]*?(Open|Closed|On Hold)`, 'i');
    const match = html.match(liftRegex);
    if (match) {
      lifts.push({
        Name: liftName,
        Status: match[1],
        IsOpen: match[1].toLowerCase() === 'open',
        Type: liftName.includes('Carpet') || liftName.includes('Conveyor') ? 'Carpet' : 'Chair'
      });
    }
  }

  // Alternative: parse lift section more generically
  // Look for patterns in the lift status table
  const liftSectionMatch = html.match(/Lift Status[\s\S]*?(<table[\s\S]*?<\/table>)/i);
  if (liftSectionMatch && lifts.length === 0) {
    const liftTableRegex = /<tr[^>]*>[\s\S]*?<td[^>]*>([^<]+)<\/td>[\s\S]*?(Open|Closed|On Hold)/gi;
    let match;
    while ((match = liftTableRegex.exec(liftSectionMatch[1])) !== null) {
      const name = match[1].trim();
      if (name && !lifts.find(l => l.Name === name)) {
        lifts.push({
          Name: name,
          Status: match[2],
          IsOpen: match[2].toLowerCase() === 'open',
          Type: name.includes('Carpet') || name.includes('Conveyor') ? 'Carpet' : 'Chair'
        });
      }
    }
  }

  // Parse trails/runs
  const trails = [];
  // Norquay shows runs with open/closed status and grooming icon
  // This is a simplified parser - the actual HTML structure varies
  const runSectionMatch = html.match(/Run Status[\s\S]*?(\d+)\s*\/\s*(\d+)\s*Open/i);
  const runsOpen = runSectionMatch ? toNumber(runSectionMatch[1]) : 0;
  const runsTotal = runSectionMatch ? toNumber(runSectionMatch[2]) : 0;

  return {
    resort: 'norquay',
    resortName: 'Mt Norquay',
    provider: 'canadian-big3',
    apiProvider: 'wordpress-html',
    scrapedAt: new Date().toISOString(),

    // Terrain data
    Lifts: lifts,
    Trails: trails,
    GroomingAreas: [{
      Name: 'All Terrain',
      Trails: trails,
      Lifts: lifts
    }],

    // Snow data
    snow: {
      overnight_cm: snow.overnight_cm,
      overnight_inches: cmToInches(snow.overnight_cm),
      snow24_cm: snow.snow24_cm,
      snow24_inches: cmToInches(snow.snow24_cm),
      snow48_cm: 0,
      snow48_inches: 0,
      snow7day_cm: snow.snow7day_cm,
      snow7day_inches: cmToInches(snow.snow7day_cm),
      season_cm: Math.max(snow.season_lower_cm, snow.season_upper_cm),
      season_inches: cmToInches(Math.max(snow.season_lower_cm, snow.season_upper_cm)),
      base_lower_cm: snow.base_lower_cm,
      base_lower_inches: cmToInches(snow.base_lower_cm),
      base_upper_cm: snow.base_upper_cm,
      base_upper_inches: cmToInches(snow.base_upper_cm)
    },

    // Current conditions
    conditions: {
      temperature_c,
      temperature_f: celsiusToFahrenheit(temperature_c)
    },

    // Stats
    stats: {
      liftsOpen: lifts.filter(l => l.IsOpen).length,
      liftsTotal: lifts.length,
      trailsOpen: runsOpen,
      trailsTotal: runsTotal,
      trailsGroomed: 0
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUNSHINE VILLAGE (BANFF) - Puppeteer scraper for complete data from skibanff.com
// ═══════════════════════════════════════════════════════════════════════════════

const SKIBANFF_LIFTS_URL = 'https://www.skibanff.com/conditions/';
const SKIBANFF_SNOW_URL = 'https://www.skibanff.com/conditions/';

async function scrapeSunshineVillagePuppeteer(browser) {
  // HYBRID APPROACH: Use Puppeteer for snow data from skibanff.com,
  // and HTTP for lift/trail data from intermaps (which is more reliable for that)

  const page = await browser.newPage();
  let snowData = { overnight_cm: 0, snow24_cm: 0, snow48_cm: 0, snow7day_cm: 0, base_cm: 0, season_cm: 0 };
  let temperature_c = null;

  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Navigate to conditions page for snow data
    await page.goto(SKIBANFF_LIFTS_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('body', { timeout: 30000 });

    // Wait for dynamic content to load
    await new Promise(r => setTimeout(r, 3000));

    // Extract snow data from skibanff.com
    const pageData = await page.evaluate(() => {
      const pageText = document.body.innerText;
      const snow = { overnight_cm: 0, snow24_cm: 0, snow48_cm: 0, snow7day_cm: 0, base_cm: 0, season_cm: 0 };

      // Match patterns for snow amounts
      const snow24Match = pageText.match(/(?:24\s*(?:hr|hour)s?)[:\s]*(\d+)\s*cm/i) ||
                          pageText.match(/(\d+)\s*cm\s*(?:24\s*(?:hr|hour))/i);
      if (snow24Match) snow.snow24_cm = parseInt(snow24Match[1]);

      const snow48Match = pageText.match(/(?:48\s*(?:hr|hour)s?)[:\s]*(\d+)\s*cm/i) ||
                          pageText.match(/(\d+)\s*cm\s*(?:48\s*(?:hr|hour))/i);
      if (snow48Match) snow.snow48_cm = parseInt(snow48Match[1]);

      const snow7dMatch = pageText.match(/(?:7\s*day)[:\s]*(\d+)\s*cm/i) ||
                          pageText.match(/(\d+)\s*cm\s*(?:7\s*day)/i);
      if (snow7dMatch) snow.snow7day_cm = parseInt(snow7dMatch[1]);

      const overnightMatch = pageText.match(/(?:overnight|new\s*snow)[:\s]*(\d+)\s*cm/i);
      if (overnightMatch) snow.overnight_cm = parseInt(overnightMatch[1]);

      const baseMatch = pageText.match(/(?:base|snow\s*base)[:\s]*(\d+)\s*cm/i) ||
                        pageText.match(/(\d+)\s*cm\s*(?:base)/i);
      if (baseMatch) snow.base_cm = parseInt(baseMatch[1]);

      const seasonMatch = pageText.match(/(?:season|ytd|year\s*to\s*date)[:\s]*(\d+)\s*cm/i);
      if (seasonMatch) snow.season_cm = parseInt(seasonMatch[1]);

      const tempMatch = pageText.match(/(-?\d+)\s*°?\s*C(?:elsius)?/i);

      return {
        snow,
        temperature_c: tempMatch ? parseInt(tempMatch[1]) : null
      };
    });

    snowData = pageData.snow;
    temperature_c = pageData.temperature_c;

  } finally {
    await page.close();
  }

  // Now get lift/trail data from intermaps (HTTP-based, more reliable)
  const intermapsData = await scrapeSunshineVillage();

  // Merge the data: intermaps for lifts/trails, Puppeteer for snow
  return {
    resort: 'banff',
    resortName: 'Banff Sunshine Village',
    provider: 'canadian-big3',
    apiProvider: 'hybrid-skibanff-intermaps',
    scrapedAt: new Date().toISOString(),

    // Use intermaps for lift/trail data (it's more accurate)
    Lifts: intermapsData.Lifts,
    Trails: intermapsData.Trails,
    GroomingAreas: intermapsData.GroomingAreas,

    // Use Puppeteer data for snow (intermaps doesn't have this)
    snow: {
      overnight_cm: snowData.overnight_cm,
      overnight_inches: cmToInches(snowData.overnight_cm),
      snow24_cm: snowData.snow24_cm,
      snow24_inches: cmToInches(snowData.snow24_cm),
      snow48_cm: snowData.snow48_cm,
      snow48_inches: cmToInches(snowData.snow48_cm),
      snow7day_cm: snowData.snow7day_cm,
      snow7day_inches: cmToInches(snowData.snow7day_cm),
      season_cm: snowData.season_cm,
      season_inches: cmToInches(snowData.season_cm),
      base_lower_cm: snowData.base_cm,
      base_lower_inches: cmToInches(snowData.base_cm),
      base_upper_cm: snowData.base_cm,
      base_upper_inches: cmToInches(snowData.base_cm)
    },

    conditions: {
      temperature_c: temperature_c,
      temperature_f: celsiusToFahrenheit(temperature_c)
    },

    // Use intermaps stats for lifts/trails
    stats: {
      liftsOpen: intermapsData.stats.liftsOpen,
      liftsTotal: intermapsData.stats.liftsTotal,
      trailsOpen: intermapsData.stats.trailsOpen,
      trailsTotal: intermapsData.stats.trailsTotal,
      trailsGroomed: intermapsData.stats.trailsGroomed
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MT NORQUAY - Puppeteer scraper for complete data
// ═══════════════════════════════════════════════════════════════════════════════

const NORQUAY_CONDITIONS_URL = 'https://banffnorquay.com/winter/conditions/';

async function scrapeNorquayPuppeteer(browser) {
  // HYBRID APPROACH: Puppeteer for lift/trail details, HTTP for snow data
  // The HTTP scraper is already good at parsing snow-height elements

  const page = await browser.newPage();
  let liftData = [];
  let trailData = [];
  let runsOpen = null;
  let runsTotal = null;

  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Navigate to conditions page
    await page.goto(NORQUAY_CONDITIONS_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('body', { timeout: 30000 });

    // Wait for dynamic content
    await new Promise(r => setTimeout(r, 3000));

    // Extract lift and trail data using Puppeteer (better for dynamic content)
    const pageData = await page.evaluate(() => {
      const lifts = [];
      const trails = [];
      const pageText = document.body.innerText;

      // Parse lift status - look for specific Norquay lift names in the page text
      const liftNames = [
        'North American Chair',
        'Cascade Chair',
        'Spirit Chair',
        'Mystic Chair',
        'Sundance Carpet',
        'Tube Park Carpet',
        'Rundle Conveyor'
      ];

      for (const liftName of liftNames) {
        // Look for the lift name followed by Open/Closed status
        const regex = new RegExp(`${liftName}[^]*?(Open|Closed|On Hold)`, 'i');
        const match = pageText.match(regex);
        if (match) {
          lifts.push({
            Name: liftName,
            Status: match[1],
            IsOpen: /open/i.test(match[1]),
            Type: /carpet|conveyor/i.test(liftName) ? 'Carpet' : 'Chair'
          });
        }
      }

      // Also scan status sections more carefully
      document.querySelectorAll('.lift-status-row, .status-row, .lifts-section .row, [class*="lift"]').forEach(el => {
        const text = el.textContent;
        for (const liftName of liftNames) {
          if (text.includes(liftName) && !lifts.find(l => l.Name === liftName)) {
            const isOpen = /open/i.test(text.replace(liftName, ''));
            const isHold = /hold/i.test(text.replace(liftName, ''));
            lifts.push({
              Name: liftName,
              Status: isOpen ? 'Open' : isHold ? 'On Hold' : 'Closed',
              IsOpen: isOpen,
              Type: /carpet|conveyor/i.test(liftName) ? 'Carpet' : 'Chair'
            });
          }
        }
      });

      // Get run counts from summary
      const runsMatch = pageText.match(/(\d+)\s*(?:of|\/)\s*(\d+)\s*(?:runs?|trails?)\s*open/i) ||
                        pageText.match(/(?:runs?|trails?)\s*open[:\s]*(\d+)\s*(?:of|\/)\s*(\d+)/i) ||
                        pageText.match(/Open Runs[\s\S]*?(\d+)\s*\/\s*(\d+)/i);

      return {
        lifts,
        trails,
        runsOpen: runsMatch ? parseInt(runsMatch[1]) : null,
        runsTotal: runsMatch ? parseInt(runsMatch[2]) : null
      };
    });

    liftData = pageData.lifts;
    trailData = pageData.trails;
    runsOpen = pageData.runsOpen;
    runsTotal = pageData.runsTotal;

  } finally {
    await page.close();
  }

  // Get snow data from HTTP scraper (it's already working well for Norquay)
  const httpData = await scrapeNorquay();

  // Merge: use Puppeteer lifts if we found any, otherwise fall back to HTTP
  const lifts = liftData.length > 0 ? liftData : httpData.Lifts;
  const trails = trailData.length > 0 ? trailData : httpData.Trails;

  return {
    resort: 'norquay',
    resortName: 'Mt Norquay',
    provider: 'canadian-big3',
    apiProvider: 'hybrid-wordpress',
    scrapedAt: new Date().toISOString(),

    Lifts: lifts,
    Trails: trails,
    GroomingAreas: [{
      Name: 'All Terrain',
      Trails: trails,
      Lifts: lifts
    }],

    // Use HTTP data for snow (it's reliable)
    snow: httpData.snow,

    conditions: httpData.conditions,

    stats: {
      liftsOpen: lifts.filter(l => l.IsOpen).length,
      liftsTotal: lifts.length || httpData.stats.liftsTotal,
      trailsOpen: runsOpen || httpData.stats.trailsOpen,
      trailsTotal: runsTotal || httpData.stats.trailsTotal,
      trailsGroomed: httpData.stats.trailsGroomed
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

// Main scrape function - uses Puppeteer for Banff/Norquay if browser instance passed
async function scrapeResort(resortKey, browser = null) {
  switch (resortKey) {
    case 'lakelouise':
      // Lake Louise has a great XML API, no need for Puppeteer
      return await scrapeLakeLouise();
    case 'banff':
      // Use Puppeteer for Sunshine Village to get snow data from skibanff.com
      if (browser) {
        try {
          return await scrapeSunshineVillagePuppeteer(browser);
        } catch (e) {
          console.log(`[CANADIAN-BIG3] Puppeteer failed for banff, falling back to HTTP: ${e.message}`);
          return await scrapeSunshineVillage();
        }
      }
      return await scrapeSunshineVillage();
    case 'norquay':
      // Use Puppeteer for Norquay to get complete lift/trail data
      if (browser) {
        try {
          return await scrapeNorquayPuppeteer(browser);
        } catch (e) {
          console.log(`[CANADIAN-BIG3] Puppeteer failed for norquay, falling back to HTTP: ${e.message}`);
          return await scrapeNorquay();
        }
      }
      return await scrapeNorquay();
    default:
      throw new Error(`Unknown Canadian Big3 resort: ${resortKey}`);
  }
}

// Convert terrain data to normalized snow report format
function toSnowReport(data, resortKey, resortName, localDate) {
  const snow = data.snow || {};

  return {
    resort: resortKey,
    resortName: resortName,
    date: localDate,
    timestamp: data.scrapedAt,
    lastUpdated: data.scrapedAt,
    provider: 'canadian-big3',
    apiProvider: data.apiProvider,

    conditions: data.conditions?.upper || data.conditions?.lower || null,
    operatingStatus: data.stats?.liftsOpen > 0 ? 'Open' : 'Closed',

    snowfall: {
      overnight_inches: snow.overnight_inches || 0,
      overnight_cm: snow.overnight_cm || 0,
      '24hour_inches': snow.snow24_inches || 0,
      '24hour_cm': snow.snow24_cm || 0,
      '48hour_inches': snow.snow48_inches || 0,
      '48hour_cm': snow.snow48_cm || 0,
      '7day_inches': snow.snow7day_inches || 0,
      '7day_cm': snow.snow7day_cm || 0,
      season_total_inches: snow.season_inches || 0,
      season_total_cm: snow.season_cm || 0
    },

    baseDepth: {
      inches: snow.base_upper_inches || snow.base_lower_inches || 0,
      cm: snow.base_upper_cm || snow.base_lower_cm || 0,
      lower_inches: snow.base_lower_inches || 0,
      lower_cm: snow.base_lower_cm || 0,
      upper_inches: snow.base_upper_inches || 0,
      upper_cm: snow.base_upper_cm || 0
    },

    terrain: {
      totalTrails: data.stats?.trailsTotal || 0,
      openTrails: data.stats?.trailsOpen || 0,
      groomedTrails: data.stats?.trailsGroomed || 0,
      totalLifts: data.stats?.liftsTotal || 0,
      openLifts: data.stats?.liftsOpen || 0
    },

    currentConditions: {
      temperature_c: data.conditions?.temperature_c,
      temperature_f: data.conditions?.temperature_f
    },

    forecast: data.forecast || null
  };
}

// Convert terrain data to normalized terrain format
function toTerrainData(data, resortKey, resortName, localDate) {
  return {
    ResortId: resortKey,
    Date: data.scrapedAt,
    provider: 'canadian-big3',
    apiProvider: data.apiProvider,
    scrapedAt: data.scrapedAt,
    date: localDate,

    Lifts: data.Lifts || [],
    Trails: data.Trails || [],
    GroomingAreas: data.GroomingAreas || [],

    IsSuccessful: true,

    _snow: data.snow,
    _stats: data.stats,
    _conditions: data.conditions
  };
}

module.exports = {
  scrapeResort,
  scrapeLakeLouise,
  scrapeSunshineVillage,
  scrapeSunshineVillagePuppeteer,
  scrapeNorquay,
  scrapeNorquayPuppeteer,
  toSnowReport,
  toTerrainData,
  cmToInches,
  celsiusToFahrenheit
};
