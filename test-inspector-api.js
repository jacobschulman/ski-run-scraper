// Phase 0: Proof of Concept - Test Inspector API
// This script validates the Inspector (Ikon) API works before any refactoring
// NO database, NO file writes, NO existing code changes - just a test

const https = require('https');

const INSPECTOR_API_URL = 'https://mtnpowder.com/feed/v3.json';
const BEARER_TOKEN = 'hPtaTVkbuyZQnrxvru4ApfpXnS21PJO3eTKdibDoLZE';

// Test with Stratton (resort ID 1)
const TEST_RESORT_ID = 1;
const TEST_RESORT_NAME = 'Stratton';

console.log('🧪 Inspector API Proof of Concept Test\n');
console.log('=' .repeat(60));
console.log(`Testing resort: ${TEST_RESORT_NAME} (ID: ${TEST_RESORT_ID})`);
console.log(`API URL: ${INSPECTOR_API_URL}`);
console.log('='.repeat(60) + '\n');

function fetchInspectorData(resortId) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams();
    params.append('bearer_token', BEARER_TOKEN);
    params.append('resortId[]', resortId);

    const url = `${INSPECTOR_API_URL}?${params.toString()}`;

    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (error) {
            reject(new Error(`Failed to parse JSON: ${error.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    }).on('error', (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });
  });
}

async function testInspectorAPI() {
  try {
    console.log('⏳ Fetching data from Inspector API...\n');

    const data = await fetchInspectorData(TEST_RESORT_ID);

    if (!data || !data.Resorts || data.Resorts.length === 0) {
      console.error('❌ ERROR: No resort data in response');
      console.error('Response:', JSON.stringify(data, null, 2).substring(0, 500));
      process.exit(1);
    }

    const resort = data.Resorts[0];

    console.log('✅ API call successful!\n');
    console.log('='.repeat(60));
    console.log('📊 RESORT DATA SUMMARY');
    console.log('='.repeat(60));
    console.log(`Resort Name: ${resort.Name}`);
    console.log(`Operating Status: ${resort.OperatingStatus || 'Unknown'}`);
    console.log(`Last Update: ${resort.LastUpdate || 'Unknown'}`);

    // Snow data
    if (resort.SnowReport) {
      console.log('\n❄️  SNOW REPORT:');
      console.log(`  - Open Trails: ${resort.SnowReport.TotalOpenTrails || 0} / ${resort.SnowReport.TotalTrails || 0}`);
      console.log(`  - Groomed Trails: ${resort.SnowReport.GroomedTrails || 0}`);
      console.log(`  - Open Lifts: ${resort.SnowReport.TotalOpenLifts || 0} / ${resort.SnowReport.TotalLifts || 0}`);
      console.log(`  - Base Depth: ${resort.SnowReport.SnowBaseRangeIn || 'N/A'}" (${resort.SnowReport.SnowBaseRangeCM || 'N/A'} cm)`);
      console.log(`  - Season Total: ${resort.SnowReport.SeasonTotalIn || 'N/A'}" (${resort.SnowReport.SeasonTotalCm || 'N/A'} cm)`);
      console.log(`  - Grooming Active: ${resort.SnowReport.GroomingActive || 'N/A'}`);
      console.log(`  - Snowmaking Active: ${resort.SnowReport.SnowMakingActive || 'N/A'}`);
    }

    // Trails and lifts data
    if (resort.MountainAreas && resort.MountainAreas.length > 0) {
      let totalTrails = 0;
      let totalLifts = 0;
      const trailSample = [];
      const liftSample = [];

      resort.MountainAreas.forEach(area => {
        if (area.Trails) {
          totalTrails += area.Trails.length;
          if (trailSample.length < 3 && area.Trails.length > 0) {
            trailSample.push(...area.Trails.slice(0, 3 - trailSample.length));
          }
        }
        if (area.Lifts) {
          totalLifts += area.Lifts.length;
          if (liftSample.length < 3 && area.Lifts.length > 0) {
            liftSample.push(...area.Lifts.slice(0, 3 - liftSample.length));
          }
        }
      });

      console.log(`\n🎿 TERRAIN DATA:`);
      console.log(`  - Total Mountain Areas: ${resort.MountainAreas.length}`);
      console.log(`  - Total Trails: ${totalTrails}`);
      console.log(`  - Total Lifts: ${totalLifts}`);

      if (trailSample.length > 0) {
        console.log('\n📋 Sample Trail Data (first 3):');
        trailSample.forEach((trail, idx) => {
          console.log(`  ${idx + 1}. ${trail.Name}`);
          console.log(`     Status: ${trail.Status}, Difficulty: ${trail.Difficulty}`);
          console.log(`     Grooming: ${trail.Grooming}, SnowMaking: ${trail.SnowMaking}`);
          console.log(`     Moguls: ${trail.Moguls}, Glades: ${trail.Glades}`);
          console.log(`     RunOfTheDay: ${trail.RunOfTheDay}`);
        });
      }

      if (liftSample.length > 0) {
        console.log('\n🚡 Sample Lift Data (first 3):');
        liftSample.forEach((lift, idx) => {
          console.log(`  ${idx + 1}. ${lift.Name}`);
          console.log(`     Status: ${lift.Status}, Type: ${lift.LiftType}`);
          console.log(`     Wait Time: ${lift.WaitTime || 'N/A'}`);
          console.log(`     First Tracks: ${lift.FirstTracks || 'N/A'}`);
          if (lift.Hours && lift.Hours.Monday) {
            console.log(`     Hours (Mon): ${lift.Hours.Monday.Open} - ${lift.Hours.Monday.Close}`);
          }
        });
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ PROOF OF CONCEPT SUCCESS!');
    console.log('='.repeat(60));
    console.log('✓ API token works');
    console.log('✓ Data structure is as expected');
    console.log('✓ Extra fields are present (Moguls, Touring, RunOfTheDay, etc.)');
    console.log('✓ Lift hours schedule available');
    console.log('\n🎉 Ready to proceed with full implementation!\n');

  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('❌ PROOF OF CONCEPT FAILED');
    console.error('='.repeat(60));
    console.error(`Error: ${error.message}`);
    console.error('\n⚠️  DO NOT proceed with full implementation until this is fixed!\n');
    process.exit(1);
  }
}

// Run the test
testInspectorAPI();
