/**
 * Health Check Module
 *
 * Checks all data sources at the RESORT level and returns any issues found.
 * This is the key to catching real problems - issues happen per-resort, not per-provider.
 */

const config = require('./config');

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
    // Check lift data freshness (only for resorts that have lift data)
    if (resortHasLiftData(resortData)) {
      const lastModified = new Date(resortData.lifts.lastModified);
      const minutesStale = Math.floor((now - lastModified) / (1000 * 60));

      if (minutesStale > config.thresholds.liftStaleMinutes) {
        issues.push({
          type: 'resort_stale_lifts',
          dataType: 'lifts',
          resort: resortId,
          lastModified: resortData.lifts.lastModified,
          minutesStale,
          details: `${resortId}: Lift data ${minutesStale} min stale (threshold: ${config.thresholds.liftStaleMinutes} min)`,
          severity: minutesStale > config.thresholds.liftStaleMinutes * 2 ? 'critical' : 'warning'
        });
      }
    }

    // Check snow data freshness
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
    if (resortData.terrain?.lastScraped) {
      const lastScraped = new Date(resortData.terrain.lastScraped);
      const minutesStale = Math.floor((now - lastScraped) / (1000 * 60));

      if (minutesStale > config.thresholds.terrainStaleMinutes) {
        issues.push({
          type: 'resort_stale_terrain',
          dataType: 'terrain',
          resort: resortId,
          lastScraped: resortData.terrain.lastScraped,
          minutesStale,
          details: `${resortId}: Terrain data ${minutesStale} min stale (threshold: ${config.thresholds.terrainStaleMinutes} min)`,
          severity: minutesStale > config.thresholds.terrainStaleMinutes * 2 ? 'critical' : 'warning'
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
 * Run all health checks and return consolidated results
 */
async function runHealthChecks() {
  console.log('[Health] Running health checks...');

  const allIssues = [];

  // Check Hetzner health (API + per-resort)
  const hetznerIssues = await checkHetznerHealth();
  allIssues.push(...hetznerIssues);

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
  checkGitHubActions
};
