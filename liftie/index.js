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
const { runFixerAgent, checkClaudeCodeReady } = require('./fixer-agent');
const {
  notifyIssueDetected,
  notifyIssueFixed,
  notifyNeedsHelp,
  notifyStatus,
  notifyLearning
} = require('./discord');
const config = require('./config');

const REPO_ROOT = path.resolve(__dirname, '..');
const LOCK_FILE = path.join(REPO_ROOT, 'liftie', '.liftie.lock');
const STATE_FILE = path.join(REPO_ROOT, 'liftie', '.liftie-state.json');

// Limit how many issues to process per run
const MAX_ISSUES_PER_RUN = 10;
// How many agents to run in parallel
const PARALLEL_AGENTS = 3;

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
  // Include resort in key for resort-level issues to avoid blocking all resorts
  const key = issue.resort
    ? `${issue.dataType}:${issue.type}:${issue.resort}`
    : `${issue.dataType}:${issue.type}`;
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
  // Include resort in key for resort-level issues
  const key = issue.resort
    ? `${issue.dataType}:${issue.type}:${issue.resort}`
    : `${issue.dataType}:${issue.type}`;

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
  const checkOnly = process.argv.includes('--check-only');
  const forceClearLock = process.argv.includes('--force-clear-lock');

  console.log('🎿 Liftie starting up...\n');
  if (checkOnly) {
    console.log('Running in CHECK-ONLY mode (no fixes will be attempted)\n');
  }

  // Force clear stale lock if requested
  if (forceClearLock) {
    console.log('[Lock] Force clearing lock file...\n');
    releaseLock();
  }

  // Acquire lock to prevent concurrent runs (skip for check-only mode)
  if (!checkOnly && !acquireLock()) {
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

    // Step 2: Process critical issues (limited per run)
    const allCriticalIssues = healthResult.issues.filter(i => i.severity === 'critical');

    if (allCriticalIssues.length === 0) {
      console.log('No critical issues found. Skipping fixer agent.\n');
      await notifyStatus(`Health check complete. ${healthResult.issues.length} warnings found.`, 'warning');
      return;
    }

    // Limit to MAX_ISSUES_PER_RUN to prevent very long runs
    const criticalIssues = allCriticalIssues.slice(0, MAX_ISSUES_PER_RUN);
    if (allCriticalIssues.length > MAX_ISSUES_PER_RUN) {
      console.log(`Processing ${criticalIssues.length} of ${allCriticalIssues.length} critical issues (limit: ${MAX_ISSUES_PER_RUN} per run)\n`);
    }

    // In check-only mode, just print the issues and exit
    if (checkOnly) {
      console.log('Critical issues that would be processed:\n');
      for (const issue of criticalIssues) {
        console.log(`  - ${issue.type} (${issue.dataType}): ${issue.details}`);
      }
      console.log('\nRun without --check-only to attempt fixes.\n');
      return;
    }

    // Filter out issues blocked by circuit breaker
    const issuesToProcess = criticalIssues.filter(issue => {
      if (!shouldAttemptFix(issue, state)) {
        console.log(`[Circuit Breaker] Skipping: ${issue.details}`);
        notifyNeedsHelp(issue, ['Circuit breaker tripped - too many recent fix attempts']);
        return false;
      }
      return true;
    });

    // Check if Claude Code is ready before attempting fixes
    const claudeStatus = checkClaudeCodeReady();
    if (!claudeStatus.ready) {
      console.log(`\n❌ Cannot run fixer agent: ${claudeStatus.error}`);
      console.log('Notifying Discord about all critical issues that need manual intervention...\n');

      // Notify Discord about all issues since we can't auto-fix
      for (const issue of issuesToProcess) {
        await notifyNeedsHelp(issue, [
          'Auto-fix unavailable: ' + claudeStatus.error,
          'Manual intervention required'
        ]);
      }
      return;
    }

    console.log(`\n🔧 Processing ${issuesToProcess.length} issues (${PARALLEL_AGENTS} in parallel)...\n`);

    // Process issues in parallel batches
    const results = [];

    async function processIssue(issue, index) {
      const prefix = `[Issue ${index + 1}/${issuesToProcess.length}]`;
      console.log(`${prefix} 🔍 Starting: ${issue.type} (${issue.dataType})`);
      console.log(`${prefix}    Details: ${issue.details}\n`);

      // Notify Discord that we're investigating
      await notifyIssueDetected(issue);

      try {
        // Run the fixer agent
        const result = await runFixerAgent(issue, {
          healthStatus: healthResult
        });

        // Record the attempt for circuit breaker
        recordFixAttempt(issue, result.fixed, state);

        if (result.fixed) {
          console.log(`${prefix} ✅ Fixed: ${result.action}\n`);
          await notifyIssueFixed(issue, result);
        } else {
          console.log(`${prefix} ❌ Could not fix: ${result.action}\n`);
          await notifyNeedsHelp(issue, [result.action]);
        }

        // Check if Claude learned something new
        if (result.learned) {
          await notifyLearning(issue, result);
        }

        return { issue, result };
      } catch (error) {
        console.error(`${prefix} ❌ Error: ${error.message}\n`);
        recordFixAttempt(issue, false, state);
        await notifyNeedsHelp(issue, [`Error: ${error.message}`]);
        return {
          issue,
          result: { fixed: false, action: 'Error', details: error.message }
        };
      }
    }

    // Process in chunks of PARALLEL_AGENTS
    for (let i = 0; i < issuesToProcess.length; i += PARALLEL_AGENTS) {
      const chunk = issuesToProcess.slice(i, i + PARALLEL_AGENTS);
      console.log(`\n--- Batch ${Math.floor(i / PARALLEL_AGENTS) + 1}: Processing ${chunk.length} issues in parallel ---\n`);

      const chunkResults = await Promise.all(
        chunk.map((issue, idx) => processIssue(issue, i + idx))
      );
      results.push(...chunkResults);
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
