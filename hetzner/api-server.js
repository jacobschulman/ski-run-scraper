// api-server.js - Simple Express server to serve ski data JSON files
// Serves data from the data/ directory with CORS support

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, '..', 'data');

// Health files for each scraper
const HEALTH_FILES = {
  lift: path.join(__dirname, 'health.json'),
  snow: path.join(__dirname, 'snow-health.json'),
  terrain: path.join(__dirname, 'terrain-health.json'),
};

// Read health from a single file
function readHealthFile(filepath) {
  try {
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    }
  } catch (e) {
    console.error(`Failed to read health file ${filepath}:`, e.message);
  }
  return null;
}

// Aggregate health from all scrapers
function getAllScraperHealth() {
  const lift = readHealthFile(HEALTH_FILES.lift);
  const snow = readHealthFile(HEALTH_FILES.snow);
  const terrain = readHealthFile(HEALTH_FILES.terrain);

  // Calculate overall status
  const scraperStatuses = [lift?.status, snow?.status, terrain?.status].filter(Boolean);
  const overallStatus = scraperStatuses.every(s => s === 'ok') ? 'ok'
    : scraperStatuses.some(s => s === 'degraded') ? 'degraded'
    : 'unknown';

  return {
    status: overallStatus,
    lift: lift || { status: 'unknown', ikon: {}, vail: {} },
    snow: snow || { status: 'unknown', ikon: {}, vail: {} },
    terrain: terrain || { status: 'unknown', ikon: {}, vail: {}, scrapedToday: {} },
  };
}

// Legacy function for backwards compatibility
function getScraperHealth() {
  return readHealthFile(HEALTH_FILES.lift) || { status: 'unknown', ikon: {}, vail: {} };
}

// CORS configuration - allow all origins for now, can restrict later
app.use(cors({
  origin: true, // Allow all origins
  methods: ['GET', 'HEAD'],
  maxAge: 86400,
}));

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Health check endpoint - now includes all scrapers
app.get('/health', (req, res) => {
  const allHealth = getAllScraperHealth();
  const liftHealth = allHealth.lift;

  res.json({
    status: allHealth.status || 'ok',
    server: 'running',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    // Legacy fields for backwards compatibility
    scraper: {
      status: liftHealth.status,
      uptime: liftHealth.uptime,
      ikon: liftHealth.ikon,
      vail: liftHealth.vail,
      updatedAt: liftHealth.updatedAt,
    },
    // New comprehensive health data
    scrapers: {
      lift: allHealth.lift,
      snow: allHealth.snow,
      terrain: allHealth.terrain,
    },
  });
});

// Detailed per-resort scrape status
app.get('/health/resorts', (req, res) => {
  try {
    const resortStatus = {};
    const dataDir = DATA_DIR;

    // Read all resort directories
    const dirs = fs.readdirSync(dataDir).filter(d => {
      const resortPath = path.join(dataDir, d);
      return fs.existsSync(resortPath) && fs.statSync(resortPath).isDirectory();
    });

    for (const resortKey of dirs) {
      const status = { resort: resortKey };

      // Check lift data
      const liftsDir = path.join(dataDir, resortKey, 'lifts');
      if (fs.existsSync(liftsDir)) {
        const liftFiles = fs.readdirSync(liftsDir).filter(f => f.endsWith('.ndjson')).sort().reverse();
        if (liftFiles.length > 0) {
          const latestFile = path.join(liftsDir, liftFiles[0]);
          const stat = fs.statSync(latestFile);
          status.lifts = {
            lastFile: liftFiles[0],
            lastModified: stat.mtime.toISOString(),
            fileCount: liftFiles.length,
          };
        }
      }

      // Check snow data
      const snowDir = path.join(dataDir, resortKey, 'snow');
      if (fs.existsSync(snowDir)) {
        const latestSnow = path.join(snowDir, 'latest.json');
        if (fs.existsSync(latestSnow)) {
          try {
            const snowData = JSON.parse(fs.readFileSync(latestSnow, 'utf8'));
            status.snow = {
              lastScraped: snowData.timestamp || snowData.scrapedAt,
              date: snowData.date,
            };
          } catch (e) {}
        }
      }

      // Check terrain data
      const terrainDir = path.join(dataDir, resortKey, 'terrain');
      if (fs.existsSync(terrainDir)) {
        const latestTerrain = path.join(terrainDir, 'latest.json');
        if (fs.existsSync(latestTerrain)) {
          try {
            const terrainData = JSON.parse(fs.readFileSync(latestTerrain, 'utf8'));
            status.terrain = {
              lastScraped: terrainData.scrapedAt,
              date: terrainData.date,
            };
          } catch (e) {}
        }
      }

      if (status.lifts || status.snow || status.terrain) {
        resortStatus[resortKey] = status;
      }
    }

    res.json({
      generated: new Date().toISOString(),
      resortCount: Object.keys(resortStatus).length,
      resorts: resortStatus,
    });
  } catch (error) {
    console.error('Error generating resort health:', error);
    res.status(500).json({ error: 'Failed to generate resort health' });
  }
});

