/**
 * Health Check Module
 *
 * Checks all data sources at the RESORT level and returns any issues found.
 * This is the key to catching real problems - issues happen per-resort, not per-provider.
 *
 * INTELLIGENT ALERTING:
 * - Lift data: Only alert during operating hours (8:30 AM - 4:00 PM local time)
 * - Terrain data: Only alert if stale 24+ hours (runs once per day)
 * - Snow data: Alert if stale 4+ hours (runs every 30 min)
 * - Distinguishes "was working but stopped" (critical) from expected behavior (info)
 */

const config = require('./config');
const fs = require('fs');
const path = require('path');

// GitHub Pages base URL for checking snow/terrain freshness
const GITHUB_PAGES_BASE = 'https://jacobschulman.github.io/ski-run-scraper/data';

// Load resort configuration for timezone info
let resortConfig = { resorts: [] };
try {
  const configPath = path.join(__dirname, '..', 'config.json');
  resortConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.log('[Health] Could not load config.json for timezone info');
}

// Build resort lookup by key
const RESORTS_BY_KEY = resortConfig.resorts.reduce((acc, r) => {
  acc[r.key] = r;
  return acc;
}, {});

/**
 * Get current hour in resort's local timezone (0-23)
 */
function getResortLocalHour(resortKey) {
  const resort = RESORTS_BY_KEY[resortKey];
  const timezone = resort?.timezone || 'America/Denver';
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false
    });
    return parseInt(formatter.format(new Date()), 10);
  } catch (e) {
    return new Date().getUTCHours(); // Fallback
  }
}

/**
 * Check if resort is in operating hours
 * Default: 8:30 AM - 4:00 PM (we use 8-17 to be generous)
 */
function isResortInOperatingHours(resortKey) {
  const resort = RESORTS_BY_KEY[resortKey];
  const operatingHours = resort?.operatingHours || { open: 8, close: 17 };
  const currentHour = getResortLocalHour(resortKey);
  return currentHour >= operatingHours.open && currentHour < operatingHours.close;
}

/**
 * Check if resort is in season
 */
function isResortInSeason(resortKey) {
  const resort = RESORTS_BY_KEY[resortKey];
  if (!resort) return true; // Assume in season if unknown

  const timezone = resort.timezone || 'America/Denver';
  const now = new Date();

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: '2-digit',
      day: '2-digit'
    });
    const localDate = formatter.format(now);
    const [month, day] = localDate.split('/').map(Number);

    const seasonStart = resort.seasonStart || resortConfig.schedule?.defaultSeasonStart || '11-01';
    const seasonEnd = resort.seasonEnd || resortConfig.schedule?.defaultSeasonEnd || '05-01';

    const [startMonth, startDay] = seasonStart.split('-').map(Number);
    const [endMonth, endDay] = seasonEnd.split('-').map(Number);

    // Season crosses year boundary (e.g., Nov-Apr)
    if (startMonth > endMonth) {
      return (month > startMonth || (month === startMonth && day >= startDay)) ||
             (month < endMonth || (month === endMonth && day < endDay));
    } else {
      return (month > startMonth || (month === startMonth && day >= startDay)) &&
             (month < endMonth || (month === endMonth && day < endDay));
    }
  } catch (e) {
    return true;
  }
}

/**
 * Fetch JSON from a URL with timeout
 */
async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Check if a resort should have lift data (some resorts only have snow/terrain)
 */
function resortHasLiftData(resortData) {
  return resortData.lifts !== undefined;
}

/**
 * Check Hetzner health - both API-level and per-resort
 */
