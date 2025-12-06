// Regenerate trails/index.json for all resorts with trail data
const fs = require('fs');
const path = require('path');

const dataDir = 'data';
const dirs = fs.readdirSync(dataDir).filter(d => {
  const stat = fs.statSync(path.join(dataDir, d));
  return stat.isDirectory() && d !== 'icons';
});

let updated = 0;

dirs.forEach(resortKey => {
  const trailsDataDir = path.join(dataDir, resortKey, 'trails', 'data');

  if (!fs.existsSync(trailsDataDir)) return;

  const trailFiles = fs.readdirSync(trailsDataDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  if (trailFiles.length === 0) return;

  // Load first trail to get resort name
  const firstTrail = JSON.parse(fs.readFileSync(path.join(trailsDataDir, trailFiles[0]), 'utf8'));

  const trailsIndex = {
    resort: resortKey,
    resortName: firstTrail.resortName || resortKey,
    trailCount: trailFiles.length,
    trails: [],
    generated: new Date().toISOString()
  };

  trailFiles.forEach(file => {
    try {
      const trailData = JSON.parse(fs.readFileSync(path.join(trailsDataDir, file), 'utf8'));
      trailsIndex.trails.push({
        name: trailData.trailName,
        slug: trailData.trailSlug,
        area: trailData.area,
        difficulty: trailData.difficulty,
        isGroomedToday: trailData.currentStatus.isGroomed,
        isOpen: trailData.currentStatus.isOpen,
        groomingPercentage: trailData.stats.groomingPercentage,
        currentStreak: trailData.stats.currentStreak,
        longestStreak: trailData.stats.longestStreak
      });
    } catch (e) {
      // Skip invalid files
    }
  });

  // Sort by area then name
  trailsIndex.trails.sort((a, b) => {
    if (a.area !== b.area) return a.area.localeCompare(b.area);
    return a.name.localeCompare(b.name);
  });

  const indexFile = path.join(dataDir, resortKey, 'trails', 'index.json');
  fs.writeFileSync(indexFile, JSON.stringify(trailsIndex, null, 2));

  console.log(`✓ ${resortKey}: ${trailFiles.length} trails`);
  updated++;
});

console.log(`\nUpdated ${updated} trail indexes`);