// Generate latest-lifts.json aggregation on demand
app.get('/data/latest-lifts.json', (req, res) => {
  try {
    const resorts = {};
    const dataDir = DATA_DIR;

    // Read all resort directories
    const dirs = fs.readdirSync(dataDir).filter(d => {
      const liftsDir = path.join(dataDir, d, 'lifts');
      return fs.existsSync(liftsDir) && fs.statSync(liftsDir).isDirectory();
    });

    for (const resortKey of dirs) {
      const liftsDir = path.join(dataDir, resortKey, 'lifts');
      const files = fs.readdirSync(liftsDir).filter(f => f.endsWith('.ndjson')).sort().reverse();

      if (files.length === 0) continue;

      const latestFile = path.join(liftsDir, files[0]);
      const content = fs.readFileSync(latestFile, 'utf8').trim();
      if (!content) continue;

      const lines = content.split('\n').filter(Boolean);
      if (lines.length === 0) continue;

      // Get the most recent timestamp
      const lastRecord = JSON.parse(lines[lines.length - 1]);
      const lastTimestamp = lastRecord.timestamp;

      // Get all records from the last scrape
      const latestRecords = lines
        .map(line => { try { return JSON.parse(line); } catch { return null; } })
        .filter(r => r && r.timestamp === lastTimestamp);

      if (latestRecords.length > 0) {
        resorts[resortKey] = {
          timestamp: lastTimestamp,
          lifts: latestRecords,
        };
      }
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json({
      generated: new Date().toISOString(),
      resorts,
    });

  } catch (error) {
    console.error('Error generating latest-lifts.json:', error);
    res.status(500).json({ error: 'Failed to generate lift data' });
  }
});

// Dynamic index.json for lift data (generates from latest NDJSON)
// This endpoint must come BEFORE the static file middleware
app.get('/data/:resort/lifts/index.json', (req, res) => {
  const resortKey = req.params.resort;
  const liftsDir = path.join(DATA_DIR, resortKey, 'lifts');

  if (!fs.existsSync(liftsDir)) {
    return res.status(404).json({ error: 'Resort not found' });
  }

  try {
    // Find the latest NDJSON file
    const files = fs.readdirSync(liftsDir).filter(f => f.endsWith('.ndjson')).sort().reverse();
    if (files.length === 0) {
      return res.status(404).json({ error: 'No lift data available' });
    }

    const latestFile = path.join(liftsDir, files[0]);
    const content = fs.readFileSync(latestFile, 'utf8').trim();
    if (!content) {
      return res.status(404).json({ error: 'Empty lift data file' });
    }

    const lines = content.split('\n').filter(Boolean);
    if (lines.length === 0) {
      return res.status(404).json({ error: 'No lift records' });
    }

    // Get the most recent timestamp
    const lastRecord = JSON.parse(lines[lines.length - 1]);
    const lastTimestamp = lastRecord.timestamp;

    // Get all records from the last scrape
    const latestRecords = lines
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(r => r && r.timestamp === lastTimestamp);

    // Build lift index with proper structure
    const lifts = latestRecords.map(r => ({
      liftId: r.liftId,
      name: r.name,
      slug: r.name ? r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : null,
      mountain: r.mountain,
      type: r.type,
      capacity: r.capacity || null,
      status: r.status,
      waitMinutes: r.waitMinutes,
      openTime: r.openTime,
      closeTime: r.closeTime,
      avgWaitTime: null,
      lastUpdated: r.timestamp,
    }));

    const index = {
      resort: resortKey,
      resortName: latestRecords[0]?.resort || resortKey,
      provider: 'vail',
      liftCount: lifts.length,
      lifts,
      generated: lastTimestamp, // Use the actual scrape time, not current time
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json(index);

  } catch (error) {
    console.error(`Error generating lift index for ${resortKey}:`, error);
    res.status(500).json({ error: 'Failed to generate lift index' });
  }
});

// Static file serving for data directory
app.use('/data', express.static(DATA_DIR, {
  maxAge: '30s',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json');
    } else if (filePath.endsWith('.ndjson')) {
      res.setHeader('Content-Type', 'application/x-ndjson');
    }
  },
}));

// Dashboards - serve entire dashboards folder (same structure as GitHub Pages)
const DASHBOARDS_DIR = path.join(__dirname, '..', 'dashboards');
app.use('/dashboards', express.static(DASHBOARDS_DIR, {
  maxAge: '1m',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html');
    }
  },
}));

// Config file for dashboards (at root, same as GitHub Pages)
app.get('/config.json', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'config.json'));
});

// Monitor dashboard (Hetzner-specific)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'monitor.html'));
});

// Legacy redirect: /lifts.html -> /dashboards/live-lifts.html
app.get('/lifts.html', (req, res) => {
  const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  res.redirect(301, `/dashboards/live-lifts.html${query}`);
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'Ski Lift Scraper API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      latestLifts: '/data/latest-lifts.json',
      resortLifts: '/data/{resort}/lifts/{date}.ndjson',
      monitor: '/',
    },
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API server listening on http://0.0.0.0:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