async function checkHetznerHealth() {
  const issues = [];
  const baseUrl = `http://${config.hetzner.host}:${config.hetzner.apiPort}`;

  // First check if API is reachable
  let mainHealth;
  try {
    mainHealth = await fetchJson(`${baseUrl}/health`);
    console.log(`[Health] Hetzner: API reachable, status=${mainHealth.status}`);
    if (mainHealth.status !== 'ok') {
      issues.push({
        type: 'api_unhealthy',
        dataType: 'api',
        source: 'hetzner',
        details: `API health status: ${mainHealth.status}`,
        severity: 'critical'
      });
    }
  } catch (error) {
    issues.push({
      type: 'api_unreachable',
      dataType: 'api',
      source: 'hetzner',
      details: `Cannot reach API: ${error.message}`,
      severity: 'critical'
    });
    return issues; // Can't check anything else if API is down
  }

  // Check provider-level consecutive failures (scraper-wide issues)
  const scraperTypes = ['lift', 'snow', 'terrain'];
  for (const scraperType of scraperTypes) {
    const scraperHealth = mainHealth.scrapers?.[scraperType];
    if (!scraperHealth) continue;

    const providers = ['ikon', 'vail', 'canadianBig3', 'aspen'].filter(p => scraperHealth[p]);
    for (const provider of providers) {
      const providerHealth = scraperHealth[provider];
      if (providerHealth.consecutiveFailures >= config.thresholds.consecutiveFailuresCritical) {
        issues.push({
          type: 'provider_failing',
          dataType: scraperType,
          source: 'hetzner',
          provider,
          details: `${scraperType}/${provider}: ${providerHealth.consecutiveFailures} consecutive failures`,
          consecutiveFailures: providerHealth.consecutiveFailures,
          severity: 'critical'
        });
      }
    }
  }

  // Now check per-resort data freshness - THIS IS THE KEY CHECK
  let resortHealth;
  try {
    resortHealth = await fetchJson(`${baseUrl}/health/resorts`);
    const resortCount = Object.keys(resortHealth.resorts || {}).length;
    console.log(`[Health] Hetzner: Loaded health data for ${resortCount} resorts`);
  } catch (error) {
    issues.push({
      type: 'resort_health_unavailable',
      dataType: 'api',
      source: 'hetzner',
      details: `Cannot fetch resort health: ${error.message}`,
      severity: 'warning'
    });
    return issues;
  }

  const now = new Date();

  for (const [resortId, resortData] of Object.entries(resortHealth.resorts || {})) {
    // Skip resorts that are out of season
    if (!isResortInSeason(resortId)) {
      continue;
    }

    const inOperatingHours = isResortInOperatingHours(resortId);

    // Check lift data freshness (only for resorts that have lift data)
    // INTELLIGENT: Only alert during operating hours - lifts don't update when closed
    if (resortHasLiftData(resortData)) {
      const lastModified = new Date(resortData.lifts.lastModified);
      const minutesStale = Math.floor((now - lastModified) / (1000 * 60));

      if (minutesStale > config.thresholds.liftStaleMinutes) {
        // Only report as issue if resort is in operating hours
        // Outside operating hours, stale lift data is expected (resort is closed)
        if (inOperatingHours) {
          issues.push({
            type: 'resort_stale_lifts',
            dataType: 'lifts',
            source: 'hetzner',
            resort: resortId,
            lastModified: resortData.lifts.lastModified,
            minutesStale,
            details: `${resortId}: Lift data ${minutesStale} min stale (during operating hours)`,
            severity: minutesStale > config.thresholds.liftStaleMinutes * 2 ? 'critical' : 'warning'
          });
        }
        // If outside operating hours, we silently skip - this is expected
      }
    }

    // Check snow data freshness
    // Snow data should update every 30 min regardless of operating hours
    if (resortData.snow?.lastScraped) {
      const lastScraped = new Date(resortData.snow.lastScraped);
      const minutesStale = Math.floor((now - lastScraped) / (1000 * 60));

      if (minutesStale > config.thresholds.snowStaleMinutes) {
        issues.push({
          type: 'resort_stale_snow',
          dataType: 'snow',
          source: 'hetzner',
          resort: resortId,
          lastScraped: resortData.snow.lastScraped,
          minutesStale,
          details: `${resortId}: Snow data ${minutesStale} min stale on Hetzner`,
          severity: minutesStale > config.thresholds.snowStaleMinutes * 2 ? 'critical' : 'warning'
        });
      }
    }

    // Check terrain data freshness
    // INTELLIGENT: Terrain runs once per day (7-10 AM local), so threshold should be 24+ hours
    // Only alert if terrain data is more than 24 hours old
    if (resortData.terrain?.lastScraped) {
      const lastScraped = new Date(resortData.terrain.lastScraped);
      const minutesStale = Math.floor((now - lastScraped) / (1000 * 60));
      const hoursStale = minutesStale / 60;

      // Terrain is scraped once daily - only alert if > 24 hours stale
      // This prevents false alerts when terrain was scraped this morning
      const terrainThresholdHours = 24;
      if (hoursStale > terrainThresholdHours) {
        issues.push({
          type: 'resort_stale_terrain',
          dataType: 'terrain',
          source: 'hetzner',
          resort: resortId,
          lastScraped: resortData.terrain.lastScraped,
          minutesStale,
          hoursStale: Math.round(hoursStale),
          details: `${resortId}: Terrain data ${Math.round(hoursStale)}h stale on Hetzner`,
          // Critical if more than 48 hours old
          severity: hoursStale > 48 ? 'critical' : 'warning'
        });
      }
    }
  }

  return issues;
}

