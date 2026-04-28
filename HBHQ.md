---
deploy:
  type: script
  working_dir: /srv/hbhq
  prod_command: ssh hetzner "sudo -u scraper bash /home/scraper/ski-run-scraper/hetzner/deploy.sh"
actions:
  staging_label: No staging
  ship_label: Ship to scraper server
  merge_label: Merge PR
  setup_merge_label: Merge HBHQ.md
  send_back_label: Request changes
---

# Ski Run Scraper HBHQ Contract

Ski Run Scraper collects ski resort grooming, snow, terrain, and lift data. It publishes historical JSON through GitHub Pages and also runs persistent real-time scraper processes on a Hetzner server.

This repo currently has a production-only deploy path. There is no separate staging environment configured for HBHQ.

## Build And Test

```bash
npm install
npm test
```

Useful targeted commands:

```bash
node vail-scraper.js keystone
node ikon-scraper.js
node generate-landing-pages.js
```

## Deploy

- Public data API: `https://jacobschulman.github.io/ski-run-scraper/data/index.html`.
- Hetzner server: `hetzner`.
- Runtime user: `scraper`.
- Runtime repo: `/home/scraper/ski-run-scraper`.
- Production deploy command: `ssh hetzner "sudo -u scraper bash /home/scraper/ski-run-scraper/hetzner/deploy.sh"`.
- The deploy script pulls latest `main`, preserves local scraper data, and reloads PM2 when code changes.

## Agent Notes

- Be careful with `data/` and generated files. Do not rewrite large historical data unless the request explicitly asks for data regeneration.
- Real-time Hetzner code lives in `hetzner/`.
- GitHub Actions also write/publish data. Avoid changes that create push races without checking workflow behavior.
- For scraper behavior changes, prefer a targeted local run against one resort before broad runs.
- Keep PRs focused on the assigned HBHQ item. Do not merge your own PR.
