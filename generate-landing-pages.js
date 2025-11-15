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

    // Create/update grooming page if resort has terrainUrl
    if (resort.terrainUrl) {
      const groomingExists = fs.existsSync(groomingPage);
      copyTemplate(GROOMING_TEMPLATE, groomingPage);

      if (groomingExists) {
        console.log(`  ✓ Updated grooming.html`);
        updatedCount++;
      } else {
        console.log(`  ✓ Created grooming.html`);
        createdCount++;
      }
    } else {
      console.log(`  ⊘ Skipped grooming.html (no terrainUrl configured)`);
      skippedCount++;
    }

    // Create/update snow page if resort has snowReportUrl
    if (resort.snowReportUrl) {
      const snowExists = fs.existsSync(snowPage);
      copyTemplate(SNOW_TEMPLATE, snowPage);

      if (snowExists) {
        console.log(`  ✓ Updated snow.html`);
        updatedCount++;
      } else {
        console.log(`  ✓ Created snow.html`);
        createdCount++;
      }
    } else {
      console.log(`  ⊘ Skipped snow.html (no snowReportUrl configured)`);
      skippedCount++;
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