/**
 * Check for gaps in lift data scraping
 * Looks at the actual NDJSON files to find periods where scrapes didn't happen
 * NOTE: Only runs on Hetzner where scrapers write local files. Skipped in Docker.
 */
async function checkLiftScrapeGaps() {
  const issues = [];

  // Skip this check if running in Docker (no local scraper data)
  if (process.env.LIFTIE_DOCKER === 'true') {
    return issues;
  }

  const now = new Date();
  const today = now.toISOString().split('T')[0]; // YYYY-MM-DD

  // Get the list of resorts that are actively being scraped for lift data
  // from config.json liftScraping section (source of truth)
  const enabledVailResorts = new Set(resortConfig.liftScraping?.vail?.enabledResorts || []);
  const enabledIkonProviders = new Set(resortConfig.liftScraping?.ikon?.enabledProviders || []);

  // Build set of Ikon resorts based on enabled providers
  const enabledIkonResorts = new Set();
  for (const resort of resortConfig.resorts) {
    if (resort.provider === 'ikon') {
      const apiProvider = resort.apiProvider || 'inspector';
      if (enabledIkonProviders.has(apiProvider)) {
        enabledIkonResorts.add(resort.key);
      }
    }
  }

  // Get list of resorts that should have lift data
  const liftsDir = path.join(__dirname, '..', 'data');

  try {
    const resortDirs = fs.readdirSync(liftsDir).filter(d => {
      const stat = fs.statSync(path.join(liftsDir, d));
      return stat.isDirectory() && !d.startsWith('.');
    });

    for (const resortId of resortDirs) {
      // Skip if resort is not actively being scraped
      const resort = RESORTS_BY_KEY[resortId];
      const provider = resort?.provider || 'vail';
      if (provider === 'vail' && !enabledVailResorts.has(resortId)) continue;
      if (provider === 'ikon' && !enabledIkonResorts.has(resortId)) continue;

      // Skip if resort is not in operating hours
      if (!isResortInOperatingHours(resortId)) continue;
      if (!isResortInSeason(resortId)) continue;

      const liftsPath = path.join(liftsDir, resortId, 'lifts', `${today}.ndjson`);
      if (!fs.existsSync(liftsPath)) continue;

      try {
        const content = fs.readFileSync(liftsPath, 'utf-8');
        const lines = content.trim().split('\n').filter(l => l.trim());

        if (lines.length < 2) continue;

        // Parse timestamps from each line
        const timestamps = [];
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.timestamp) {
              timestamps.push(new Date(data.timestamp));
            }
          } catch (e) {
            // Skip malformed lines
          }
        }

        if (timestamps.length < 2) continue;

        // Sort timestamps and find gaps
        timestamps.sort((a, b) => a - b);

        const gapThresholdMinutes = 30; // Alert if gap > 30 min during operating hours
        const gaps = [];

        for (let i = 1; i < timestamps.length; i++) {
          const gapMinutes = (timestamps[i] - timestamps[i - 1]) / (1000 * 60);
          if (gapMinutes > gapThresholdMinutes) {
            gaps.push({
              start: timestamps[i - 1],
              end: timestamps[i],
              minutes: Math.round(gapMinutes)
            });
          }
        }

        // Also check gap from last timestamp to now (if resort is open)
        const lastTimestamp = timestamps[timestamps.length - 1];
        const minutesSinceLast = (now - lastTimestamp) / (1000 * 60);
        if (minutesSinceLast > gapThresholdMinutes) {
          gaps.push({
            start: lastTimestamp,
            end: now,
            minutes: Math.round(minutesSinceLast),
            ongoing: true
          });
        }

        if (gaps.length > 0) {
          const worstGap = gaps.reduce((max, g) => g.minutes > max.minutes ? g : max, gaps[0]);
          issues.push({
            type: 'lift_scrape_gaps',
            dataType: 'lifts',
            source: 'local-data',
            resort: resortId,
            gapCount: gaps.length,
            worstGapMinutes: worstGap.minutes,
            details: `${resortId}: ${gaps.length} scrape gap(s) today, worst: ${worstGap.minutes}m${worstGap.ongoing ? ' (ongoing)' : ''}`,
            severity: worstGap.minutes > 60 ? 'critical' : 'warning'
          });
        }
      } catch (e) {
        // Skip resorts we can't read
      }
    }
  } catch (e) {
    console.log(`[Health] Could not check lift scrape gaps: ${e.message}`);
  }

  return issues;
}

