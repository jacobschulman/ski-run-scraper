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
    if (mainHealth.status !== 'ok') {
      issues.push({
        type: 'api_unhealthy',
        dataType: 'api',
        details: `API health status: ${mainHealth.status}`,
        severity: 'critical'
      });
    }
  } catch (error) {
    issues.push({
      type: 'api_unreachable',
      dataType: 'api',
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
  } catch (error) {
    issues.push({
      type: 'resort_health_unavailable',
      dataType: 'api',
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
          resort: resortId,
          lastScraped: resortData.snow.lastScraped,
          minutesStale,
          details: `${resortId}: Snow data ${minutesStale} min stale (threshold: ${config.thresholds.snowStaleMinutes} min)`,
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
          resort: resortId,
          lastScraped: resortData.terrain.lastScraped,
          minutesStale,
          hoursStale: Math.round(hoursStale),
          details: `${resortId}: Terrain data ${Math.round(hoursStale)} hours stale (threshold: ${terrainThresholdHours}h)`,
          // Critical if more than 48 hours old
          severity: hoursStale > 48 ? 'critical' : 'warning'
        });
      }
    }
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
            provider,
            details: `${scraperType} scraper missing provider '${provider}' - likely wrong config loaded`,
            severity: 'critical'
          });
        } else if (providerHealth.totalRuns > 5 && providerHealth.resortsScraped === 0) {
          // Provider exists but never scraped any resorts - config issue
          issues.push({
            type: 'config_no_resorts_scraped',
            dataType: scraperType,
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
 * Run all health checks and return consolidated results
 */
async function runHealthChecks() {
  console.log('[Health] Running health checks...');

  const allIssues = [];

  // Check Hetzner health (API + per-resort)
  const hetznerIssues = await checkHetznerHealth();
  allIssues.push(...hetznerIssues);

  // Check scraper config validation (catches wrong config loading)
  const configIssues = await checkScraperConfigHealth();
  allIssues.push(...configIssues);

  // Check GitHub Actions
  const githubIssues = await checkGitHubActions();
  allIssues.push(...githubIssues);

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
  checkGitHubActions,
  checkScraperConfigHealth
};
