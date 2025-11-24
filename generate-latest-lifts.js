// generate-latest-lifts.js - Aggregate latest lift data from all resorts
// Creates a unified API endpoint at /data/latest-lifts.json

const fs = require('fs');
const path = require('path');

/**
 * Generate unified lift data file aggregating all resorts
 */
function generateLatestLifts() {
  console.log('🚡 Generating Latest Lifts Aggregation');
  console.log('='.repeat(60));

  const dataDir = path.join(__dirname, 'data');
  const output = {};
  let resortCount = 0;
  let totalLifts = 0;

  // Find all resorts with lift data
  const resorts = fs.readdirSync(dataDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const resort of resorts) {
    const indexPath = path.join(dataDir, resort, 'lifts', 'index.json');

    // Skip if no lift index exists
    if (!fs.existsSync(indexPath)) {
      continue;
    }

    try {
      const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

      // Extract the most recent date from the generated timestamp
      const generatedDate = indexData.generated
        ? new Date(indexData.generated).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      // Add to output
      output[resort] = {
        date: generatedDate,
        name: indexData.resortName || resort,
        liftCount: indexData.liftCount || 0,
        lifts: indexData.lifts || [],
        generated: indexData.generated
      };

      resortCount++;
      totalLifts += indexData.liftCount || 0;

      console.log(`✓ ${indexData.resortName || resort}: ${indexData.liftCount || 0} lifts`);
    } catch (error) {
      console.error(`❌ Error reading lift index for ${resort}:`, error.message);
    }
  }

  // Write unified file
  const outputPath = path.join(dataDir, 'latest-lifts.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log('\n' + '='.repeat(60));
  console.log(`📊 Summary:`);
  console.log(`   Resorts: ${resortCount}`);
  console.log(`   Total lifts: ${totalLifts}`);
  console.log(`   Output: ${outputPath}`);
  console.log('='.repeat(60));
  console.log('\n✅ Latest lifts aggregation complete!\n');
}

// Run the generator
generateLatestLifts();
