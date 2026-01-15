# Hetzner Scraper Setup

This directory contains scripts for running the ski scrapers on Hetzner.

## Auto-Deploy Setup

To enable automatic code updates from GitHub, add this cron job on Hetzner:

```bash
# Run this ONCE on Hetzner to set up auto-deploy
crontab -e
```

Add this line to run auto-deploy every 5 minutes:
```
*/5 * * * * /home/scraper/ski-run-scraper/hetzner/deploy.sh
```

This will:
- Check for code updates from GitHub every 5 minutes
- Pull new code if available
- Preserve local data changes (scraper outputs)
- Restart services with new code

## Scripts

- **deploy.sh** - Auto-deployment script (pulls code, restarts services)
- **smart-commit.sh** - Commits and pushes local data changes to GitHub
- **lift-scraper-persistent.js** - Continuous lift wait-time scraper
- **api-server.js** - Health monitoring and data API
- **monitor.html** - Real-time monitoring dashboard

## Manual Deployment

To manually deploy without waiting for cron:
```bash
./deploy.sh
```

## Cron Jobs (Current Setup)

The Hetzner server should have these cron jobs:

```bash
# Lift scraper (runs via PM2)
# Continuous background process

# Smart commit + push data (every 5 minutes)
*/5 * * * * /home/scraper/ski-run-scraper/hetzner/smart-commit.sh >> /home/scraper/logs/smart-commit.log 2>&1

# Auto-deploy code updates (every 5 minutes)
*/5 * * * * /home/scraper/ski-run-scraper/hetzner/deploy.sh >> /home/scraper/logs/deploy.log 2>&1
```

## Logs

- `/home/scraper/logs/deploy.log` - Deployment status and timing
- `/home/scraper/logs/commit.log` - Git commit logs
- PM2 logs: `pm2 logs lift-scraper` (and other services)
