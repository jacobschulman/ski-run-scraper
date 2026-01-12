/**
 * Liftie Configuration
 *
 * Environment variables required:
 * - HETZNER_HOST: IP address of the Hetzner server
 * - SSH_PRIVATE_KEY or HETZNER_SSH_KEY: Base64-encoded SSH private key
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
    // NOTE: Lift staleness only alerts during operating hours (8 AM - 5 PM local)
    liftStaleMinutes: 30,
    // Snow data should update every 30 min regardless of time of day
    snowStaleMinutes: 120,
    // DEPRECATED: terrainStaleMinutes - now uses 24-hour threshold in health-check.js
    // Terrain is scraped once daily (7-10 AM local), alerts if >24h stale
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
    codeFixEnabled: false
  }
};
