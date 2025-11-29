// lift-scraper-loop.js - Continuous lift wait-time tracking
// Runs the lift scraper in a loop with no delay between runs
// Press Ctrl+C to stop gracefully

// TO RUN - CD TO PROJECT ROOT AND RUN: npm run scrape:lifts:loop

const { spawn } = require('child_process');

// Configuration
const DELAY_SECONDS = process.env.SCRAPE_DELAY || 5; // Default 5 seconds between runs
const DELAY_MS = DELAY_SECONDS * 1000;

let isShuttingDown = false;
let runCount = 0;

// Graceful shutdown handler
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutdown signal received. Stopping after current run...');
  isShuttingDown = true;
});

/**
 * Run the lift scraper once
 */
function runScraper() {
  return new Promise((resolve, reject) => {
    runCount++;
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🔄 RUN #${runCount} - ${new Date().toLocaleString()}`);
    console.log('═'.repeat(70));

    const scraper = spawn('node', ['lift-scraper-local.js'], {
      stdio: 'inherit' // Show output directly in console
    });

    scraper.on('close', (code) => {
      if (code === 0) {
        console.log(`\n✅ Run #${runCount} completed successfully`);
        resolve();
      } else {
        console.log(`\n⚠️  Run #${runCount} exited with code ${code}`);
        resolve(); // Don't reject - continue looping even if one run fails
      }
    });

    scraper.on('error', (error) => {
      console.error(`\n❌ Error running scraper: ${error.message}`);
      resolve(); // Continue looping
    });
  });
}

/**
 * Main loop
 */
async function continuousLoop() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║     🎿 Continuous Lift Wait-Time Tracker 🎿                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log(`\n⚙️  Configuration:`);
  console.log(`   • Mode: Continuous (runs as fast as possible)`);
  console.log(`   • Delay between runs: ${DELAY_SECONDS} seconds`);
  console.log(`   • Started: ${new Date().toLocaleString()}`);
  console.log(`   • Press Ctrl+C to stop gracefully\n`);

  while (!isShuttingDown) {
    const startTime = Date.now();

    try {
      await runScraper();
    } catch (error) {
      console.error(`\n💥 Unexpected error: ${error.message}`);
    }

    if (isShuttingDown) {
      break;
    }

    const elapsed = Date.now() - startTime;
    const elapsedSeconds = Math.round(elapsed / 1000);
    const nextRun = new Date(Date.now() + DELAY_MS);

    console.log(`\n⏱️  Run completed in ${elapsedSeconds} seconds`);
    console.log(`   Waiting ${DELAY_SECONDS} seconds before next run...`);
    console.log(`   Next run: ${nextRun.toLocaleString()}`);
    console.log('─'.repeat(70));

    // Brief delay between runs, checking for shutdown
    const checkInterval = 100;
    let waited = 0;
    while (waited < DELAY_MS && !isShuttingDown) {
      await new Promise(resolve => setTimeout(resolve, Math.min(checkInterval, DELAY_MS - waited)));
      waited += checkInterval;
    }
  }

  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║     ✅ Scraper Stopped Gracefully                                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log(`\n📊 Total runs completed: ${runCount}`);
  console.log(`⏱️  Stopped at: ${new Date().toLocaleString()}\n`);
}

// Start the loop
continuousLoop().catch(error => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
