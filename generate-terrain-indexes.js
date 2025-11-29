#!/usr/bin/env node
/**
 * Generate per-resort terrain index files
 * Creates data/{resort}/terrain/index.json for each resort
 */

const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const RESORTS = config.resorts.reduce((acc, r) => {
  acc[r.key] = r;
  return acc;
}, {});

function generateTerrainIndex(resortKey) {
  const terrainDir = path.join('data', resortKey, 'terrain');

  if (!fs.existsSync(terrainDir)) {
    console.log(`⊘ Skipping ${resortKey}: no terrain directory`);
    return;
  }

  const files = fs.readdirSync(terrainDir)
    .filter(f => f.endsWith('.json') && f !== 'index.json')
    .map(f => f.replace(/\.json$/, '')) // Remove .json extension
    .sort()
    .reverse(); // Most recent first

  if (files.length === 0) {
    console.log(`⊘ Skipping ${resortKey}: no terrain files`);
    return;
  }

  const indexData = {
    resort: resortKey,
    resortName: RESORTS[resortKey]?.name || resortKey,
    files,
    latest: files[0] || null,
    count: files.length,
    generated: new Date().toISOString()
  };

  const outputPath = path.join(terrainDir, 'index.json');
  fs.writeFileSync(outputPath, JSON.stringify(indexData, null, 2));
  console.log(`✓ Generated ${outputPath} (${files.length} files)`);
}

// Generate index for all resorts
console.log('Generating per-resort terrain index files...\n');
Object.keys(RESORTS).forEach(resortKey => {
  generateTerrainIndex(resortKey);
});
console.log('\n✅ Done!');
