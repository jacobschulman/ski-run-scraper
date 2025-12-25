// api-server.js - Simple Express server to serve ski data JSON files
// Serves data from the data/ directory with CORS support

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const HEALTH_FILE = path.join(__dirname, 'health.json');

// Read health from shared file written by scraper
function getScraperHealth() {
  try {
    if (fs.existsSync(HEALTH_FILE)) {
      const data = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8'));
      return data;
    }
  } catch (e) {
    console.error('Failed to read health file:', e.message);
  }
  return { status: 'unknown', ikon: {}, vail: {} };
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

// Health check endpoint
app.get('/health', (req, res) => {
  const scraperHealth = getScraperHealth();
  res.json({
    status: scraperHealth.status || 'ok',
    server: 'running',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    scraper: scraperHealth,
  });
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

// Monitor dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'monitor.html'));
});

// Lifts dashboard
app.get('/lifts.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'lifts.html'));
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
