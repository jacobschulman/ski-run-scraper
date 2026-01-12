# Liftie - Ski Scraper Monitor Agent

Autonomous monitoring and repair agent for ski-run-scraper. Detects issues, investigates with Claude Code, and fixes them automatically.

## Quick Start (Docker/Unraid)

### 1. Build the Image

```bash
cd /path/to/ski-run-scraper
docker build -t liftie -f liftie/Dockerfile .
```

### 2. Authenticate Claude Code (One Time)

Run the container interactively to log in:

```bash
docker run -it \
  -v liftie-claude-config:/root/.claude \
  liftie claude login
```

Follow the prompts to authenticate with your Claude Max subscription.

### 3. Add SSH Key to GitHub

Your SSH key needs to be added to GitHub as a deploy key (with write access):

1. Go to your repo → Settings → Deploy keys → Add deploy key
2. Title: "Liftie Bot"
3. Key: `cat ~/.ssh/id_ed25519.pub`
4. Check "Allow write access"
5. Click Add key

### 4. Create Environment File

Create `.env` in the liftie directory:

```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxx/yyy
HETZNER_HOST=46.62.169.104
SSH_PRIVATE_KEY=<base64-encoded-ssh-key>  # or HETZNER_SSH_KEY
```

To encode your SSH key:
```bash
cat ~/.ssh/id_ed25519 | base64 | tr -d '\n'
```

This same key is used for both GitHub (pushing code) and Hetzner (deploying).

### 5. Run Liftie

**With docker-compose:**
```bash
cd liftie
docker-compose up -d
```

**With docker run:**
```bash
docker run -d \
  --name liftie \
  --restart unless-stopped \
  -v liftie-claude-config:/root/.claude \
  -e DISCORD_WEBHOOK_URL="your-webhook-url" \
  -e HETZNER_HOST="46.62.169.104" \
  -e SSH_PRIVATE_KEY="$(cat ~/.ssh/id_ed25519 | base64 | tr -d '\n')" \
  liftie
```

### 6. View Logs

```bash
docker logs -f liftie
```

---

## Unraid Setup

### Option A: Using Docker Compose Manager

1. Install "Docker Compose Manager" from Community Applications
2. Add a new stack pointing to `liftie/docker-compose.yml`
3. Set environment variables in the stack config
4. Deploy

### Option B: Manual Container

1. Go to Docker tab → Add Container
2. Fill in:
   - **Name:** liftie
   - **Repository:** Build locally or push to registry
   - **Network:** bridge
3. Add environment variables:
   - `DISCORD_WEBHOOK_URL`
   - `HETZNER_HOST`
   - `SSH_PRIVATE_KEY` (or `HETZNER_SSH_KEY`)
4. Add volume mapping:
   - `/root/.claude` → `/mnt/user/appdata/liftie/claude-config`
5. Apply

---

## Testing

Run once without cron:

```bash
docker run --rm \
  -v liftie-claude-config:/root/.claude \
  -e DISCORD_WEBHOOK_URL="your-webhook" \
  -e HETZNER_HOST="46.62.169.104" \
  liftie run-once
```

---

## How It Works

1. **Every 10 minutes:** Runs health checks
2. **Checks:**
   - Hetzner health endpoints (lift/snow/terrain scrapers)
   - Data freshness (is data stale?)
   - Consecutive failures per resort
3. **If issues found:** Spawns Claude Code to investigate
4. **Claude Code:**
   - SSHs into Hetzner
   - Reads PM2 logs
   - Identifies root cause
   - Fixes code or restarts processes
   - Commits and pushes changes
5. **Discord notification:** Reports what was fixed (or asks for help)

---

## Files

```
liftie/
├── index.js           # Main entry point
├── health-check.js    # Health monitoring
├── fixer-agent.js     # Claude Code integration
├── discord.js         # Discord webhooks
├── config.js          # Configuration
├── Dockerfile         # Container image
├── docker-compose.yml # Compose config
└── README.md          # This file
```
