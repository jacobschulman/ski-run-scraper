#!/usr/bin/env node

/**
 * Liftie - Ski Scraper Monitor Agent
 *
 * Main entry point. Runs health checks and spawns the fixer agent when issues are detected.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { runHealthChecks } = require('./health-check');
const { runFixerAgent } = require('./fixer-agent');
const {
  notifyIssueDetected,
  notifyIssueFixed,
  notifyNeedsHelp,
  notifyStatus
} = require('./discord');
const config = require('./config');

const REPO_ROOT = path.resolve(__dirname, '..');
const LOCK_FILE = path.join(REPO_ROOT, 'liftie', '.liftie.lock');
const STATE_FILE = path.join(REPO_ROOT, 'liftie', '.liftie-state.json');

/**
 * Check if another Liftie instance is running
 */
function acquireLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
      const lockAge = Date.now() - lockData.timestamp;

      // If lock is older than 10 minutes, assume it's stale
      if (lockAge < 10 * 60 * 1000) {
        console.log('[Lock] Another Liftie instance is running. Exiting.');
        return false;
      }
      console.log('[Lock] Found stale lock, removing...');
    }

    fs.writeFileSync(LOCK_FILE, JSON.stringify({
      pid: process.pid,
      timestamp: Date.now()
    }));
    return true;
  } catch (error) {
    console.error(`[Lock] Error: ${error.message}`);
    return false;
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch (error) {
    // Ignore
  }
}

/**
 * Circuit breaker - prevent fixing the same issue repeatedly
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (error) {
    // Ignore
  }
  return { recentFixes: [] };
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error(`[State] Could not save state: ${error.message}`);
  }
}

function shouldAttemptFix(issue, state) {
  const key = `${issue.dataType}:${issue.type}`;
  const recentFix = state.recentFixes.find(f => f.key === key);

  if (recentFix) {
    const hoursSinceLastFix = (Date.now() - recentFix.timestamp) / (1000 * 60 * 60);

    // If we tried to fix this same issue in the last 2 hours, skip it
    if (hoursSinceLastFix < 2) {
      console.log(`[Circuit Breaker] Skipping ${key} - attempted ${hoursSinceLastFix.toFixed(1)} hours ago`);
      return false;
    }

    // If we've failed 3+ times in the last 24 hours, skip and alert
    if (recentFix.attempts >= 3 && hoursSinceLastFix < 24) {
      console.log(`[Circuit Breaker] Skipping ${key} - ${recentFix.attempts} failed attempts in 24h`);
      return false;
    }
  }

  return true;
}

function recordFixAttempt(issue, success, state) {
  const key = `${issue.dataType}:${issue.type}`;

  // Remove old entries (older than 24 hours)
  state.recentFixes = state.recentFixes.filter(
    f => Date.now() - f.timestamp < 24 * 60 * 60 * 1000
  );

  if (success) {
    // Remove this issue from recent fixes on success
    state.recentFixes = state.recentFixes.filter(f => f.key !== key);
  } else {
    // Increment failure count
    const existing = state.recentFixes.find(f => f.key === key);
    if (existing) {
      existing.attempts++;
      existing.timestamp = Date.now();
    } else {
      state.recentFixes.push({ key, attempts: 1, timestamp: Date.now() });
    }
  }

  saveState(state);
}

/**
 * Sync repo with GitHub before making changes
 */
function syncWithGitHub() {
  console.log('[Sync] Pulling latest from GitHub...');
  try {
    execSync('git fetch origin', { cwd: REPO_ROOT, stdio: 'pipe' });
    execSync('git pull --rebase origin main', { cwd: REPO_ROOT, stdio: 'pipe' });
    console.log('[Sync] Repository up to date\n');
    return true;
  } catch (error) {
    console.error(`[Sync] Warning: Could not pull latest: ${error.message}`);
    // Continue anyway - might just be no changes
    return true;
  }
}

/**
 * Push code changes to GitHub (excludes data files)
 */
function pushCodeChanges() {
  console.log('[Sync] Checking for code changes to push...');
  try {
    // Only stage code files, not data
    execSync('git add "*.js" "*.json" "*.yml" "*.md" "*.sh"', {
      cwd: REPO_ROOT,
      stdio: 'pipe'
    });

    // Check if there are staged changes
    const status = execSync('git diff --cached --name-only', {
      cwd: REPO_ROOT,
      encoding: 'utf-8'
    });

    if (!status.trim()) {
      console.log('[Sync] No code changes to push\n');
      return null;
    }

    console.log(`[Sync] Pushing changes: ${status.trim().split('\n').join(', ')}`);

    // Commit and push
    execSync('git commit -m "🎿 Liftie auto-fix"', { cwd: REPO_ROOT, stdio: 'pipe' });
    execSync('git push origin main', { cwd: REPO_ROOT, stdio: 'pipe' });

    const sha = execSync('git rev-parse --short HEAD', {
      cwd: REPO_ROOT,
      encoding: 'utf-8'
    }).trim();

    console.log(`[Sync] Pushed commit ${sha}\n`);
    return sha;
  } catch (error) {
    console.error(`[Sync] Error pushing changes: ${error.message}`);
    return null;
  }
}