/**
 * Check for missing resorts - resorts in config that have no recent data
 */
async function checkMissingResorts() {
  const issues = [];

  // Get expected resorts from config
  const expectedResorts = resortConfig.resorts
    .filter(r => isResortInSeason(r.key))
    .map(r => r.key);

  if (expectedResorts.length === 0) {
    console.log('[Health] No resorts in config to check');
    return issues;
  }

  // Check what resorts actually have data in latest-snow.json (GitHub Pages)
  try {
    const snowData = await fetchJson(`${GITHUB_PAGES_BASE}/latest-snow.json`);
    const resortsWithSnow = new Set(Object.keys(snowData));

    for (const resortKey of expectedResorts) {
      const resort = RESORTS_BY_KEY[resortKey];
      // Only check resorts that have snowReportUrl configured (meaning they should have snow data)
      const shouldHaveSnow = !!resort?.snowReportUrl;
      if (shouldHaveSnow && !resortsWithSnow.has(resortKey)) {
        issues.push({
          type: 'resort_missing_from_source',
          dataType: 'snow',
          source: 'github-pages',
          resort: resortKey,
          details: `${resortKey}: Has snowReportUrl in config but missing from GitHub Pages snow data`,
          severity: 'warning'
        });
      }
    }
  } catch (e) {
    // Already handled in checkGitHubPagesHealth
  }

  // Check what resorts actually have data in latest.json (terrain)
  try {
    const terrainData = await fetchJson(`${GITHUB_PAGES_BASE}/latest.json`);
    const resortsWithTerrain = new Set(Object.keys(terrainData));

    for (const resortKey of expectedResorts) {
      const resort = RESORTS_BY_KEY[resortKey];
      // Only check resorts that have terrainUrl configured (meaning they should have terrain data)
      const shouldHaveTerrain = !!resort?.terrainUrl;
      if (shouldHaveTerrain && !resortsWithTerrain.has(resortKey)) {
        issues.push({
          type: 'resort_missing_from_source',
          dataType: 'terrain',
          source: 'github-pages',
          resort: resortKey,
          details: `${resortKey}: Has terrainUrl in config but missing from GitHub Pages terrain data`,
          severity: 'warning'
        });
      }
    }
  } catch (e) {
    // Already handled in checkGitHubPagesHealth
  }

  return issues;
}

/**
 * Check GitHub Pages for snow/terrain data freshness
 * This monitors the GitHub Actions pipeline output (parallel to Hetzner)
 */
