const fs = require('fs');
const path = require('path');
const {
  initializeDatabase,
  getOrCreateResort,
  saveTerrainStatus,
  saveSnowConditions,
  closeDatabase
} = require('./database');

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(__dirname, 'config.json');

/**
 * Read resort configuration
 */
function getResortConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return config.resorts;
}

/**
 * Import all historical data from JSON files into SQLite
 */
async function importHistoricalData() {
  console.log('Initializing database...');
  const db = initializeDatabase();

  const resorts = getResortConfig();
  let totalTerrainRecords = 0;
  let totalSnowRecords = 0;

  console.log(`\nImporting data for ${resorts.length} resorts...\n`);

  for (const resort of resorts) {
    const resortKey = resort.key;
    const resortName = resort.name;
    const timezone = resort.timezone || 'America/Denver';

    console.log(`Processing ${resortName} (${resortKey})...`);

    // Get or create resort in database
    await new Promise((resolve, reject) => {
      getOrCreateResort(db, resortKey, resortName, timezone, (err, resortId) => {
        if (err) return reject(err);

        let terrainCount = 0;
        let snowCount = 0;

        // Import terrain data
        const terrainDir = path.join(DATA_DIR, resortKey, 'terrain');
        if (fs.existsSync(terrainDir)) {
          const terrainFiles = fs.readdirSync(terrainDir)
            .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.json$/));

          terrainFiles.forEach(file => {
            const date = file.replace('.json', '');
            const filePath = path.join(terrainDir, file);

            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

              // Wrap the data in FMR format to match expected structure
              saveTerrainStatus(db, resortId, date, { FMR: data }, (err, count) => {
                if (err) {
                  console.error(`  Error importing terrain ${date}:`, err.message);
                } else if (count > 0) {
                  terrainCount += count;
                }
              });
            } catch (err) {
              console.error(`  Error reading ${file}:`, err.message);
            }
          });
        }

        // Import snow data
        const snowDir = path.join(DATA_DIR, resortKey, 'snow');
        if (fs.existsSync(snowDir)) {
          const snowFiles = fs.readdirSync(snowDir)
            .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.json$/));

          snowFiles.forEach(file => {
            const date = file.replace('.json', '');
            const filePath = path.join(snowDir, file);

            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

              saveSnowConditions(db, resortId, date, data, (err, id) => {
                if (err) {
                  console.error(`  Error importing snow ${date}:`, err.message);
                } else if (id) {
                  snowCount++;
                }
              });
            } catch (err) {
              console.error(`  Error reading ${file}:`, err.message);
            }
          });
        }

        // Wait a bit for async operations to complete
        setTimeout(() => {
          console.log(`  ✓ Imported ${terrainCount} terrain records, ${snowCount} snow records`);
          totalTerrainRecords += terrainCount;
          totalSnowRecords += snowCount;
          resolve();
        }, 500);
      });
    });
  }

  // Wait for all operations to complete
  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log(`\n✅ Import complete!`);
  console.log(`   Total terrain records: ${totalTerrainRecords}`);
  console.log(`   Total snow records: ${totalSnowRecords}`);
  console.log(`   Database location: ${path.join(DATA_DIR, 'ski-data.db')}\n`);

  closeDatabase(db);
}

// Run import
importHistoricalData().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
