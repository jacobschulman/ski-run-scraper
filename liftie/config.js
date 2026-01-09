/**
 * Liftie Configuration
 *
 * Environment variables required:
 * - HETZNER_HOST: IP address of the Hetzner server
 * - HETZNER_SSH_KEY: Base64-encoded SSH private key
 * - DISCORD_WEBHOOK_URL: Discord webhook URL for notifications
 * - ANTHROPIC_API_KEY: Anthropic API key for Claude Agent SDK
 */

module.exports = {
  hetzner: {
    host: process.env.HETZNER_HOST || '46.62.169.104',
    user: process.env.HETZNER_USER || 'scraper',
    port: parseInt(process.env.HETZNER_PORT || '22', 10),
    apiPort: parseInt(process.env.HETZNER_API_PORT || '3000', 10),
    healthEndpoint: '/health'  // Single endpoint returns all scraper data in scrapers.{lift,snow,terrain}
  },

  thresholds: {
    // How long before data is considered stale (in minutes)
    liftStaleMinutes: 30,
    snowStaleMinutes: 120,
    terrainStaleMinutes: 360,

    // How many consecutive failures before alerting
    consecutiveFailuresWarning: 5,
    consecutiveFailuresCritical: 10
  },

  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL
  },

  github: {
    owner: 'jolson88',
    repo: 'ski-run-scraper',
    mainBranch: 'main'
  },

  agent: {
    // Maximum number of auto-fix attempts per issue
    maxAutoFixAttempts: 3,
    // Enable/disable automatic code fixes
    codeFixEnabled: true
  }
};
