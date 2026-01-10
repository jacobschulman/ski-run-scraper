/**
 * Fixer Agent
 *
 * Spawns Claude Code to investigate and fix issues.
 * Uses your existing Claude Max subscription - no API key needed.
 *
 * DOCKER REQUIREMENTS:
 * 1. Claude Code must be installed: npm install -g @anthropic-ai/claude-code
 * 2. Must be authenticated: docker run -it -v liftie-claude-config:/root/.claude liftie claude login
 * 3. SSH key must be configured for Hetzner access
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');

const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Check if Claude Code is available and can run
 * Returns { ready: boolean, error?: string }
 */
function checkClaudeCodeReady() {
  // Check if claude CLI is available
  try {
    execSync('which claude', { stdio: 'pipe' });
  } catch (e) {
    return {
      ready: false,
      error: 'Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code'
    };
  }

  // Quick version check to ensure CLI works
  try {
    const version = execSync('claude --version', { stdio: 'pipe', timeout: 5000 }).toString().trim();
    console.log(`[Agent] Claude Code version: ${version}`);
  } catch (e) {
    return {
      ready: false,
      error: `Claude Code version check failed: ${e.message}`
    };
  }

  // Check if ~/.claude directory exists (indicates some usage/setup)
  const claudeDir = path.join(process.env.HOME || '/root', '.claude');
  if (!fs.existsSync(claudeDir)) {
    return {
      ready: false,
      error: 'Claude Code not initialized. Run: claude login (or claude --help)'
    };
  }

  return { ready: true };
}

/**
 * Run Claude Code with a prompt to fix an issue
 */