/**
 * Deploy code changes to Hetzner and restart affected processes
 */
async function deployToHetzner(affectedDataTypes = []) {
  console.log('[Deploy] Syncing code to Hetzner...');
  try {
    const host = config.hetzner.host;
    const user = config.hetzner.user;

    // Pull latest on Hetzner
    execSync(
      `ssh ${user}@${host} "cd /home/scraper/ski-run-scraper && git pull origin main"`,
      { stdio: 'pipe', timeout: 30000 }
    );

    console.log('[Deploy] Code synced to Hetzner');

    // Restart affected PM2 processes so they pick up the new code
    const processMap = {
      'lifts': 'lift-scraper',
      'snow': 'snow-scraper',
      'terrain': 'terrain-scraper',
      'api': 'api-server'
    };

    for (const dataType of affectedDataTypes) {
      const processName = processMap[dataType];
      if (processName) {
        console.log(`[Deploy] Restarting ${processName}...`);
        try {
          execSync(
            `ssh ${user}@${host} "pm2 restart ${processName}"`,
            { stdio: 'pipe', timeout: 30000 }
          );
        } catch (e) {
          console.error(`[Deploy] Warning: Could not restart ${processName}`);
        }
      }
    }

    console.log('[Deploy] Hetzner deployment complete\n');
    return true;
  } catch (error) {
    console.error(`[Deploy] Warning: Could not sync to Hetzner: ${error.message}`);
    return false;
  }
}

/**
 * Main entry point
 */
async function main() {
  console.log('🎿 Liftie starting up...\n');

  // Acquire lock to prevent concurrent runs
  if (!acquireLock()) {
    return;
  }

  // Load state for circuit breaker
  const state = loadState();

  try {
    // Step 0: Sync with GitHub first
    syncWithGitHub();

    // Step 1: Run health checks
    const healthResult = await runHealthChecks();

    if (healthResult.healthy) {
      console.log('\n✅ All systems healthy. Nothing to fix.\n');
      return;
    }

    console.log(`\n⚠️ Found ${healthResult.issues.length} issues to investigate.\n`);

    // Step 2: Process critical issues
    const criticalIssues = healthResult.issues.filter(i => i.severity === 'critical');

    if (criticalIssues.length === 0) {
      console.log('No critical issues found. Skipping fixer agent.\n');
      await notifyStatus(`Health check complete. ${healthResult.issues.length} warnings found.`, 'warning');
      return;
    }

    // Process each critical issue
    const results = [];

    for (const issue of criticalIssues) {
      // Circuit breaker check
      if (!shouldAttemptFix(issue, state)) {
        await notifyNeedsHelp(issue, ['Circuit breaker tripped - too many recent fix attempts']);
        continue;
      }

      console.log(`\n🔍 Investigating: ${issue.type} (${issue.dataType})`);
      console.log(`   Details: ${issue.details}\n`);

      // Notify Discord that we're investigating
      await notifyIssueDetected(issue);

      try {
        // Run the fixer agent
        const result = await runFixerAgent(issue, {
          healthStatus: healthResult
        });

        results.push({ issue, result });

        // Record the attempt for circuit breaker
        recordFixAttempt(issue, result.fixed, state);

        if (result.fixed) {
          console.log(`✅ Fixed: ${result.action}\n`);
          await notifyIssueFixed(issue, result);
        } else {
          console.log(`❌ Could not fix: ${result.action}\n`);
          await notifyNeedsHelp(issue, [result.action]);
        }
      } catch (error) {
        console.error(`❌ Error processing issue: ${error.message}\n`);
        recordFixAttempt(issue, false, state);
        await notifyNeedsHelp(issue, [`Error: ${error.message}`]);
        results.push({
          issue,
          result: { fixed: false, action: 'Error', details: error.message }
        });
      }
    }

    // Summary
    const fixed = results.filter(r => r.result.fixed).length;
    const failed = results.filter(r => !r.result.fixed).length;

    console.log('\n📊 Summary:');
    console.log(`   Fixed: ${fixed}`);
    console.log(`   Failed: ${failed}`);

    // If any fixes were made, push to GitHub and deploy to Hetzner
    if (fixed > 0) {
      console.log('\n🚀 Deploying fixes...\n');

      // Push code changes to GitHub
      const commitSha = pushCodeChanges();

      if (commitSha) {
        // Collect affected data types for PM2 restart
        const affectedDataTypes = [...new Set(
          results.filter(r => r.result.fixed).map(r => r.issue.dataType)
        )];

        // Deploy to Hetzner and restart affected processes
        await deployToHetzner(affectedDataTypes);

        // Notify success
        await notifyStatus(
          `Deployed ${fixed} fix(es) to GitHub and Hetzner (commit: ${commitSha})`,
          'success'
        );
      }
    }

    // Exit with error if any issues couldn't be fixed
    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    // Always release the lock
    releaseLock();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    releaseLock();
    process.exit(1);
  });
}

module.exports = { main };
