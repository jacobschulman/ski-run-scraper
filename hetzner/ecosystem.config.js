// PM2 Ecosystem Configuration for Ski Scraper Suite
// All scrapers run on Hetzner VPS (Helsinki)

module.exports = {
  apps: [
    // ═══════════════════════════════════════════════════════════════════════════
    // LIFT SCRAPER - Real-time wait times (every 1-2.5 minutes)
    // ═══════════════════════════════════════════════════════════════════════════
    {
      name: 'lift-scraper',
      script: './lift-scraper-persistent.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/home/scraper/logs/lift-error.log',
      out_file: '/home/scraper/logs/lift-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // SNOW SCRAPER - Snow reports (every 30 minutes)
    // ═══════════════════════════════════════════════════════════════════════════
    {
      name: 'snow-scraper',
      script: './snow-scraper-persistent.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/home/scraper/logs/snow-error.log',
      out_file: '/home/scraper/logs/snow-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // TERRAIN SCRAPER - Daily grooming/trail status (once per day per resort)
    // ═══════════════════════════════════════════════════════════════════════════
    {
      name: 'terrain-scraper',
      script: './terrain-scraper-persistent.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/home/scraper/logs/terrain-error.log',
      out_file: '/home/scraper/logs/terrain-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // API SERVER - Express server for data access
    // ═══════════════════════════════════════════════════════════════════════════
    {
      name: 'api-server',
      script: './api-server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '/home/scraper/logs/api-error.log',
      out_file: '/home/scraper/logs/api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // AGGREGATES GENERATOR - Hourly summary generation
    // ═══════════════════════════════════════════════════════════════════════════
    {
      name: 'aggregates',
      script: '../generate-aggregates.js',
      cwd: __dirname,
      instances: 1,
      autorestart: false,
      watch: false,
      cron_restart: '0 * * * *',  // Run every hour on the hour
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/home/scraper/logs/aggregates-error.log',
      out_file: '/home/scraper/logs/aggregates-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
