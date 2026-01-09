/**
 * Fixer Agent
 *
 * Spawns Claude Code to investigate and fix issues.
 * Uses your existing Claude Max subscription - no API key needed.
 */

const { spawn } = require('child_process');
const path = require('path');
const config = require('./config');

const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Run Claude Code with a prompt to fix an issue
 */
function runClaudeCode(prompt, options = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '--print',  // Non-interactive mode, just print the result
      '--dangerously-skip-permissions',  // Auto-approve tool use
      prompt
    ];

    console.log('[Agent] Spawning Claude Code...');
    console.log(`[Agent] Working directory: ${REPO_ROOT}`);
    console.log(`[Agent] Command: claude ${args.slice(0, 2).join(' ')} "<prompt>"`);

    const claude = spawn('claude', args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        // Ensure Claude Code knows where to find config
        HOME: process.env.HOME
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    console.log(`[Agent] Process spawned with PID: ${claude.pid}`);

    let stdout = '';
    let stderr = '';
    let lastOutputTime = Date.now();

    claude.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      lastOutputTime = Date.now();
      // Stream output with prefix for clarity
      text.split('\n').forEach(line => {
        if (line.trim()) console.log(`[Claude] ${line}`);
      });
    });

    claude.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      lastOutputTime = Date.now();
      // Stream errors with prefix
      text.split('\n').forEach(line => {
        if (line.trim()) console.log(`[Claude:err] ${line}`);
      });
    });

    claude.on('close', (code) => {
      console.log(`[Agent] Claude Code exited with code: ${code}`);
      if (code === 0) {
        resolve({ success: true, output: stdout });
      } else {
        resolve({ success: false, output: stdout, error: stderr, code });
      }
    });

    claude.on('error', (err) => {
      console.log(`[Agent] Failed to spawn Claude Code: ${err.message}`);
      reject(err);
    });

    // Timeout after 5 minutes
    const timeout = options.timeout || 5 * 60 * 1000;
    const timeoutId = setTimeout(() => {
      console.log(`[Agent] Timeout reached (${timeout / 1000}s), killing process...`);
      claude.kill('SIGTERM');
      reject(new Error(`Claude Code timed out after ${timeout / 1000}s`));
    }, timeout);

    // Also log progress every 30 seconds if no output
    const progressInterval = setInterval(() => {
      const silentSeconds = Math.floor((Date.now() - lastOutputTime) / 1000);
      if (silentSeconds > 10) {
        console.log(`[Agent] Waiting for Claude Code... (${silentSeconds}s since last output)`);
      }
    }, 30000);

    claude.on('close', () => {
      clearTimeout(timeoutId);
      clearInterval(progressInterval);
    });
  });
}

/**
 * Build a prompt for Claude Code based on the issue
 */
function buildPrompt(issue, context = {}) {
  // Different prompts for different issue types
  if (issue.type.startsWith('resort_stale_')) {
    return buildResortStalePrompt(issue, context);
  }

  return buildGenericPrompt(issue, context);
}

/**
 * Prompt for resort-specific stale data issues
 */
