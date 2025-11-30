// generate-landing-pages.js - Create landing pages for all resorts
// This script copies universal templates to each resort directory

const fs = require('fs');
const path = require('path');

// Load configuration
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

// Template files
const TEMPLATES_DIR = 'templates';
const GROOMING_TEMPLATE = path.join(TEMPLATES_DIR, 'grooming.html');
const SNOW_TEMPLATE = path.join(TEMPLATES_DIR, 'snow.html');
const TRAIL_TEMPLATE = path.join(TEMPLATES_DIR, 'trail.html');
const TRAILS_TEMPLATE = path.join(TEMPLATES_DIR, 'trails.html');
const LIFTS_TEMPLATE = path.join(TEMPLATES_DIR, 'lifts.html');
const LIFT_TEMPLATE = path.join(TEMPLATES_DIR, 'lift.html');

/**
 * Ensure directory exists, create if not
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Copy template file to resort directory
 */
function copyTemplate(templatePath, destinationPath) {
  const content = fs.readFileSync(templatePath, 'utf8');
  fs.writeFileSync(destinationPath, content);
}

/**
 * Generate landing pages for all resorts
 */
function generateLandingPages() {
  console.log('🎿 Generating Landing Pages for All Resorts');
  console.log('='.repeat(60));

  // Check if templates exist
  if (!fs.existsSync(GROOMING_TEMPLATE)) {
    console.error(`❌ Template not found: ${GROOMING_TEMPLATE}`);
    return;
  }
  if (!fs.existsSync(SNOW_TEMPLATE)) {
    console.error(`❌ Template not found: ${SNOW_TEMPLATE}`);
    return;
  }

  let createdCount = 0;
  let skippedCount = 0;
  let updatedCount = 0;

  config.resorts.forEach(resort => {
    const resortDir = path.join('data', resort.key);
    const groomingPage = path.join(resortDir, 'grooming.html');
    const snowPage = path.join(resortDir, 'snow.html');

    console.log(`\n[${resort.name}]`);

    // Ensure resort directory exists
    ensureDirectoryExists(resortDir);

    // Create/update grooming page if resort has terrainUrl OR is Inspector resort
    const isInspector = resort.provider === 'inspector';
    if (resort.terrainUrl || isInspector) {
      const groomingExists = fs.existsSync(groomingPage);
      copyTemplate(GROOMING_TEMPLATE, groomingPage);

      if (groomingExists) {
        console.log(`  ✓ Updated grooming.html${isInspector ? ' (Inspector)' : ''}`);
        updatedCount++;
      } else {
        console.log(`  ✓ Created grooming.html${isInspector ? ' (Inspector)' : ''}`);
        createdCount++;
      }
    } else {
      console.log(`  ⊘ Skipped grooming.html (no terrainUrl or provider configured)`);
      skippedCount++;
    }

    // Create/update snow page if resort has snowReportUrl OR is Inspector resort
    if (resort.snowReportUrl || isInspector) {
      const snowExists = fs.existsSync(snowPage);
      copyTemplate(SNOW_TEMPLATE, snowPage);

      if (snowExists) {
        console.log(`  ✓ Updated snow.html${isInspector ? ' (Inspector)' : ''}`);
        updatedCount++;
      } else {
        console.log(`  ✓ Created snow.html${isInspector ? ' (Inspector)' : ''}`);
        createdCount++;
      }
    } else {
      console.log(`  ⊘ Skipped snow.html (no snowReportUrl or provider configured)`);
      skippedCount++;
    }

    // Create/update trail pages if resort has trails directory
    const trailsDir = path.join(resortDir, 'trails');
    if (fs.existsSync(trailsDir)) {
      // Create/update trail.html (single trail detail page)
      if (fs.existsSync(TRAIL_TEMPLATE)) {
        const trailPage = path.join(resortDir, 'trail.html');
        const trailExists = fs.existsSync(trailPage);
        copyTemplate(TRAIL_TEMPLATE, trailPage);

        if (trailExists) {
          console.log(`  ✓ Updated trail.html`);
          updatedCount++;
        } else {
          console.log(`  ✓ Created trail.html`);
          createdCount++;
        }
      }

      // Create/update trails.html (trail list/index page)
      if (fs.existsSync(TRAILS_TEMPLATE)) {
        const trailsPage = path.join(resortDir, 'trails.html');
        const trailsExists = fs.existsSync(trailsPage);
        copyTemplate(TRAILS_TEMPLATE, trailsPage);

        if (trailsExists) {
          console.log(`  ✓ Updated trails.html`);
          updatedCount++;
        } else {
          console.log(`  ✓ Created trails.html`);
          createdCount++;
        }
      }
    }

    // Create/update lift pages if resort has lift data
    const liftsDir = path.join(resortDir, 'lifts');
    if (fs.existsSync(liftsDir)) {
      const liftsPage = path.join(resortDir, 'lifts.html');
      const liftPage = path.join(resortDir, 'lift.html');

      // Check if templates exist
      if (fs.existsSync(LIFTS_TEMPLATE) && fs.existsSync(LIFT_TEMPLATE)) {
        // Create/update lifts.html
        const liftsExists = fs.existsSync(liftsPage);
        copyTemplate(LIFTS_TEMPLATE, liftsPage);

        if (liftsExists) {
          console.log(`  ✓ Updated lifts.html`);
          updatedCount++;
        } else {
          console.log(`  ✓ Created lifts.html`);
          createdCount++;
        }

        // Create/update lift.html
        const liftExists = fs.existsSync(liftPage);
        copyTemplate(LIFT_TEMPLATE, liftPage);

        if (liftExists) {
          console.log(`  ✓ Updated lift.html`);
          updatedCount++;
        } else {
          console.log(`  ✓ Created lift.html`);
          createdCount++;
        }
      } else {
        console.log(`  ⚠️  Lift templates not found`);
      }
    }
  });

  console.log('\n' + '='.repeat(60));
  console.log(`📊 Summary:`);
  console.log(`   Created: ${createdCount} pages`);
  console.log(`   Updated: ${updatedCount} pages`);
  console.log(`   Skipped: ${skippedCount} pages (missing URL config)`);
  console.log('='.repeat(60));
  console.log('\n✅ Landing page generation complete!\n');
}

// Run the generator
generateLandingPages();