async function checkGitHubPagesHealth() {
  const issues = [];
  const now = new Date();

  // Check snow data freshness from latest-snow.json
  try {
    const snowData = await fetchJson(`${GITHUB_PAGES_BASE}/latest-snow.json`);
    console.log(`[Health] GitHub Pages: Loaded snow data for ${Object.keys(snowData).length} resorts`);

    for (const [resortId, resortData] of Object.entries(snowData)) {
      // Skip if not in season
      if (!isResortInSeason(resortId)) continue;

      // Get timestamp from snow data
      const timestamp = resortData.data?.timestamp;
      if (!timestamp) continue;

      const lastScraped = new Date(timestamp);
      const minutesStale = Math.floor((now - lastScraped) / (1000 * 60));

      if (minutesStale > config.thresholds.snowStaleMinutes) {
        issues.push({
          type: 'resort_stale_snow',
          dataType: 'snow',
          source: 'github-pages',
          resort: resortId,
          lastScraped: timestamp,
          minutesStale,
          details: `${resortId}: Snow ${minutesStale}m stale on GitHub Pages`,
          severity: minutesStale > config.thresholds.snowStaleMinutes * 2 ? 'critical' : 'warning'
        });
      }
    }
  } catch (error) {
    issues.push({
      type: 'github_pages_unreachable',
      dataType: 'snow',
      source: 'github-pages',
      details: `Cannot fetch snow from GitHub Pages: ${error.message}`,
      severity: 'warning'  // Warning not critical - Hetzner might still be OK
    });
  }

  // Check terrain data freshness from latest.json
  try {
    const terrainData = await fetchJson(`${GITHUB_PAGES_BASE}/latest.json`);
    console.log(`[Health] GitHub Pages: Loaded terrain data for ${Object.keys(terrainData).length} resorts`);

    for (const [resortId, resortData] of Object.entries(terrainData)) {
      if (!isResortInSeason(resortId)) continue;

      // Get Date from terrain data (ISO 8601 with timezone)
      const dateStr = resortData.data?.Date;
      if (!dateStr) continue;

      const lastScraped = new Date(dateStr);
      const minutesStale = Math.floor((now - lastScraped) / (1000 * 60));
      const hoursStale = minutesStale / 60;

      // Terrain is scraped once daily - only alert if > 24 hours stale
      const terrainThresholdHours = 24;
      if (hoursStale > terrainThresholdHours) {
        issues.push({
          type: 'resort_stale_terrain',
          dataType: 'terrain',
          source: 'github-pages',
          resort: resortId,
          lastScraped: dateStr,
          minutesStale,
          hoursStale: Math.round(hoursStale),
          details: `${resortId}: Terrain ${Math.round(hoursStale)}h stale on GitHub Pages`,
          severity: hoursStale > 48 ? 'critical' : 'warning'
        });
      }
    }
  } catch (error) {
    issues.push({
      type: 'github_pages_unreachable',
      dataType: 'terrain',
      source: 'github-pages',
      details: `Cannot fetch terrain from GitHub Pages: ${error.message}`,
      severity: 'warning'
    });
  }

  return issues;
}

/**
 * Check GitHub Actions workflow status
 */
async function checkGitHubActions() {
  const issues = [];

  // Only check if we have a GitHub token
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log('[Health] No GITHUB_TOKEN, skipping workflow checks');
    return issues;
  }

  const workflows = [
    'daily-scrape.yml',
    'lift-scraper.yml',
    'snow-scraper.yml'
  ];

  for (const workflow of workflows) {
    try {
      const url = `https://api.github.com/repos/${config.github.owner}/${config.github.repo}/actions/workflows/${workflow}/runs?per_page=5`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) continue;

      const data = await response.json();
      const recentRuns = data.workflow_runs || [];

      // Check for consecutive failures
      let consecutiveFailures = 0;
      for (const run of recentRuns) {
        if (run.conclusion === 'failure') {
          consecutiveFailures++;
        } else if (run.conclusion === 'success') {
          break;
        }
      }

      if (consecutiveFailures >= 3) {
        issues.push({
          type: 'github_action_failing',
          dataType: 'workflow',
          workflow,
          details: `${consecutiveFailures} consecutive workflow failures`,
          consecutiveFailures,
          severity: 'critical'
        });
      }
    } catch (error) {
      console.log(`[Health] Could not check ${workflow}: ${error.message}`);
    }
  }

  return issues;
}

