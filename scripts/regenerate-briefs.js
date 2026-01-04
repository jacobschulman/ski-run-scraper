#!/usr/bin/env node
/**
 * Regenerate morning briefs for all resorts for a date range
 * Uses existing snow/terrain data to regenerate briefs with updated rules
 */

const fs = require('fs');
const path = require('path');
const briefGenerator = require('../lib/brief-generator');

// Resort definitions (minimal needed for brief generation)
const RESORTS = {};
const dataDir = path.join(__dirname, '../data');

// Discover resorts from data directory
fs.readdirSync(dataDir).forEach(dir => {
  const briefDir = path.join(dataDir, dir, 'brief');
  if (fs.existsSync(briefDir) && fs.statSync(briefDir).isDirectory()) {
    RESORTS[dir] = { name: dir.charAt(0).toUpperCase() + dir.slice(1) };
  }
});

// Date range to regenerate
const startDate = process.argv[2] || '2025-12-28';
const endDate = process.argv[3] || '2026-01-04';

function getDatesInRange(start, end) {
  const dates = [];
  let current = new Date(start + 'T12:00:00');
  const endDate = new Date(end + 'T12:00:00');

  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

const dates = getDatesInRange(startDate, endDate);
const config = {};

console.log(`Regenerating briefs for ${Object.keys(RESORTS).length} resorts`);
console.log(`Date range: ${startDate} to ${endDate} (${dates.length} days)`);
console.log('---');

let totalRegenerated = 0;
let totalErrors = 0;

for (const resortKey of Object.keys(RESORTS)) {
  for (const date of dates) {
    try {
      // Check if we have data for this resort/date
      const briefPath = path.join(dataDir, resortKey, 'brief', `${date}.json`);
      const snowPath = path.join(dataDir, resortKey, 'snow', `${date}.json`);
      const terrainPath = path.join(dataDir, resortKey, 'terrain', `${date}.json`);

      // Only regenerate if we have the underlying data
      if (!fs.existsSync(snowPath) || !fs.existsSync(terrainPath)) {
        continue;
      }

      const brief = briefGenerator.generateBrief(resortKey, date, config, RESORTS);

      if (brief && brief.morningBrief) {
        // Save the regenerated brief
        fs.writeFileSync(briefPath, JSON.stringify(brief, null, 2));
        totalRegenerated++;

        // Also update latest.json if this is the most recent date
        const latestPath = path.join(dataDir, resortKey, 'brief', 'latest.json');
        if (fs.existsSync(latestPath)) {
          const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
          if (latest.date === date) {
            fs.writeFileSync(latestPath, JSON.stringify(brief, null, 2));
          }
        }
      }
    } catch (error) {
      totalErrors++;
      console.error(`Error regenerating ${resortKey}/${date}: ${error.message}`);
    }
  }
}

console.log(`\nRegenerated ${totalRegenerated} briefs`);
if (totalErrors > 0) {
  console.log(`Errors: ${totalErrors}`);
}
