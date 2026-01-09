/**
 * Health Check Module
 *
 * Checks all data sources and returns any issues found.
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
 * Check Hetzner health via single /health endpoint
 */
async function checkHetznerHealth() {
  const issues = [];
  const baseUrl = `http://${config.hetzner.host}:${config.hetzner.apiPort}`;

  let healthData;

  // Fetch the main health endpoint which contains all scraper data
  try {
    healthData = await fetchJson(`${baseUrl}/health`);
    if (healthData.status !== 'ok') {
      issues.push({
        type: 'api_unhealthy',
        dataType: 'api',
        details: `API health status: ${healthData.status}`,
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
    return issues; // Can't check scrapers if API is unreachable
  }

  // Check each scraper's health from the nested scrapers object
  const scraperTypes = ['lift', 'snow', 'terrain'];

  for (const scraperType of scraperTypes) {
    const scraperHealth = healthData.scrapers?.[scraperType];

    if (!scraperHealth) {
      issues.push({
        type: 'scraper_missing',
        dataType: scraperType,
        details: `No health data for ${scraperType} scraper`,
        severity: 'warning'
      });
      continue;
    }

    // Check each provider within the scraper (ikon, vail, canadianBig3, aspen, etc.)
    const providers = ['ikon', 'vail', 'canadianBig3', 'aspen'].filter(p => scraperHealth[p]);

    for (const provider of providers) {
      const providerHealth = scraperHealth[provider];

      // Check for consecutive failures
      if (providerHealth.consecutiveFailures >= config.thresholds.consecutiveFailuresCritical) {
        issues.push({
          type: 'consecutive_failures',
          dataType: scraperType,
          provider,
          details: `${scraperType}/${provider}: ${providerHealth.consecutiveFailures} consecutive failures`,
          consecutiveFailures: providerHealth.consecutiveFailures,
          severity: 'critical'
        });
      } else if (providerHealth.consecutiveFailures >= config.thresholds.consecutiveFailuresWarning) {
        issues.push({
          type: 'consecutive_failures',
          dataType: scraperType,
          provider,
          details: `${scraperType}/${provider}: ${providerHealth.consecutiveFailures} consecutive failures`,
          consecutiveFailures: providerHealth.consecutiveFailures,
          severity: 'warning'
        });
      }

      // Check for stale data
      if (providerHealth.lastSuccess) {
        const lastSuccess = new Date(providerHealth.lastSuccess);
        const now = new Date();
        const minutesStale = Math.floor((now - lastSuccess) / (1000 * 60));

        const threshold = config.thresholds[`${scraperType}StaleMinutes`];
        if (threshold && minutesStale > threshold) {
          issues.push({
            type: 'stale_data',
            dataType: scraperType,
            provider,
            lastSuccess: providerHealth.lastSuccess,
            minutesStale,
            details: `${scraperType}/${provider}: Data is ${minutesStale} min stale (threshold: ${threshold} min)`,
            severity: minutesStale > threshold * 2 ? 'critical' : 'warning'
          });
        }
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

  // Check Hetzner health
  const hetznerIssues = await checkHetznerHealth();
  allIssues.push(...hetznerIssues);

  // Check GitHub Actions
  const githubIssues = await checkGitHubActions();
  allIssues.push(...githubIssues);

  // Sort by severity (critical first)
  allIssues.sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
  });

  const healthy = allIssues.filter(i => i.severity === 'critical').length === 0;

  console.log(`[Health] Found ${allIssues.length} issues (healthy: ${healthy})`);

  return {
    healthy,
    timestamp: new Date().toISOString(),
    issues: allIssues
  };
}

module.exports = {
  runHealthChecks,
  checkHetznerHealth,
  checkGitHubActions
};