/**
 * Check scraper config validation - ensures scrapers are loading correct config
 * This catches issues like loading a stale config.json from wrong directory
 */
async function checkScraperConfigHealth() {
  const issues = [];
  const baseUrl = `http://${config.hetzner.host}:${config.hetzner.apiPort}`;

  try {
    const mainHealth = await fetchJson(`${baseUrl}/health`);

    // Check each scraper type
    for (const scraperType of ['lift', 'snow', 'terrain']) {
      const scraperHealth = mainHealth.scrapers?.[scraperType];
      if (!scraperHealth) continue;

      // Expected providers that should have resorts
      const expectedProviders = {
        snow: ['ikon', 'vail', 'canadianBig3', 'aspen'],
        terrain: ['ikon', 'vail', 'aspen', 'canadianBig3'],
        lift: ['ikon', 'vail']
      };

      const providers = expectedProviders[scraperType] || [];
      for (const provider of providers) {
        const providerHealth = scraperHealth[provider];
        if (!providerHealth) {
          // Provider completely missing from health - config issue
          issues.push({
            type: 'config_missing_provider',
            dataType: scraperType,
            source: 'hetzner',
            provider,
            details: `${scraperType} scraper missing provider '${provider}' - likely wrong config loaded`,
            severity: 'critical'
          });
        } else if (providerHealth.totalRuns > 5 && providerHealth.resortsScraped === 0) {
          // Provider exists but never scraped any resorts - config issue
          issues.push({
            type: 'config_no_resorts_scraped',
            dataType: scraperType,
            source: 'hetzner',
            provider,
            details: `${scraperType}/${provider}: ${providerHealth.totalRuns} runs but 0 resorts scraped - check config`,
            severity: 'critical'
          });
        }
      }
    }
  } catch (error) {
    // Don't fail on config check errors, main health check handles API issues
    console.log(`[Health] Config validation check failed: ${error.message}`);
  }

  return issues;
}

/**
 * Check data quality - validates actual content, not just freshness
 * Catches issues like:
 * - Empty arrays when data should exist
 * - Stats vs parsed data mismatches
 * - Wrong data types (terrain file containing snow data)
 * - Missing key fields for each data type
 */
