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
    // LIFT SCRAPER - Vail (LEGACY - keep during live-scraper transition)
    // Rotating Puppeteer queue for enabledResorts in config.json
    // Remove once live-scraper instances are proven stable
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
      exp_backoff_restart_delay: 1000,
      max_restarts: 50,
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/home/scraper/logs/lift-vail-error.log',
      out_file: '/home/scraper/logs/lift-vail-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // LIVE SCRAPERS - Real-time lift wait times (fresh browser per resort)
    // Based on vail-live-scraper pattern. Each instance handles 3-4 resorts.
    // Resort groups configured in config.json liftScraping.vail.instances
    //
    // STAGED ROLLOUT:
    //   Phase 1: Enable live-scraper-a only (breckenridge, parkcity, keystone)
    //   Phase 2: Uncomment live-scraper-b (heavenly, northstar, kirkwood)
    //   Phase 3: Uncomment live-scraper-c (stowe, mountsnow, beavercreek, crestedbutte)
    //   Phase 4: Remove lift-scraper-vail above once all instances are stable
    // ═══════════════════════════════════════════════════════════════════════════

    // Phase 1: Uncomment to start (breckenridge, parkcity, keystone)
    // {
    //   name: 'live-scraper-a',
    //   script: './live-scraper.js',
    //   args: 'a',
    //   cwd: __dirname,
    //   instances: 1,
    //   autorestart: true,
    //   min_uptime: '30s',
    //   watch: false,
    //   max_memory_restart: '400M',
    //   exp_backoff_restart_delay: 1000,
    //   max_restarts: 50,
    //   env: {
    //     NODE_ENV: 'production',
    //   },
    //   error_file: '/home/scraper/logs/live-a-error.log',
    //   out_file: '/home/scraper/logs/live-a-out.log',
    //   merge_logs: true,
    //   log_date_format: 'YYYY-MM-DD HH:mm:ss',
    // },

    // Phase 2: Uncomment when live-scraper-a is stable
    // {
    //   name: 'live-scraper-b',
    //   script: './live-scraper.js',
    //   args: 'b',
    //   cwd: __dirname,
    //   instances: 1,
    //   autorestart: true,
    //   min_uptime: '30s',
    //   watch: false,
    //   max_memory_restart: '400M',
    //   exp_backoff_restart_delay: 1000,
    //   max_restarts: 50,
    //   env: {
    //     NODE_ENV: 'production',
    //   },
    //   error_file: '/home/scraper/logs/live-b-error.log',
    //   out_file: '/home/scraper/logs/live-b-out.log',
    //   merge_logs: true,
    //   log_date_format: 'YYYY-MM-DD HH:mm:ss',
    // },

    // Phase 3: Uncomment when live-scraper-b is stable
    // {
    //   name: 'live-scraper-c',
    //   script: './live-scraper.js',
    //   args: 'c',
    //   cwd: __dirname,
    //   instances: 1,
    //   autorestart: true,
    //   min_uptime: '30s',
    //   watch: false,
    //   max_memory_restart: '400M',
    //   exp_backoff_restart_delay: 1000,
    //   max_restarts: 50,
    //   env: {
    //     NODE_ENV: 'production',
    //   },
    //   error_file: '/home/scraper/logs/live-c-error.log',
    //   out_file: '/home/scraper/logs/live-c-out.log',
    //   merge_logs: true,
    //   log_date_format: 'YYYY-MM-DD HH:mm:ss',
    // },

    // ═══════════════════════════════════════════════════════════════════════════
    // VAIL LIVE SCRAPER - Bare-bones Vail-only, scrapes every 45 seconds
    // Keeps browser alive between cycles for maximum data frequency
    // ═══════════════════════════════════════════════════════════════════════════
    {
      name: 'vail-live-scraper',
      script: './vail-live-scraper.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      min_uptime: '30s',
      watch: false,
      max_memory_restart: '800M',
      exp_backoff_restart_delay: 1000,
      max_restarts: 50,
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/home/scraper/logs/vail-live-error.log',
      out_file: '/home/scraper/logs/vail-live-out.log',
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