function buildResortStalePrompt(issue, context = {}) {
  const dataType = issue.dataType; // lifts, snow, or terrain
  const scraperName = dataType === 'lifts' ? 'lift-scraper' : `${dataType}-scraper`;

  return `You are Liftie, investigating why ${issue.resort} stopped returning ${dataType} data.

## Issue
- Resort: ${issue.resort}
- Data Type: ${dataType}
- Last Updated: ${issue.lastModified || issue.lastScraped}
- Minutes Stale: ${issue.minutesStale}

## System Info
- Hetzner server: ${config.hetzner.host}
- SSH user: ${config.hetzner.user}
- PM2 process: ${scraperName}

## Investigation Steps
1. SSH to Hetzner and check PM2 logs for errors:
   ssh ${config.hetzner.user}@${config.hetzner.host} "pm2 logs ${scraperName} --lines 100 --nostream"

2. Look for errors mentioning "${issue.resort}" in the logs

3. Check if the scraper is actually running:
   ssh ${config.hetzner.user}@${config.hetzner.host} "pm2 status"

4. Common causes:
   - Resort API returned error/changed format → check scraper code
   - Network timeout → might resolve on its own, but restart if persistent
   - Resort closed for the day → check if resort is in night hours
   - Scraper crashed → restart PM2 process

## To Fix
- If you find a code issue (wrong URL, bad selector, etc.) → fix the code and commit
- If the scraper just needs a restart → ssh ${config.hetzner.user}@${config.hetzner.host} "pm2 restart ${scraperName}"
- If the resort is legitimately closed → note this and skip (not a real issue)

After investigating, summarize what you found and what action you took (or why no action was needed).`;
}

/**
 * Generic prompt for non-resort issues
 */
function buildGenericPrompt(issue, context = {}) {
  return `You are Liftie, fixing an issue with the ski-run-scraper system.

## Issue Details
- Type: ${issue.type}
- Data Type: ${issue.dataType}
${issue.resort ? `- Resort: ${issue.resort}` : ''}
- Details: ${issue.details}
${issue.consecutiveFailures ? `- Consecutive Failures: ${issue.consecutiveFailures}` : ''}

## System Info
- Hetzner server: ${config.hetzner.host}
- SSH user: ${config.hetzner.user}
- Scrapers run via PM2: lift-scraper, snow-scraper, terrain-scraper, api-server

## Your Task
1. Investigate the issue by checking logs and code
2. Identify the root cause
3. Fix it (modify code if needed, or restart the PM2 process)
4. If you make code changes, commit them with a descriptive message

## Common Issues
- API endpoint URL changes → Update URL in scraper code
- HTML selector changes → Update CSS selectors
- Process crashes → Restart with: ssh ${config.hetzner.user}@${config.hetzner.host} "pm2 restart <process-name>"
- Memory issues → Restart PM2 process

Be careful with code changes. Only modify what's necessary.
After fixing, briefly summarize what you did.`;
}

/**
 * Parse Claude Code output to extract the result
 */
function parseResult(output) {
  // Look for indicators of success in the output
  const fixed = /fixed|resolved|updated|restarted|committed/i.test(output);

  // Try to extract what action was taken
  let action = 'Investigated issue';

  if (/commit/i.test(output)) {
    action = 'Made code changes and committed';
  } else if (/restart/i.test(output)) {
    action = 'Restarted PM2 process';
  } else if (/updated?.*url/i.test(output)) {
    action = 'Updated API endpoint URL';
  } else if (/updated?.*selector/i.test(output)) {
    action = 'Updated CSS selectors';
  }

  return {
    fixed,
    action,
    details: output.slice(-500)  // Last 500 chars as summary
  };
}

/**
 * Run the fixer agent for a specific issue
 */
async function runFixerAgent(issue, context = {}) {
  console.log(`[Agent] Starting fixer agent for issue: ${issue.type}`);
  console.log(`[Agent] Details: ${issue.details}`);

  const prompt = buildPrompt(issue, context);

  try {
    const result = await runClaudeCode(prompt, { timeout: 5 * 60 * 1000 });

    if (result.success) {
      const parsed = parseResult(result.output);
      console.log(`[Agent] Result: ${parsed.fixed ? 'Fixed' : 'Investigated'} - ${parsed.action}`);
      return parsed;
    } else {
      console.log(`[Agent] Claude Code exited with code ${result.code}`);
      return {
        fixed: false,
        action: 'Claude Code failed',
        details: result.error || result.output
      };
    }
  } catch (error) {
    console.error(`[Agent] Error: ${error.message}`);
    return {
      fixed: false,
      action: 'Agent error',
      details: error.message
    };
  }
}

module.exports = {
  runFixerAgent
};
