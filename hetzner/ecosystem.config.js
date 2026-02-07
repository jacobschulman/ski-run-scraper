// PM2 Ecosystem Configuration for Ski Scraper Suite
// All scrapers run on Hetzner VPS (Helsinki)

module.exports = {
  apps: [
    // ═══════════════════════════════════════════════════════════════════════════
    // LIFT SCRAPER - Others (HTTP API providers: Inspector, Aspen, ReportPal, Zaneray, DOR)
    // Lightweight HTTP-only process, should essentially never crash
    // ═══════════════════════════════════════════════════════════════════════════
    {
      name: 'lift-scraper-others',
      script: './lift-scraper-others.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      min_uptime: '30s',
      watch: false,
      max_memory_restart: '300M',
      restart_delay: 5000,         // 5s pause between restarts
      max_restarts: 50,            // Allow many restarts before PM2 gives up
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/home/scraper/logs/lift-others-error.log',
      out_file: '/home/scraper/logs/lift-others-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // LIFT SCRAPER - Vail (Puppeteer-based, scrapes every 3 minutes)
    // Isolated from HTTP scrapers so Chrome crashes don't affect other providers
    // ═══════════════════════════════════════════════════════════════════════════
    {
      name: 'lift-scraper-vail',
      script: './lift-scraper-vail.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      min_uptime: '30s',
      watch: false,
      max_memory_restart: '1200M',
      exp_backoff_restart_delay: 1000,  // Exponential backoff: 1s, 2s, 4s... (caps at 15s)
      max_restarts: 30,
      node_args: '--expose-gc',         // Allow manual GC for memory management
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/home/scraper/logs/lift-vail-error.log',
      out_file: '/home/scraper/logs/lift-vail-out.log',
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
      min_uptime: '10s',
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
      min_uptime: '10s',
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
      min_uptime: '10s',
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