async function checkDataQuality() {
  const issues = [];

  // ═══════════════════════════════════════════════════════════════════════════
  // TERRAIN DATA QUALITY
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    const terrainData = await fetchJson(`${GITHUB_PAGES_BASE}/latest.json`);
    console.log(`[Health] Checking terrain quality for ${Object.keys(terrainData).length} resorts`);

    for (const [resortId, resortData] of Object.entries(terrainData)) {
      if (!isResortInSeason(resortId)) continue;

      const data = resortData.data;
      if (!data) {
        issues.push({
          type: 'data_quality_missing_data',
          dataType: 'terrain',
          source: 'github-pages',
          resort: resortId,
          details: `${resortId}: Terrain entry exists but data is null/empty`,
          severity: 'critical'
        });
        continue;
      }

      const trails = data.Trails || [];
      const lifts = data.Lifts || [];
      const stats = data.stats || {};

      // Check 1: Empty Trails array but stats show trails exist
      if (trails.length === 0 && (stats.trailsOpen > 0 || stats.trailsTotal > 0)) {
        issues.push({
          type: 'data_quality_empty_trails',
          dataType: 'terrain',
          source: 'github-pages',
          resort: resortId,
          details: `${resortId}: Trails[] empty but stats show ${stats.trailsOpen || 0}/${stats.trailsTotal || 0} trails - parser broken`,
          severity: 'critical'
        });
      }

      // Check 2: Empty Lifts array but stats show lifts exist
      if (lifts.length === 0 && (stats.liftsOpen > 0 || stats.liftsTotal > 0)) {
        issues.push({
          type: 'data_quality_empty_lifts',
          dataType: 'terrain',
          source: 'github-pages',
          resort: resortId,
          details: `${resortId}: Lifts[] empty but stats show ${stats.liftsOpen || 0}/${stats.liftsTotal || 0} lifts - parser broken`,
          severity: 'critical'
        });
      }

      // Check 3: Stats vs parsed array mismatch
      if (trails.length > 0 && stats.trailsTotal > 0) {
        const parsedOpen = trails.filter(t => t.IsOpen || t.Status === 'Open').length;
        const diff = Math.abs(parsedOpen - (stats.trailsOpen || 0));
        const percentDiff = stats.trailsOpen > 0 ? diff / stats.trailsOpen : 0;
        if (diff > 5 && percentDiff > 0.2) {
          issues.push({
            type: 'data_quality_stats_mismatch',
            dataType: 'terrain',
            source: 'github-pages',
            resort: resortId,
            details: `${resortId}: Stats=${stats.trailsOpen} open, parsed=${parsedOpen} - mismatch`,
            severity: 'warning'
          });
        }
      }

      // Check 4: Terrain data containing snow fields (wrong data echoed)
      const snowFields = ['snowfall24', 'snowfall48', 'baseDepth', 'snowCondition', 'freshSnow'];
      const hasSnowFields = snowFields.some(f => data[f] !== undefined);
      const missingTerrainFields = !data.Trails && !data.Lifts && !data.stats;
      if (hasSnowFields && missingTerrainFields) {
        issues.push({
          type: 'data_quality_wrong_data_type',
          dataType: 'terrain',
          source: 'github-pages',
          resort: resortId,
          details: `${resortId}: Terrain file contains snow data fields - wrong data written`,
          severity: 'critical'
        });
      }

      // Check 5: Completely empty during operating hours
      // A resort that's open should have SOME data
      if (trails.length === 0 && lifts.length === 0 && !stats.trailsTotal && !stats.liftsTotal) {
        if (isResortInOperatingHours(resortId)) {
          issues.push({
            type: 'data_quality_no_terrain_data',
            dataType: 'terrain',
            source: 'github-pages',
            resort: resortId,
            details: `${resortId}: No trails, lifts, or stats during operating hours - scraper broken`,
            severity: 'critical'
          });
        }
      }
    }
  } catch (error) {
    console.log(`[Health] Terrain quality check failed: ${error.message}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SNOW DATA QUALITY
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    const snowData = await fetchJson(`${GITHUB_PAGES_BASE}/latest-snow.json`);
    console.log(`[Health] Checking snow quality for ${Object.keys(snowData).length} resorts`);

    // Key fields that snow data should have (at least some of these)
    const expectedSnowFields = ['baseDepth', 'snowfall24', 'snowfall48', 'seasonTotal', 'surfaceCondition'];

    for (const [resortId, resortData] of Object.entries(snowData)) {
      if (!isResortInSeason(resortId)) continue;

      const data = resortData.data;
      if (!data) {
        issues.push({
          type: 'data_quality_missing_data',
          dataType: 'snow',
          source: 'github-pages',
          resort: resortId,
          details: `${resortId}: Snow entry exists but data is null/empty`,
          severity: 'critical'
        });
        continue;
      }

      // Check: Snow data should have at least one meaningful snow field
      const hasSnowFields = expectedSnowFields.some(f => data[f] !== undefined && data[f] !== null);

      if (!hasSnowFields) {
        // Check if it looks like terrain data was written instead
        if (data.Trails || data.Lifts || data.stats) {
          issues.push({
            type: 'data_quality_wrong_data_type',
            dataType: 'snow',
            source: 'github-pages',
            resort: resortId,
            details: `${resortId}: Snow file contains terrain data fields - wrong data written`,
            severity: 'critical'
          });
        } else {
          issues.push({
            type: 'data_quality_no_snow_data',
            dataType: 'snow',
            source: 'github-pages',
            resort: resortId,
            details: `${resortId}: Snow data missing key fields (baseDepth, snowfall, etc.)`,
            severity: 'warning'
          });
        }
      }

      // Check for suspiciously empty snow data
      // If baseDepth is 0 at an operating resort mid-season, likely a scrape failure
      if (data.baseDepth === 0 && isResortInOperatingHours(resortId)) {
        // Only flag if we're in prime season (Dec-Mar)
        const now = new Date();
        const month = now.getMonth() + 1;
        if (month >= 12 || month <= 3) {
          issues.push({
            type: 'data_quality_suspicious_zero',
            dataType: 'snow',
            source: 'github-pages',
            resort: resortId,
            details: `${resortId}: baseDepth=0 during peak season - likely scrape failure`,
            severity: 'warning'
          });
        }
      }
    }
  } catch (error) {
    console.log(`[Health] Snow quality check failed: ${error.message}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFT DATA QUALITY (from Hetzner)
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    const baseUrl = `http://${config.hetzner.host}:${config.hetzner.apiPort}`;
    const resortHealth = await fetchJson(`${baseUrl}/health/resorts`);

    for (const [resortId, resortData] of Object.entries(resortHealth.resorts || {})) {
      if (!isResortInSeason(resortId)) continue;
      if (!resortData.lifts) continue; // Skip resorts without lift data

      // Check for suspicious lift data patterns
      const liftInfo = resortData.lifts;

      // If we have a file but very few entries, might be broken
      if (liftInfo.fileCount && liftInfo.fileCount < 5 && isResortInOperatingHours(resortId)) {
        // Resort should have many scrapes by mid-day
        const localHour = getResortLocalHour(resortId);
        if (localHour >= 12) { // After noon
          issues.push({
            type: 'data_quality_sparse_lift_data',
            dataType: 'lifts',
            source: 'hetzner',
            resort: resortId,
            details: `${resortId}: Only ${liftInfo.fileCount} lift entries after noon - scraper may be struggling`,
            severity: 'warning'
          });
        }
      }
    }
  } catch (error) {
    console.log(`[Health] Lift quality check failed: ${error.message}`);
  }

  return issues;
}