function runClaudeCode(prompt, options = {}) {
  // Clean up any previous result file
  const resultPath = path.join(__dirname, '.last-result.json');
  try {
    if (fs.existsSync(resultPath)) {
      fs.unlinkSync(resultPath);
    }
  } catch (e) {
    // Ignore cleanup errors
  }

  return new Promise((resolve, reject) => {
    // Claude Code reads from stdin when piped (no -p flag needed)
    const args = [
      '--print',  // Non-interactive mode, just print the result
      '--dangerously-skip-permissions'  // Auto-approve tool use
      // Prompt comes from stdin, not -p argument
    ];

    console.log('[Agent] Spawning Claude Code...');
    console.log(`[Agent] Working directory: ${REPO_ROOT}`);
    console.log(`[Agent] Command: claude ${args.join(' ')} (prompt via stdin, ${prompt.length} chars)`);

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
    console.log(`[Agent] HOME=${process.env.HOME}`);

    // Handle spawn errors (e.g., command not found)
    claude.on('error', (err) => {
      console.error(`[Agent] Spawn error: ${err.message}`);
      reject(err);
    });

    // Write prompt to stdin and close it
    claude.stdin.write(prompt);
    claude.stdin.end();
    console.log('[Agent] Prompt sent to stdin, waiting for response...');

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
 * Uses outcome-focused approach with persistent context
 */
function buildPrompt(issue, context = {}) {
  // Load persistent context
  const contextPath = path.join(__dirname, 'context.md');
  let persistentContext = '';
  try {
    persistentContext = fs.readFileSync(contextPath, 'utf-8');
  } catch (e) {
    persistentContext = 'No previous context available.';
  }

  // Load result schema
  const schemaPath = path.join(__dirname, 'result-schema.md');
  let schema = '';
  try {
    schema = fs.readFileSync(schemaPath, 'utf-8');
  } catch (e) {
    schema = 'Write results to liftie/.last-result.json with status, summary, root_cause, actions_taken fields.';
  }

  // Load recent investigation log (first 100 lines for context)
  const logPath = path.join(__dirname, 'investigation-log.md');
  let recentInvestigations = '';
  try {
    const log = fs.readFileSync(logPath, 'utf-8');
    const lines = log.split('\n');
    recentInvestigations = lines.slice(0, 100).join('\n');
  } catch (e) {
    recentInvestigations = 'No previous investigations.';
  }

  const { resort, dataType, minutesStale, details, type, workflow, source } = issue;

  // Build issue description based on type
  let issueDescription = '';
  if (type === 'github_action_failing') {
    issueDescription = `GitHub Actions workflow "${workflow}" has failed multiple times consecutively.`;
  } else if (resort) {
    issueDescription = `${resort} has a problem with ${dataType} data.
${details || ''}
${minutesStale ? `Data is ${minutesStale} minutes stale.` : ''}
${source ? `Source: ${source}` : ''}`;
  } else {
    issueDescription = `System-level problem: ${type}
${details || ''}`;
  }

  return `You are Liftie, an autonomous agent that keeps ski resort data scrapers healthy.

## Current Issue
${issueDescription}

## System Info
- Hetzner server: ${config.hetzner.user}@${config.hetzner.host}
- PM2 processes: lift-scraper, snow-scraper, terrain-scraper, api-server
- Code on server: /home/scraper/ski-run-scraper
- GitHub repo: ${config.github.owner}/${config.github.repo}

## Your Persistent Knowledge
${persistentContext}

## Recent Investigations
${recentInvestigations}

## Completion Protocol
${schema}

## Critical Guidelines

### Use Common Sense About Resort Operations
- **Check timezone**: Each resort has a timezone in config.json. A resort showing "stale" at 2am local time is expected.
- **Check operating hours**: Most resorts operate 8am-5pm local time. Lift data not updating at night is normal.
- **Check season status**: Resorts have seasonStart/seasonEnd dates. Off-season staleness is expected.
- **Check for known closures**: Weather, holidays, or maintenance can cause temporary closures.

### Before Flagging "needs_help"
- Verify it's actually a problem, not expected behavior
- Try at least 2-3 different investigation approaches
- Check if the issue resolves itself (transient network issues, etc.)

### When You Learn Something New
- If you discover a pattern, add it to liftie/context.md
- If a resort has quirks (unusual hours, seasonal API changes), document them
- Always append to liftie/investigation-log.md with timestamp and findings

### Investigation Tools Available

**For Hetzner issues:**
- SSH: \`ssh ${config.hetzner.user}@${config.hetzner.host}\`
- PM2 logs: \`pm2 logs <process> --lines 100 --nostream\`
- PM2 status/restart: \`pm2 status\`, \`pm2 restart <process>\`

**For GitHub Actions issues:**
- View recent runs: \`gh run list --workflow=<name>.yml\`
- View run logs: \`gh run view <run-id> --log-failed\`
- View workflow file: Read .github/workflows/<name>.yml
- Fix scraper code: Edit the JS files directly, commit and push
- Re-run workflow: \`gh workflow run <name>.yml\`

**Local files:** Full read/write access to this repo

Begin your investigation.`;
}

/**
 * Parse Claude Code output to extract the result
 * Reads from structured .last-result.json if available
 */
function parseResult(output) {
  const resultPath = path.join(__dirname, '.last-result.json');

  try {
    if (fs.existsSync(resultPath)) {
      const resultData = fs.readFileSync(resultPath, 'utf-8');
      const result = JSON.parse(resultData);

      // Clean up for next run
      fs.unlinkSync(resultPath);

      return {
        fixed: result.status === 'fixed',
        notAnIssue: result.status === 'not_an_issue',
        status: result.status,
        action: result.summary || 'No summary provided',
        rootCause: result.root_cause || 'Unknown',
        actionsTaken: result.actions_taken || [],
        learned: result.learned || null,
        timestamp: result.timestamp || new Date().toISOString()
      };
    }
  } catch (error) {
    console.error(`[Agent] Failed to parse result file: ${error.message}`);
  }

  // Fallback to regex-based parsing if no result file
  const fixed = /fixed|resolved|updated|restarted|committed/i.test(output);
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
    status: fixed ? 'fixed' : 'needs_help',
    action,
    rootCause: 'Unknown',
    details: output ? output.slice(-500) : 'No output',
    timestamp: new Date().toISOString()
  };
}

/**
 * Run the fixer agent for a specific issue
 */
async function runFixerAgent(issue, context = {}) {
  console.log(`[Agent] Starting fixer agent for issue: ${issue.type}`);
  console.log(`[Agent] Details: ${issue.details}`);

  // Pre-flight check: ensure Claude Code is ready
  const readyCheck = checkClaudeCodeReady();
  if (!readyCheck.ready) {
    console.error(`[Agent] Claude Code not ready: ${readyCheck.error}`);
    return {
      fixed: false,
      action: 'Claude Code not ready',
      details: readyCheck.error
    };
  }

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
  runFixerAgent,
  checkClaudeCodeReady
};