/**
 * Run all health checks and return consolidated results
 */
async function runHealthChecks() {
  console.log('[Health] Running health checks...');

  const allIssues = [];

  // Check Hetzner for ALL data (lifts, snow, terrain)
  const hetznerIssues = await checkHetznerHealth();
  allIssues.push(...hetznerIssues);

  // ALSO check GitHub Pages for snow + terrain (parallel pipeline)
  const githubPagesIssues = await checkGitHubPagesHealth();
  allIssues.push(...githubPagesIssues);

  // Check scraper config validation (catches wrong config loading)
  const configIssues = await checkScraperConfigHealth();
  allIssues.push(...configIssues);

  // Check GitHub Actions workflows
  const githubIssues = await checkGitHubActions();
  allIssues.push(...githubIssues);

  // Check for scrape gaps in lift data (local NDJSON files)
  const gapIssues = await checkLiftScrapeGaps();
  allIssues.push(...gapIssues);

  // Check for missing resorts (expected in config but not in data)
  const missingIssues = await checkMissingResorts();
  allIssues.push(...missingIssues);

  // Check data quality (empty arrays, stats mismatches, wrong data types)
  const qualityIssues = await checkDataQuality();
  allIssues.push(...qualityIssues);

  // Sort by severity (critical first), then by resort name
  allIssues.sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    const severityDiff = (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
    if (severityDiff !== 0) return severityDiff;
    return (a.resort || '').localeCompare(b.resort || '');
  });

  const criticalCount = allIssues.filter(i => i.severity === 'critical').length;
  const warningCount = allIssues.filter(i => i.severity === 'warning').length;
  const healthy = criticalCount === 0;

  console.log(`[Health] Found ${allIssues.length} issues (${criticalCount} critical, ${warningCount} warnings)`);

  return {
    healthy,
    timestamp: new Date().toISOString(),
    summary: {
      critical: criticalCount,
      warning: warningCount,
      total: allIssues.length
    },
    issues: allIssues
  };
}

module.exports = {
  runHealthChecks,
  checkHetznerHealth,
  checkGitHubPagesHealth,
  checkGitHubActions,
  checkScraperConfigHealth,
  checkLiftScrapeGaps,
  checkMissingResorts,
  checkDataQuality
};
